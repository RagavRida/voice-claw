import express from "express";
import path from "path";
import http from "http";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

// Load env variables from voice-claw/.env
dotenv.config();

const app = express();
const PORT = 3000;
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const backendOrigin = new URL(BACKEND_URL);

// ──────────────────────────────────────────────────────────────────────────────
// Raw body proxy for /api/* routes EXCEPT /api/chat
// This must come BEFORE express.json() so multipart uploads aren't consumed.
// ──────────────────────────────────────────────────────────────────────────────
app.all("/api/*", (req, res, next) => {
  // Let /api/chat fall through to the parsed handler below
  if (req.path === "/api/chat") {
    return next();
  }

  const targetPath = req.originalUrl; // preserves query strings
  console.log(`[Proxy] ${req.method} ${targetPath} -> ${BACKEND_URL}${targetPath}`);

  const proxyReq = http.request(
    {
      hostname: backendOrigin.hostname,
      port: backendOrigin.port,
      path: targetPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${backendOrigin.hostname}:${backendOrigin.port}`,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    console.error(`[Proxy] Error: ${err.message}`);
    if (!res.headersSent) {
      res.status(502).json({
        error: "Backend unavailable",
        detail: `Could not connect to ${BACKEND_URL}. Make sure the FastAPI backend is running.`,
      });
    }
  });

  // Pipe the raw incoming request body straight to the backend
  req.pipe(proxyReq);
});

// Body parsing — only needed for /api/chat
app.use(express.json({ limit: "1mb" }));

// ──────────────────────────────────────────────────────────────────────────────
// /api/chat — Onboarding conversational AI (local, not proxied)
// The FastAPI backend has no onboarding chat endpoint, so this stays here.
// ──────────────────────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  // 1. Try primary LLM API (Anthropic) if key is available
  const aiApiKey = process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY;
  const aiModel = process.env.AI_MODEL || "claude-3-5-sonnet-20241022";
  if (aiApiKey) {
    try {
      console.log("[AI Proxy] Calling primary LLM API...");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": aiApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: aiModel,
          max_tokens: 1000,
          system: system,
          messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return res.json(data);
      } else {
        const statusText = await response.text();
        console.warn(`[AI Proxy] Primary LLM returned ${response.status}: ${statusText}`);
      }
    } catch (e) {
      console.error("[AI Proxy] Primary LLM connection error:", e);
    }
  }

  // 2. Groq fallback (fast inference, OpenAI-compatible API)
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      console.log("[AI Proxy] Trying Groq (llama-3.3-70b-versatile)...");
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: system },
            ...messages.map((m: any) => ({ role: m.role, content: m.content })),
          ],
          max_tokens: 1000,
          temperature: 0.7,
        }),
      });

      if (groqRes.ok) {
        const groqData = await groqRes.json();
        const answer = groqData?.choices?.[0]?.message?.content;
        if (answer) {
          console.log("[AI Proxy] Groq response OK");
          return res.json({
            content: [{ type: "text", text: answer }],
          });
        }
      } else {
        const errText = await groqRes.text();
        console.warn(`[AI Proxy] Groq returned ${groqRes.status}: ${errText.slice(0, 150)}`);
      }
    } catch (err: any) {
      console.error("[AI Proxy] Groq connection error:", err?.message || err);
    }
  }

  // 3. Gemini / Gemma fallback (with retry + model fallback for rate limits)
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });

    const contents = messages.map((msg: any) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    // Try multiple models in case of quota exhaustion
    const models = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemma-4-31b-it", "gemma-4-26b-a4b-it"];
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          console.log(`[AI Proxy] Trying ${model} (attempt ${attempt + 1})...`);
          const geminiRes = await ai.models.generateContent({
            model,
            contents,
            config: { systemInstruction: system, temperature: 0.7 },
          });

          return res.json({
            content: [{ type: "text", text: geminiRes.text || "Perfect! Let's continue." }],
          });
        } catch (err: any) {
          const errStr = String(err?.message || err || "");
          const isRateLimit = errStr.includes("RESOURCE_EXHAUSTED") || errStr.includes("429") || err?.status === 429;
          if (isRateLimit && attempt === 0) {
            console.warn(`[AI Proxy] Rate limited on ${model}, retrying in 3s...`);
            await new Promise((r) => setTimeout(r, 3000));
            continue;
          }
          console.warn(`[AI Proxy] ${model} failed: ${errStr.slice(0, 120)}`);
          break; // try next model
        }
      }
    }
  }

  // 3. Sarvam LLM fallback (when Gemini quota is exhausted)
  const sarvamKey = process.env.SARVAM_API_KEY;
  if (sarvamKey) {
    try {
      console.log("[AI Proxy] Gemini exhausted, trying Sarvam chat (105b)...");
      // Merge system prompt into the conversation as Sarvam models handle it better this way
      const sarvamMessages = [
        {
          role: "user" as const,
          content: `[SYSTEM INSTRUCTIONS - Follow these strictly]\n${system}\n\n[END SYSTEM INSTRUCTIONS]\n\nNow respond to the conversation below. Remember: ask only ONE question at a time, be warm and brief.`,
        },
        {
          role: "assistant" as const,
          content: "Understood! I'll follow those instructions carefully. I'm ready to help with the onboarding.",
        },
        ...messages.map((m: any) => ({ role: m.role as string, content: m.content as string })),
      ];

      const sarvamRes = await fetch("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "API-Subscription-Key": sarvamKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sarvam-105b",
          messages: sarvamMessages,
          max_tokens: 500,
          temperature: 0.7,
        }),
      });

      if (sarvamRes.ok) {
        const sarvamData = await sarvamRes.json();
        const answer = sarvamData?.choices?.[0]?.message?.content;
        if (answer) {
          console.log("[AI Proxy] Sarvam 105b response OK");
          return res.json({
            content: [{ type: "text", text: answer }],
          });
        }
      } else {
        const errText = await sarvamRes.text();
        console.error(`[AI Proxy] Sarvam returned ${sarvamRes.status}: ${errText}`);
      }
    } catch (err: any) {
      console.error("[AI Proxy] Sarvam error:", err?.message || err);
    }
  }

  return res.status(429).json({ error: "All AI models are rate-limited. Please try again in a minute." });
});

// ──────────────────────────────────────────────────────────────────────────────
// Vite dev server / static file serving
// ──────────────────────────────────────────────────────────────────────────────
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Loading Vite dev middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving production build from dist/...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[VoiceClaw] Server running on http://localhost:${PORT}`);
    console.log(`[VoiceClaw] Proxying /api/* → ${BACKEND_URL}`);
  });
}

setupServer().catch((err) => {
  console.error("Failed to start server:", err);
});
