import {
  useState,
  useEffect,
  useRef,
  FormEvent,
  MouseEvent,
  TouchEvent,
} from "react";
import {
  Mic,
  CheckCircle2,
  Copy,
  Check,
  FileUp,
  ArrowLeft,
  Volume2,
  Loader2,
  Sparkles,
  AlertCircle,
  Send,
  X,
  FileText,
  Globe,
  Calendar,
  ShoppingBag,
  Settings,
  Link,
  Plus,
  ExternalLink,
  Sliders,
} from "lucide-react";

// ─── API URL HELPER ────────────────────────────────────────────────────────────
const getApiUrl = (endpoint: string): string => {
  const baseUrl = (import.meta as any).env.NEXT_PUBLIC_API_URL;
  if (baseUrl) {
    const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return `${cleanBase}${cleanEndpoint}`;
  }
  return endpoint;
};

// ─── TYPES ─────────────────────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  type?: "text" | "upload-widget" | "summary-card";
}

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

interface VoiceTurn {
  role: "user" | "agent";
  text: string;
  lang?: string;
}

interface AgentInfo {
  business_name: string;
  greeting: string;
  business_type?: string;
  primary_language?: string;
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {

  // ── ROUTING ──────────────────────────────────────────────────────────────────
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const h = () => setCurrentPath(window.location.pathname);
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);

  const navigate = (to: string) => {
    window.history.pushState({}, "", to);
    setCurrentPath(to);
  };

  const isAgentViewState = currentPath.startsWith("/agent/");
  const isReadyState = isAgentViewState && currentPath.endsWith("/ready");

  // Extract agent ID — handles /agent/[id], /agent/[id]/ready, /agent/[id]/talk
  const activeAgentId = isAgentViewState
    ? currentPath.replace(/^\/agent\//, "").split("/")[0]
    : null;

  // isAgentView covers both /agent/[id] and /agent/[id]/talk
  const isAgentView = isAgentViewState && !isReadyState;

  // ── TOAST ────────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  const showToast = (
    message: string,
    type: "success" | "error" | "info" = "info"
  ) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── BUILDER STATE ─────────────────────────────────────────────────────────────
  const [businessName, setBusinessName] = useState("");
  const [greeting, setGreeting] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [primaryLanguage, setPrimaryLanguage] = useState("");
  const [topFaqs, setTopFaqs] = useState<string[]>([]);
  const [restrictions, setRestrictions] = useState("");

  // Integrations / Connectors state
  const [isCalendarConnected, setIsCalendarConnected] = useState(false);
  const [calendarEmail, setCalendarEmail] = useState("");
  const [isTwilioConnected, setIsTwilioConnected] = useState(false);
  const [twilioPhone, setTwilioPhone] = useState("");
  const [isShopifyConnected, setIsShopifyConnected] = useState(false);
  const [shopifyStoreUrl, setShopifyStoreUrl] = useState("");
  const [isHubspotConnected, setIsHubspotConnected] = useState(false);
  const [hubspotApiKey, setHubspotApiKey] = useState("");
  const [showConfigFor, setShowConfigFor] = useState<string | null>(null);

  // Fade animation keys — incrementing forces React to remount the element,
  // replaying the CSS keyframe animation on each field update.
  const [animKeys, setAnimKeys] = useState<Record<string, number>>({
    business_name: 0,
    business_type: 0,
    primary_language: 0,
    greeting: 0,
  });
  const triggerAnim = (field: string) =>
    setAnimKeys((prev) => ({ ...prev, [field]: (prev[field] ?? 0) + 1 }));

  const [conversationHistory, setConversationHistory] = useState<
    ConversationTurn[]
  >([
    {
      role: "assistant",
      content:
        "Namaste! Welcome to VoiceClaw. I'm your onboarding assistant. Let's build your live voice agent in just a few quick steps! To start off, what is the name of your business?",
    },
  ]);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "init-msg",
      role: "assistant",
      content:
        "Namaste! Welcome to VoiceClaw. I'm your onboarding assistant. Let's build your live voice agent in just a few quick steps! To start off, what is the name of your business?",
      type: "text",
    },
  ]);

  const [chatInput, setChatInput] = useState("");
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [isConfigDone, setIsConfigDone] = useState(false);
  const [isMobileConfigExpanded, setIsMobileConfigExpanded] = useState(false);

  // Upload state
  const [uploadedFilesList, setUploadedFilesList] = useState<string[]>([]);
  const [uploadedResourceIds, setUploadedResourceIds] = useState<string[]>([]);
  const [ingestedUrlsList, setIngestedUrlsList] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isIngestingUrl, setIsIngestingUrl] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

  // Ready page state
  const [readyAgentInfo, setReadyAgentInfo] = useState<Partial<AgentInfo> | null>(null);
  const [readyCopied, setReadyCopied] = useState(false);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isAiTyping]);

  // Fetch agent info for the ready page
  useEffect(() => {
    if (isReadyState && activeAgentId) {
      fetch(getApiUrl(`/api/agent/${activeAgentId}`))
        .then((r) => r.json())
        .then((d) => setReadyAgentInfo(d))
        .catch(() => {});
    }
  }, [isReadyState, activeAgentId]);

  const totalResources = uploadedFilesList.length + ingestedUrlsList.length;

  // ── CONFIG PARSER ─────────────────────────────────────────────────────────────
  /**
   * Called after every single assistant message.
   * 1) If a full <config>…</config> block is present, parse it fully.
   * 2) Otherwise, apply incremental heuristics to extract individual fields.
   * Each field update also triggers a 150ms fade-in animation on the right panel.
   */
  const parseConfigFromMessage = (text: string) => {
    // ── 1. Full <config> block ────────────────────────────────────────────────
    const configMatch = text.match(/<config>([\s\S]*?)<\/config>/);
    if (configMatch) {
      try {
        const parsed = JSON.parse(configMatch[1].trim());
        if (parsed.business_name && parsed.business_name !== businessName) {
          setBusinessName(parsed.business_name);
          triggerAnim("business_name");
        }
        if (parsed.business_type && parsed.business_type !== businessType) {
          setBusinessType(parsed.business_type);
          triggerAnim("business_type");
        }
        if (
          parsed.primary_language &&
          parsed.primary_language !== primaryLanguage
        ) {
          setPrimaryLanguage(parsed.primary_language);
          triggerAnim("primary_language");
        }
        if (parsed.greeting && parsed.greeting !== greeting) {
          setGreeting(parsed.greeting);
          triggerAnim("greeting");
        }
        if (parsed.restrictions) setRestrictions(parsed.restrictions);
        if (Array.isArray(parsed.top_faqs)) setTopFaqs(parsed.top_faqs);
        return;
      } catch {
        // Malformed JSON — regex fallback on the raw block
        const nm = configMatch[1].match(/"business_name"\s*:\s*"([^"]+)"/);
        const tm = configMatch[1].match(/"business_type"\s*:\s*"([^"]+)"/);
        const lm = configMatch[1].match(/"primary_language"\s*:\s*"([^"]+)"/);
        const gm = configMatch[1].match(/"greeting"\s*:\s*"([^"]+)"/);
        const rm = configMatch[1].match(/"restrictions"\s*:\s*"([^"]+)"/);
        if (nm && nm[1] !== businessName) { setBusinessName(nm[1]); triggerAnim("business_name"); }
        if (tm && tm[1] !== businessType) { setBusinessType(tm[1]); triggerAnim("business_type"); }
        if (lm && lm[1] !== primaryLanguage) { setPrimaryLanguage(lm[1]); triggerAnim("primary_language"); }
        if (gm && gm[1] !== greeting) { setGreeting(gm[1]); triggerAnim("greeting"); }
        if (rm) setRestrictions(rm[1]);
        return;
      }
    }

    // ── 2. Incremental heuristics (no <config> yet) ───────────────────────────
    const low = text.toLowerCase();

    // Business name: detect confirmation phrases like "Got it, Yashoda Hospitals!"
    if (!businessName) {
      const namePatterns = [
        /(?:got it[,!]\s*|great[,!]\s*|perfect[,!]\s*|wonderful[,!]\s*|noted[,!]\s*|love it[,!]\s*)([A-Z][A-Za-z0-9\s&'.\-]{1,50})(?:\s*(?:is a|sounds|—|!|,|\.))/,
        /(?:so\s+)([A-Z][A-Za-z0-9\s&'.\-]{1,50})\s+(?:is a|will be|sounds like)/,
      ];
      for (const p of namePatterns) {
        const m = text.match(p);
        if (m?.[1]) {
          const candidate = m[1].trim().replace(/[.,!]$/, "");
          if (candidate.length > 2 && candidate.length < 60) {
            setBusinessName(candidate);
            triggerAnim("business_name");
            break;
          }
        }
      }
    }

    // Business type: keyword matching
    if (!businessType) {
      const hasConfirmation = /(?:got it|great|perfect|wonderful|noted|sounds|sure|cool|lovely)/i.test(low);
      if (hasConfirmation) {
        const types: [string, string][] = [
          ["restaurant", "Restaurant"],
          ["hotel", "Hotel"],
          ["clinic", "Medical Clinic"],
          ["hospital", "Hospital"],
          ["pharmacy", "Pharmacy"],
          ["shop", "Retail Shop"],
          ["store", "Retail Store"],
          ["salon", "Salon & Beauty"],
          ["bakery", "Bakery"],
          ["café", "Café"],
          ["cafe", "Café"],
          ["gym", "Gym / Fitness"],
          ["school", "School"],
          ["college", "Educational Institution"],
          ["laundry", "Laundry Service"],
          ["supermarket", "Supermarket"],
          ["electronics", "Electronics Shop"],
        ];
        for (const [kw, label] of types) {
          if (low.includes(kw)) {
            setBusinessType(label);
            triggerAnim("business_type");
            break;
          }
        }
      }
    }

    // Primary language: keyword matching
    if (!primaryLanguage) {
      const hasConfirmation = /(?:got it|great|perfect|wonderful|noted|sounds|sure|cool|speak|use|language)/i.test(low);
      if (hasConfirmation) {
        const langs: [string, string][] = [
          ["telugu", "Telugu (te-IN)"],
          ["hindi", "Hindi (hi-IN)"],
          ["tamil", "Tamil (ta-IN)"],
          ["kannada", "Kannada (kn-IN)"],
          ["malayalam", "Malayalam (ml-IN)"],
          ["english", "English (en-IN)"],
          ["marathi", "Marathi (mr-IN)"],
          ["bengali", "Bengali (bn-IN)"],
          ["gujarati", "Gujarati (gu-IN)"],
          ["punjabi", "Punjabi (pa-IN)"],
          ["odia", "Odia (or-IN)"],
          ["assamese", "Assamese (as-IN)"],
        ];
        for (const [lang, label] of langs) {
          if (low.includes(lang)) {
            setPrimaryLanguage(label);
            triggerAnim("primary_language");
            break;
          }
        }
      }
    }

    // Greeting: detect quoted welcome messages in assistant confirmation
    if (!greeting) {
      const greetPatterns = [
        /[""]([^"""]{10,120})[""]/, // any quoted string 10-120 chars
        /greet(?:ing)?\s+(?:like|as|would be)[^"]*[""]([^"""]{10,120})[""]/i,
      ];
      for (const p of greetPatterns) {
        const m = text.match(p);
        if (
          m?.[1] &&
          (m[1].toLowerCase().includes("welcome") ||
            m[1].toLowerCase().includes("namaste") ||
            m[1].toLowerCase().includes("hello") ||
            m[1].toLowerCase().includes("help"))
        ) {
          setGreeting(m[1]);
          triggerAnim("greeting");
          break;
        }
      }
    }
  };

  // ── ONBOARDING CHAT HELPERS ───────────────────────────────────────────────────
  const injectAIMessage = (content: string) => {
    setConversationHistory((prev) => [
      ...prev,
      { role: "assistant" as const, content },
    ]);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `ai-${Date.now()}`,
        role: "assistant" as const,
        content,
        type: "text" as const,
      },
    ]);
  };

  const injectUploadWidget = () => {
    const introText =
      "Great! Now let's teach your agent about your business. Upload your menu, price list, or any PDF your customers would ask about. You can also paste your website URL.";
    setConversationHistory((prev) => [
      ...prev,
      { role: "assistant" as const, content: introText },
    ]);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `ai-upload-intro-${Date.now()}`,
        role: "assistant" as const,
        content: introText,
        type: "text" as const,
      },
      {
        id: `widget-${Date.now()}`,
        role: "system" as const,
        content: "",
        type: "upload-widget" as const,
      },
    ]);
  };

  // ── ONBOARDING SEND MESSAGE ───────────────────────────────────────────────────
  const handleSendChatMessage = async (customText?: string) => {
    const textToSend =
      customText !== undefined ? customText : chatInput.trim();
    if (!textToSend) return;
    if (customText === undefined) setChatInput("");

    const userMsg: ConversationTurn = { role: "user", content: textToSend };
    const userBubble: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: textToSend,
      type: "text",
    };
    const newHistory = [...conversationHistory, userMsg];

    setConversationHistory(newHistory);
    setChatMessages((prev) => [...prev, userBubble]);
    setIsAiTyping(true);

    try {
      // ── Handle post-config shortcuts ────────────────────────────────────────
      if (isConfigDone) {
        const low = textToSend.toLowerCase().trim();
        const isDone = ["no", "done", "that's all", "nothing else", "deploy", "finish", "that's it"].some(
          (k) => low.includes(k)
        );
        const isMore = ["yes", "add another", "yes please", "sure", "more"].some(
          (k) => low.includes(k)
        );

        if (isDone) {
          setTimeout(() => {
            setIsAiTyping(false);
            const endText =
              "Perfect. Your agent is fully set up. Here's a summary of what I've configured for you:";
            setConversationHistory((prev) => [
              ...prev,
              { role: "assistant" as const, content: endText },
            ]);
            setChatMessages((prev) => [
              ...prev,
              {
                id: `ai-end-${Date.now()}`,
                role: "assistant" as const,
                content: endText,
                type: "text" as const,
              },
              {
                id: `summary-${Date.now()}`,
                role: "system" as const,
                content: "",
                type: "summary-card" as const,
              },
            ]);
          }, 1200);
          return;
        }

        if (isMore) {
          setTimeout(() => {
            setIsAiTyping(false);
            const repeatText =
              "Sure, go ahead! You can upload another document or enter another URL:";
            setConversationHistory((prev) => [
              ...prev,
              { role: "assistant" as const, content: repeatText },
            ]);
            setChatMessages((prev) => [
              ...prev,
              {
                id: `ai-rep-${Date.now()}`,
                role: "assistant" as const,
                content: repeatText,
                type: "text" as const,
              },
              {
                id: `widget-${Date.now()}`,
                role: "system" as const,
                content: "",
                type: "upload-widget" as const,
              },
            ]);
          }, 1000);
          return;
        }
      }

      // ── Call AI proxy ─────────────────────────────────────────────────────────
      const response = await fetch(getApiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: `You are an onboarding assistant helping a non-technical Indian business owner set up their AI voice agent. Your job is to ask them short, friendly questions one at a time — like a consultant would — to understand their business deeply enough to configure a voice agent for them.

Ask questions in this order, one at a time, waiting for each answer:
1. What is the name of your business?
2. What kind of business is it? (restaurant, clinic, shop, etc.)
3. What language do your customers usually speak with you?
4. What are the top 3 things customers usually ask you about?
5. How do you want the agent to greet customers?
6. Is there anything the agent should never say or do?

After all 6 answers, FIRST output the JSON config block wrapped in <config></config> tags:
<config>
{
  "business_name": "...",
  "business_type": "...",
  "primary_language": "...",
  "top_faqs": ["...", "...", "..."],
  "greeting": "...",
  "restrictions": "..."
}
</config>

THEN, based on what you learned about their business, recommend relevant tools/integrations that would help their voice agent. Choose from these available connectors:
- "calendar" — Google Calendar (for appointment-based businesses like clinics, salons, hospitals, consultants)
- "whatsapp" — WhatsApp / Twilio (for customer notifications, order updates, confirmations)
- "shopify" — Shopify / Catalog (for businesses selling products — shops, restaurants with menus, e-commerce)
- "hubspot" — HubSpot / CRM (for businesses tracking leads and customer relationships)

Output your recommendations as a <tools> tag listing relevant tool IDs, like:
<tools>calendar,whatsapp</tools>

Then write a brief, friendly message like:
"Based on your business, I'd recommend connecting Google Calendar for appointment booking and WhatsApp for customer notifications. Would you like to enable these?"

If the user says yes/sure/okay to the tool suggestions, output:
<enable_tools>calendar,whatsapp</enable_tools>
with whatever tools they agreed to.

Keep every message under 2 sentences. Be warm and conversational. Use simple English. Never ask two questions at once.`,
          messages: newHistory,
        }),
      });

      if (!response.ok) throw new Error("Proxy response failed");
      const data = await response.json();
      const rawText = data.content?.[0]?.text || "";

      // Parse every assistant response for field updates
      parseConfigFromMessage(rawText);

      // Parse tool suggestions — auto-highlight recommended connectors
      const toolsSuggestMatch = rawText.match(/<tools>([\s\S]*?)<\/tools>/);
      if (toolsSuggestMatch) {
        const suggested = toolsSuggestMatch[1].split(",").map((t: string) => t.trim().toLowerCase());
        // Visually highlight suggested tools (but don't fully connect yet — wait for user confirmation)
        if (suggested.includes("calendar")) { setIsCalendarConnected(false); setShowConfigFor("calendar"); }
        if (suggested.includes("whatsapp")) { setIsTwilioConnected(false); setShowConfigFor("twilio"); }
        if (suggested.includes("shopify")) { setIsShopifyConnected(false); setShowConfigFor("shopify"); }
        if (suggested.includes("hubspot")) { setIsHubspotConnected(false); setShowConfigFor("hubspot"); }
      }

      // Parse tool enablement — user confirmed, auto-connect
      const enableMatch = rawText.match(/<enable_tools>([\s\S]*?)<\/enable_tools>/);
      if (enableMatch) {
        const enabled = enableMatch[1].split(",").map((t: string) => t.trim().toLowerCase());
        if (enabled.includes("calendar")) { setIsCalendarConnected(true); showToast("📅 Google Calendar connected!", "success"); }
        if (enabled.includes("whatsapp")) { setIsTwilioConnected(true); showToast("💬 WhatsApp connected!", "success"); }
        if (enabled.includes("shopify")) { setIsShopifyConnected(true); showToast("🛍️ Shopify connected!", "success"); }
        if (enabled.includes("hubspot")) { setIsHubspotConnected(true); showToast("🔗 HubSpot connected!", "success"); }
      }

      // Strip <config>, <tools>, and <enable_tools> blocks from the displayed message
      const cleanText = rawText
        .replace(/<config>[\s\S]*?<\/config>/g, "")
        .replace(/<tools>[\s\S]*?<\/tools>/g, "")
        .replace(/<enable_tools>[\s\S]*?<\/enable_tools>/g, "")
        .trim();

      setConversationHistory((prev) => [
        ...prev,
        { role: "assistant" as const, content: cleanText },
      ]);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: "assistant" as const,
          content: cleanText,
          type: "text" as const,
        },
      ]);

      // Trigger upload widget after config is complete
      if (rawText.includes("<config>")) {
        setIsConfigDone(true);
        setTimeout(() => injectUploadWidget(), 1200);
      }
    } catch (e) {
      console.error(e);
      showToast("I'm having trouble responding right now. Let me try again.", "error");
    } finally {
      setIsAiTyping(false);
    }
  };

  // ── UPLOAD HANDLERS ───────────────────────────────────────────────────────────
  const handleDocumentWidgetUploaded = (fileName: string, fileId?: string) => {
    if (uploadedFilesList.includes(fileName)) return;
    setUploadedFilesList((prev) => [...prev, fileName]);
    if (fileId) setUploadedResourceIds((prev) => [...prev, fileId]);
    setIsAiTyping(true);
    setTimeout(() => {
      setIsAiTyping(false);
      injectAIMessage(
        "Got it! Added to your agent's knowledge base. Anything else to add — another document or link?"
      );
    }, 1500);
  };

  const handleDocumentWidgetUrlAdded = (url: string) => {
    if (ingestedUrlsList.includes(url)) return;
    setIngestedUrlsList((prev) => [...prev, url]);
    setIsAiTyping(true);
    setTimeout(() => {
      setIsAiTyping(false);
      injectAIMessage(
        "Got it! Added to your agent's knowledge base. Anything else to add — another document or link?"
      );
    }, 1200);
  };

  const handleRemoveUrl = (url: string) => {
    setIngestedUrlsList((prev) => prev.filter((u) => u !== url));
  };

  const uploadPdfFile = async (file: File) => {
    // Validate size
    if (file.size > 10 * 1024 * 1024) {
      showToast("File size exceeded. PDF must be under 10MB.", "error");
      return;
    }
    // Validate file type — inject AI response on unsupported format
    if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
      injectAIMessage(
        "I can only read PDF files right now. Do you have a PDF version?"
      );
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(getApiUrl("/api/upload"), {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      const data = await response.json();
      handleDocumentWidgetUploaded(file.name, data.resource_id || data.file_id);
    } catch {
      injectAIMessage(
        "That didn't upload correctly. Try again or paste a URL instead."
      );
    } finally {
      setIsUploading(false);
    }
  };

  // ── DEPLOY HANDLER ────────────────────────────────────────────────────────────
  const handleDeployAgentConversational = async () => {
    if (!businessName) {
      showToast("A business name is required to deploy.", "error");
      return;
    }
    setIsDeploying(true);
    try {
      const response = await fetch(getApiUrl("/api/config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: businessName,
          business_type: businessType || "General",
          primary_language: primaryLanguage || "en-IN",
          greeting: greeting || "Namaste, how can I help you?",
          restrictions: restrictions || "",
          top_faqs: topFaqs.length > 0 ? topFaqs : ["General inquiry"],
          resource_ids: [...uploadedResourceIds],
        }),
      });
      if (!response.ok) throw new Error("Failed to configure agent runtime.");
      const data = await response.json();
      showToast("AI voice agent successfully built and deployed!", "success");
      navigate(`/agent/${data.agent_id}/ready`);
    } catch {
      showToast("Configuration failed. Please review your details and try again.", "error");
    } finally {
      setIsDeploying(false);
    }
  };

  // ── CLIPBOARD HELPER ──────────────────────────────────────────────────────────
  const copyToClipboard = (text: string, onSuccess?: () => void) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast("Copied to clipboard!", "success");
      onSuccess?.();
    }).catch(() => showToast("Failed to copy. Please copy manually.", "error"));
  };

  // ── TALK PAGE STATE ───────────────────────────────────────────────────────────
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [micStatus, setMicStatus] = useState<
    "Tap to speak" | "Listening..." | "Thinking..." | "Speaking..."
  >("Tap to speak");
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [keyboardQuery, setKeyboardQuery] = useState("");
  const [isKeyboardSubmitting, setIsKeyboardSubmitting] = useState(false);
  const [chatTurns, setChatTurns] = useState<VoiceTurn[]>([]);

  const activeAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const talkChatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    talkChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatTurns]);

  useEffect(() => {
    if (isAgentView && activeAgentId) fetchAgentDetails(activeAgentId);
    return () => stopAndCleanupPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAgentView, activeAgentId]);

  const fetchAgentDetails = async (agentId: string) => {
    setIsAgentLoading(true);
    try {
      const response = await fetch(getApiUrl(`/api/agent/${agentId}`));
      if (!response.ok) throw new Error("Failed");
      const data = await response.json();
      setAgentInfo(data);
    } catch {
      showToast("Something went wrong. Try again.", "error");
    } finally {
      setIsAgentLoading(false);
    }
  };

  const stopAndCleanupPlayback = () => {
    if (activeAudioSourceRef.current) {
      try { activeAudioSourceRef.current.stop(); } catch {}
      activeAudioSourceRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }
  };

  const playVoiceBlob = async (blob: Blob) => {
    try {
      stopAndCleanupPlayback();
      setMicStatus("Speaking...");
      const arrayBuffer = await blob.arrayBuffer();
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      activeAudioSourceRef.current = source;
      source.onended = () => setMicStatus("Tap to speak");
      source.start(0);
    } catch {
      showToast("Audio playback failed.", "error");
      setMicStatus("Tap to speak");
    }
  };

  const requestMediaStream = async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermissionDenied(false);
      return stream;
    } catch {
      setMicPermissionDenied(true);
      showToast("Please allow microphone access to use VoiceForge", "error");
      return null;
    }
  };

  const handleMicStart = async (e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    if (micStatus === "Thinking..." || micStatus === "Speaking...") return;
    const stream = await requestMediaStream();
    if (!stream) return;

    streamRef.current = stream;
    setMicStatus("Listening...");
    recordedChunksRef.current = [];

    let mimeOptions: MediaRecorderOptions = {};
    if (MediaRecorder.isTypeSupported("audio/webm"))
      mimeOptions = { mimeType: "audio/webm" };
    else if (MediaRecorder.isTypeSupported("audio/mp4"))
      mimeOptions = { mimeType: "audio/mp4" };

    try {
      const mr = new MediaRecorder(stream, mimeOptions);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data?.size > 0) recordedChunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        setMicStatus("Thinking...");
        const blob = new Blob(recordedChunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        await processAudioFlow(blob);
      };
      mr.start();
    } catch {
      showToast("Something went wrong. Try again.", "error");
      setMicStatus("Tap to speak");
    }
  };

  const handleMicStop = (e?: MouseEvent | TouchEvent) => {
    if (e) e.preventDefault();
    if (mediaRecorderRef.current?.state === "recording")
      mediaRecorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // ── VOICE PIPELINE ────────────────────────────────────────────────────────────
  const processAudioFlow = async (audioBlob: Blob) => {
    try {
      // 1. STT
      const fd = new FormData();
      // Determine extension from blob mime type for Sarvam format detection
      const ext = audioBlob.type.includes("mp4") ? "mp4" : "webm";
      fd.append("audio", audioBlob, `recording.${ext}`);
      fd.append("agent_id", activeAgentId || "demo123");
      const sttRes = await fetch(getApiUrl("/api/stt"), {
        method: "POST",
        body: fd,
      });
      if (!sttRes.ok) throw new Error("STT failed");
      const { text, source_lang } = await sttRes.json();

      // 2. Append user turn
      setChatTurns((prev) => [...prev, { role: "user", text, lang: source_lang }]);

      // 3. Query + enrich + TTS
      await submitTextQuery(text, source_lang);
    } catch {
      showToast("Something went wrong. Tap to try again.", "error");
      setMicStatus("Tap to speak");
    }
  };

  const submitTextQuery = async (text: string, language: string) => {
    try {
      setMicStatus("Thinking...");
      const last4 = chatTurns.slice(-4);

      // 4. Query RAG
      const qRes = await fetch(getApiUrl("/api/query"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          source_lang: language,
          agent_id: activeAgentId || "demo123",
          history: last4,
        }),
      });
      if (!qRes.ok) throw new Error("Query failed");
      let { answer_text } = await qRes.json();

      // 5. AI enrichment — append one natural follow-up question
      try {
        const enrichRes = await fetch(getApiUrl("/api/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system: `You are a voice assistant for ${agentInfo?.business_name || "this business"}. Take the answer and append ONE short natural follow-up question. Max 2 sentences. Respond in the same language as the answer — if Telugu respond in Telugu, if Hindi respond in Hindi.`,
            messages: [
              {
                role: "user",
                content: `Answer: ${answer_text}. Append a follow-up question.`,
              },
            ],
          }),
        });
        if (enrichRes.ok) {
          const enrichData = await enrichRes.json();
          const enriched = enrichData.content?.[0]?.text;
          if (enriched) answer_text = enriched;
        }
      } catch {
        /* enrichment failed — use original answer_text */
      }

      // 6. Append agent turn
      setChatTurns((prev) => [...prev, { role: "agent", text: answer_text }]);

      // 7. TTS
      const ttsRes = await fetch(getApiUrl("/api/tts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answer_text, source_lang: language, agent_id: activeAgentId || "demo123" }),
      });
      if (!ttsRes.ok) throw new Error("TTS failed");

      // 8. Play audio
      await playVoiceBlob(await ttsRes.blob());
    } catch {
      showToast("Something went wrong. Tap to try again.", "error");
      setMicStatus("Tap to speak");
    }
  };

  const handleKeyboardSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !keyboardQuery.trim() ||
      micStatus === "Thinking..." ||
      micStatus === "Speaking..."
    )
      return;
    const query = keyboardQuery.trim();
    setKeyboardQuery("");
    setChatTurns((prev) => [...prev, { role: "user", text: query, lang: "en-US" }]);
    setIsKeyboardSubmitting(true);
    await submitTextQuery(query, "en-US");
    setIsKeyboardSubmitting(false);
  };

  // ─── JSX ───────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans overflow-x-hidden antialiased">
      {/* Global CSS injections */}
      <style>{`
        @keyframes wave-pulse {
          0%, 100% { height: 8px; }
          50% { height: 38px; }
        }
        .visualizer-bar {
          animation: wave-pulse 0.7s ease-in-out infinite;
        }
        @keyframes fadeInField {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .field-fade-in {
          animation: fadeInField 150ms ease-out forwards;
        }
      `}</style>

      {/* ── Toast (bottom-center) ──────────────────────────────────────────────── */}
      {toast && (
        <div
          id="toast-notification"
          className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm transition-all duration-300 whitespace-nowrap ${
            toast.type === "success"
              ? "bg-emerald-50 text-emerald-900 border-emerald-200"
              : toast.type === "error"
              ? "bg-rose-50 text-rose-900 border-rose-200"
              : "bg-slate-800 text-white border-slate-700"
          }`}
        >
          {toast.type === "error" ? (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          PAGE: AGENT READY  (/agent/[id]/ready)
      ════════════════════════════════════════════════════════════════════════ */}
      {isReadyState && (
        <div
          id="page-ready"
          className="w-full min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center px-6 py-12"
        >
          <div className="w-full max-w-[460px] flex flex-col gap-8">
            {/* Header */}
            <div>
              <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs font-semibold border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </div>
              <h1
                className="text-[28px] font-medium text-white leading-tight"
                style={{ fontSize: "28px", fontWeight: 500 }}
              >
                Your agent is live
              </h1>
              {readyAgentInfo?.business_name && (
                <p className="mt-1.5 text-zinc-400 text-sm">
                  {readyAgentInfo.business_name}
                </p>
              )}
            </div>

            {/* URL card */}
            <div className="bg-[#111] border border-white/10 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2.5 font-medium">
                Live Agent URL
              </p>
              <div className="flex items-center gap-3">
                <code className="flex-1 font-mono text-sm text-zinc-200 bg-[#0a0a0a] border border-white/5 rounded-lg px-3 py-2 truncate">
                  voiceforge.app/agent/{activeAgentId}
                </code>
                <button
                  id="btn-copy-url"
                  onClick={() =>
                    copyToClipboard(
                      `voiceforge.app/agent/${activeAgentId}`,
                      () => {
                        setReadyCopied(true);
                        setTimeout(() => setReadyCopied(false), 2000);
                      }
                    )
                  }
                  className="shrink-0 p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all cursor-pointer"
                  title="Copy agent link"
                >
                  {readyCopied ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-zinc-400" />
                  )}
                </button>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              <button
                id="btn-talk-agent"
                onClick={() => navigate(`/agent/${activeAgentId}/talk`)}
                className="w-full flex items-center justify-center gap-2 bg-white text-black py-3.5 px-4 rounded-lg text-sm font-semibold hover:bg-zinc-100 transition-all cursor-pointer"
              >
                <Mic className="w-4 h-4" />
                Talk to your agent
              </button>
              <button
                id="btn-share-agent"
                onClick={() =>
                  copyToClipboard(`voiceforge.app/agent/${activeAgentId}`)
                }
                className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 py-3.5 px-4 rounded-lg text-sm font-medium transition-all cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                Share agent link
              </button>
            </div>

            <p className="text-center text-[10px] text-zinc-700 mt-2">
              Agent ID:{" "}
              <span className="font-mono text-zinc-600">{activeAgentId}</span>
            </p>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          PAGE: BUILDER  (/ or /builder)
      ════════════════════════════════════════════════════════════════════════ */}
      {!isAgentViewState && (
        <div
          id="page-builder"
          className="w-full min-h-screen flex flex-col justify-between py-6 px-4 bg-slate-50 font-sans"
        >
          <div className="w-full max-w-7xl mx-auto flex-1 flex flex-col">
            {/* Header */}
            <header className="mb-6 flex items-center justify-between border-b border-slate-200 pb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-slate-900 text-white p-2 rounded-xl flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-amber-300" />
                </div>
                <div>
                  <h1 className="text-xl font-black text-slate-900 tracking-tight">
                    VoiceClaw
                  </h1>
                  <p className="text-xs text-slate-500">
                    Deploy automated telephone receptionists with live
                    conversational setup
                  </p>
                </div>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-[#0c0c0c] bg-slate-200 px-3 py-1 rounded-full">
                No-code Platform v2.0
              </span>
            </header>

            {/* Mobile collapsible config */}
            {isConfigDone && (
              <div className="block md:hidden border border-slate-200 bg-white shadow-sm p-4 rounded-xl mb-4 shrink-0">
                <button
                  onClick={() =>
                    setIsMobileConfigExpanded(!isMobileConfigExpanded)
                  }
                  className="w-full flex items-center justify-between text-xs font-bold text-slate-700 uppercase"
                >
                  <span className="flex items-center gap-1.5 font-bold">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    Agent Settings
                  </span>
                  <span>{isMobileConfigExpanded ? "Hide ▲" : "Show ▼"}</span>
                </button>
                {isMobileConfigExpanded && (
                  <div className="mt-4 space-y-3 pt-4 border-t border-slate-100 text-xs">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Business Name</p>
                      <p className="text-sm font-semibold">{businessName || "Not set yet"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Business Type</p>
                      <p>{businessType || "Not set yet"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Language</p>
                      <p>{primaryLanguage || "Not set yet"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Greeting</p>
                      <p className="italic">"{greeting || "Namaste, how can I help you?"}"</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Main 10-column grid */}
            <div className="grid grid-cols-1 md:grid-cols-10 gap-6 flex-1 min-h-0">

              {/* ── CHAT WINDOW (6 cols / 60%) ──────────────────────────────── */}
              <div
                id="chat-window-pane"
                className="col-span-1 md:col-span-6 bg-white border border-slate-200 rounded-2xl flex flex-col shadow-sm h-[680px] overflow-hidden"
              >
                {/* Chat header */}
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
                    <span className="text-sm font-semibold text-slate-800">
                      Agent Configuration Assistant
                    </span>
                  </div>
                  <span className="text-xs font-mono text-slate-400">
                    Live setup connection
                  </span>
                </div>

                {/* Messages stream */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/40 select-text">
                  {chatMessages.map((msg) => {
                    // ── User bubble ────────────────────────────────────────────
                    if (msg.role === "user") {
                      return (
                        <div key={msg.id} className="flex justify-end">
                          <div className="max-w-[75%] bg-slate-900 text-white px-4 py-3 rounded-2xl rounded-tr-none text-sm shadow-sm">
                            {msg.content}
                          </div>
                        </div>
                      );
                    }

                    // ── Upload widget ──────────────────────────────────────────
                    if (msg.type === "upload-widget") {
                      return (
                        <div
                          key={msg.id}
                          className={`bg-white border-2 p-5 rounded-2xl space-y-4 max-w-sm my-2 shadow-md transition-colors ${
                            isDragOver
                              ? "border-slate-700 bg-slate-50"
                              : "border-slate-200"
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragOver(true);
                          }}
                          onDragLeave={() => setIsDragOver(false)}
                          onDrop={async (e) => {
                            e.preventDefault();
                            setIsDragOver(false);
                            const file = e.dataTransfer.files?.[0];
                            if (!file) return;
                            await uploadPdfFile(file);
                          }}
                        >
                          {/* Widget header */}
                          <div className="flex items-center gap-2 text-slate-800 font-bold text-xs uppercase tracking-wider pb-1.5 border-b border-slate-100">
                            <FileText className="w-4 h-4 text-slate-500" />
                            <span>Business Knowledge Source</span>
                          </div>

                          {/* Drop zone */}
                          <div className="relative border border-dashed border-slate-300 hover:border-slate-700 bg-slate-50/50 p-4 rounded-xl transition-all cursor-pointer text-center group">
                            <input
                              type="file"
                              accept=".pdf"
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) await uploadPdfFile(file);
                                e.target.value = "";
                              }}
                            />
                            {isUploading ? (
                              <div className="flex flex-col items-center gap-2 py-1">
                                <Loader2 className="w-7 h-7 text-slate-400 animate-spin" />
                                <p className="text-xs text-slate-500">
                                  Uploading...
                                </p>
                              </div>
                            ) : (
                              <>
                                <FileUp className="w-8 h-8 text-slate-400 mx-auto group-hover:scale-110 transition-transform duration-200" />
                                <p className="text-xs font-semibold text-slate-800 mt-2">
                                  Drop PDF here or click to browse
                                </p>
                                <p className="text-[10px] text-slate-400 mt-0.5">
                                  PDF only · max 10MB
                                </p>
                              </>
                            )}
                          </div>

                          {/* Uploaded files */}
                          {uploadedFilesList.map((f, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 px-2.5 py-1.5 bg-emerald-50 border border-emerald-100 rounded-lg"
                            >
                              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span className="text-xs font-medium text-emerald-800 truncate flex-1">
                                {f}
                              </span>
                            </div>
                          ))}

                          {/* URL input */}
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
                              Or paste a website URL
                            </label>
                            <div className="flex gap-1.5">
                              <input
                                type="url"
                                id="widget-url-input"
                                placeholder="https://mybusiness.com"
                                className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 bg-slate-50"
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter") {
                                    const val = e.currentTarget.value.trim();
                                    if (!val) return;
                                    setIsIngestingUrl(true);
                                    try {
                                      const res = await fetch(
                                        getApiUrl("/api/ingest-url"),
                                        {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ url: val }),
                                        }
                                      );
                                      if (!res.ok) throw new Error();
                                      handleDocumentWidgetUrlAdded(val);
                                      e.currentTarget.value = "";
                                    } catch {
                                      showToast("Failed to ingest URL.", "error");
                                    } finally {
                                      setIsIngestingUrl(false);
                                    }
                                  }
                                }}
                              />
                              <button
                                onClick={async () => {
                                  const el = document.getElementById(
                                    "widget-url-input"
                                  ) as HTMLInputElement;
                                  const val = el?.value.trim();
                                  if (!val) return;
                                  setIsIngestingUrl(true);
                                  try {
                                    const res = await fetch(
                                      getApiUrl("/api/ingest-url"),
                                      {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ url: val }),
                                      }
                                    );
                                    if (!res.ok) throw new Error();
                                    handleDocumentWidgetUrlAdded(val);
                                    if (el) el.value = "";
                                  } catch {
                                    showToast("Failed to ingest URL.", "error");
                                  } finally {
                                    setIsIngestingUrl(false);
                                  }
                                }}
                                className="px-3 bg-[#0a0a0a] hover:bg-black text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shrink-0 py-2"
                              >
                                {isIngestingUrl ? "..." : "Add"}
                              </button>
                            </div>

                            {/* URL pill tags (removable) */}
                            {ingestedUrlsList.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {ingestedUrlsList.map((url, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-indigo-50 text-indigo-800 rounded-full text-[10px] font-semibold border border-indigo-100 max-w-[220px]"
                                  >
                                    <Globe className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
                                    <span className="truncate">
                                      {url.replace(/^https?:\/\//, "")}
                                    </span>
                                    <button
                                      onClick={() => handleRemoveUrl(url)}
                                      className="ml-0.5 p-0.5 hover:bg-indigo-100 rounded-full transition-colors cursor-pointer"
                                      title="Remove URL"
                                    >
                                      <X className="w-2.5 h-2.5 text-indigo-500" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* "Done adding" button — appears once at least 1 resource added */}
                          {totalResources > 0 && (
                            <button
                              onClick={() => handleSendChatMessage("done")}
                              className="w-full py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-400 rounded-lg transition-all cursor-pointer"
                            >
                              Done adding ✓
                            </button>
                          )}
                        </div>
                      );
                    }

                    // ── Summary card ───────────────────────────────────────────
                    if (msg.type === "summary-card") {
                      return (
                        <div
                          key={msg.id}
                          className="bg-slate-900 text-white rounded-2xl p-5 my-2 space-y-4 max-w-sm self-start shadow-xl border border-slate-800"
                        >
                          <div className="flex items-center gap-2 pb-2.5 border-b border-white/10">
                            <Sparkles className="w-5 h-5 text-amber-300 shrink-0 animate-pulse" />
                            <span className="font-extrabold text-sm uppercase tracking-wider text-amber-50">
                              Final Agent Configuration
                            </span>
                          </div>

                          <div className="space-y-3 text-xs text-slate-200">
                            <div>
                              <p className="text-[9px] uppercase font-bold tracking-widest text-slate-400 mb-0.5">Business Name</p>
                              <p className="text-sm font-bold text-white">{businessName || "Not set"}</p>
                            </div>
                            <div>
                              <p className="text-[9px] uppercase font-bold tracking-widest text-slate-400 mb-0.5">Business Category</p>
                              <p>{businessType || "Not set"}</p>
                            </div>
                            <div>
                              <p className="text-[9px] uppercase font-bold tracking-widest text-slate-400 mb-0.5">Primary Language</p>
                              <p>{primaryLanguage || "Not set"}</p>
                            </div>
                            <div>
                              <p className="text-[9px] uppercase font-bold tracking-widest text-slate-400 mb-0.5">Welcome Greeting</p>
                              <p className="text-amber-100 italic">"{greeting || "Namaste, how can I help you?"}"</p>
                            </div>
                            {topFaqs.length > 0 && (
                              <div>
                                <p className="text-[9px] uppercase font-bold tracking-widest text-slate-400 mb-0.5">Top FAQs</p>
                                <ul className="list-disc list-inside space-y-0.5 text-slate-300 text-[11px]">
                                  {topFaqs.map((faq, i) => (
                                    <li key={i} className="truncate">{faq}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {restrictions && (
                              <div>
                                <p className="text-[9px] uppercase font-bold tracking-widest text-slate-400 mb-0.5">Guardrails</p>
                                <p className="text-slate-300 text-[11px]">{restrictions}</p>
                              </div>
                            )}
                            {totalResources > 0 && (
                              <div className="pt-2 border-t border-white/10">
                                <p className="text-slate-400 text-[11px]">
                                  Loaded {uploadedFilesList.length} doc
                                  {uploadedFilesList.length !== 1 ? "s" : ""} and{" "}
                                  {ingestedUrlsList.length} link
                                  {ingestedUrlsList.length !== 1 ? "s" : ""}.
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Deploy button — dark, 48px height, font-weight 500 */}
                          <button
                            type="button"
                            id="btn-deploy-agent"
                            onClick={handleDeployAgentConversational}
                            disabled={isDeploying}
                            style={{
                              height: "48px",
                              borderRadius: "8px",
                              fontWeight: 500,
                            }}
                            className="w-full flex items-center justify-center gap-2 bg-[#0f0f0f] hover:bg-black text-white text-sm transition-all cursor-pointer disabled:opacity-50 border border-white/10"
                          >
                            {isDeploying ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Deploying...
                              </>
                            ) : (
                              "Deploy my agent →"
                            )}
                          </button>
                        </div>
                      );
                    }

                    // ── Assistant text bubble ──────────────────────────────────
                    return (
                      <div key={msg.id} className="flex justify-start">
                        <div className="max-w-[75%] bg-white border border-slate-200/80 text-slate-900 px-4 py-3 rounded-2xl rounded-tl-none text-sm shadow-sm select-text leading-relaxed whitespace-pre-line">
                          {msg.content}
                        </div>
                      </div>
                    );
                  })}

                  {/* Typing indicator */}
                  {isAiTyping && (
                    <div className="flex justify-start items-center">
                      <div
                        id="bubble-typing-assistant"
                        className="bg-white border border-slate-200/80 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm flex items-center space-x-1.5"
                      >
                        <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat input */}
                <div className="p-3.5 border-t border-slate-200 bg-white flex items-center gap-2 shrink-0">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendChatMessage();
                    }}
                    className="w-full flex gap-2"
                  >
                    <input
                      type="text"
                      id="input-onboarding"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      disabled={isAiTyping}
                      placeholder="Type your response here..."
                      className="flex-grow px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                    />
                    <button
                      type="submit"
                      id="btn-onboarding-send"
                      disabled={isAiTyping || !chatInput.trim()}
                      className="p-3 bg-[#0f0f0f] text-white hover:bg-black rounded-xl transition-all cursor-pointer disabled:opacity-40 shrink-0"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </div>
              </div>

              {/* ── RIGHT PANEL: CONNECTORS & INTEGRATIONS ──────────────── */}
              <div
                id="connectors-panel"
                className="hidden md:flex md:col-span-4 bg-white border border-slate-200 rounded-2xl shadow-sm flex-col h-[680px] overflow-hidden"
              >
                {/* Panel Header */}
                <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-4 shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center shrink-0">
                      <Sliders className="w-4.5 h-4.5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white tracking-tight">
                        Connectors & Tools
                      </h3>
                      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-0.5">
                        Integrate your business stack
                      </p>
                    </div>
                  </div>
                </div>

                {/* Scrollable Connector Cards */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

                  {/* ─── Google Calendar ────────────────────────────────────── */}
                  <div className={`rounded-xl border transition-all duration-200 ${isCalendarConnected ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isCalendarConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                          <Calendar className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <p className="text-[13px] font-semibold text-slate-800">Google Calendar</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">Appointment booking & scheduling</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${isCalendarConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'}`} />
                        <button
                          onClick={() => { setIsCalendarConnected(!isCalendarConnected); if (!isCalendarConnected) setShowConfigFor('calendar'); }}
                          className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 cursor-pointer ${isCalendarConnected ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        >
                          <span className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${isCalendarConnected ? 'translate-x-[18px]' : ''}`} />
                        </button>
                      </div>
                    </div>
                    {/* Config Expand */}
                    {showConfigFor === 'calendar' && isCalendarConnected && (
                      <div className="px-4 pb-4 pt-1 border-t border-emerald-100">
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1.5">Calendar Email</label>
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={calendarEmail}
                            onChange={(e) => setCalendarEmail(e.target.value)}
                            placeholder="you@gmail.com"
                            className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all"
                          />
                          <button
                            onClick={() => { showToast("Google Calendar linked!", "success"); setShowConfigFor(null); }}
                            className="px-3 py-2 text-[11px] font-semibold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors cursor-pointer"
                          >
                            Link
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ─── WhatsApp / Twilio ──────────────────────────────────── */}
                  <div className={`rounded-xl border transition-all duration-200 ${isTwilioConnected ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isTwilioConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                          <Send className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <p className="text-[13px] font-semibold text-slate-800">WhatsApp / Twilio</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">SMS & WhatsApp notifications</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${isTwilioConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'}`} />
                        <button
                          onClick={() => { setIsTwilioConnected(!isTwilioConnected); if (!isTwilioConnected) setShowConfigFor('twilio'); }}
                          className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 cursor-pointer ${isTwilioConnected ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        >
                          <span className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${isTwilioConnected ? 'translate-x-[18px]' : ''}`} />
                        </button>
                      </div>
                    </div>
                    {showConfigFor === 'twilio' && isTwilioConnected && (
                      <div className="px-4 pb-4 pt-1 border-t border-emerald-100">
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1.5">WhatsApp Business Number</label>
                        <div className="flex gap-2">
                          <input
                            type="tel"
                            value={twilioPhone}
                            onChange={(e) => setTwilioPhone(e.target.value)}
                            placeholder="+91 98765 43210"
                            className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all"
                          />
                          <button
                            onClick={() => { showToast("WhatsApp connected!", "success"); setShowConfigFor(null); }}
                            className="px-3 py-2 text-[11px] font-semibold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors cursor-pointer"
                          >
                            Link
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ─── Shopify / Catalog ──────────────────────────────────── */}
                  <div className={`rounded-xl border transition-all duration-200 ${isShopifyConnected ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isShopifyConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                          <ShoppingBag className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <p className="text-[13px] font-semibold text-slate-800">Shopify / Catalog</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">Sync products & inventory</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${isShopifyConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'}`} />
                        <button
                          onClick={() => { setIsShopifyConnected(!isShopifyConnected); if (!isShopifyConnected) setShowConfigFor('shopify'); }}
                          className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 cursor-pointer ${isShopifyConnected ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        >
                          <span className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${isShopifyConnected ? 'translate-x-[18px]' : ''}`} />
                        </button>
                      </div>
                    </div>
                    {showConfigFor === 'shopify' && isShopifyConnected && (
                      <div className="px-4 pb-4 pt-1 border-t border-emerald-100">
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1.5">Shopify Store URL</label>
                        <div className="flex gap-2">
                          <input
                            type="url"
                            value={shopifyStoreUrl}
                            onChange={(e) => setShopifyStoreUrl(e.target.value)}
                            placeholder="your-store.myshopify.com"
                            className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all"
                          />
                          <button
                            onClick={() => { showToast("Shopify synced!", "success"); setShowConfigFor(null); }}
                            className="px-3 py-2 text-[11px] font-semibold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors cursor-pointer"
                          >
                            Sync
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ─── HubSpot / CRM ─────────────────────────────────────── */}
                  <div className={`rounded-xl border transition-all duration-200 ${isHubspotConnected ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isHubspotConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                          <Link className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <p className="text-[13px] font-semibold text-slate-800">HubSpot / CRM</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">Sync customer contacts</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${isHubspotConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'}`} />
                        <button
                          onClick={() => { setIsHubspotConnected(!isHubspotConnected); if (!isHubspotConnected) setShowConfigFor('hubspot'); }}
                          className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 cursor-pointer ${isHubspotConnected ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        >
                          <span className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${isHubspotConnected ? 'translate-x-[18px]' : ''}`} />
                        </button>
                      </div>
                    </div>
                    {showConfigFor === 'hubspot' && isHubspotConnected && (
                      <div className="px-4 pb-4 pt-1 border-t border-emerald-100">
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1.5">HubSpot API Key</label>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={hubspotApiKey}
                            onChange={(e) => setHubspotApiKey(e.target.value)}
                            placeholder="pat-na1-xxxxxxxx"
                            className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all"
                          />
                          <button
                            onClick={() => { showToast("HubSpot connected!", "success"); setShowConfigFor(null); }}
                            className="px-3 py-2 text-[11px] font-semibold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors cursor-pointer"
                          >
                            Connect
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ─── Add More Connector CTA ────────────────────────────── */}
                  <button className="w-full rounded-xl border-2 border-dashed border-slate-200 hover:border-slate-400 py-4 flex items-center justify-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-600 transition-all cursor-pointer group">
                    <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
                    Add Custom Integration
                  </button>
                </div>

                {/* Bottom status bar */}
                <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/80 shrink-0">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Active connectors</span>
                    <span className="font-bold text-slate-700">
                      {[isCalendarConnected, isTwilioConnected, isShopifyConnected, isHubspotConnected].filter(Boolean).length} / 4
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <footer className="w-full text-center text-xs text-slate-400 mt-12 pt-4 border-t border-slate-200 shrink-0">
            VoiceClaw Platforms © 2026. Automated receptionist systems.
          </footer>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          PAGE: AGENT TALK  (/agent/[id] or /agent/[id]/talk)
      ════════════════════════════════════════════════════════════════════════ */}
      {isAgentView && (
        <div
          id="page-agent"
          className="w-full min-h-screen flex flex-col bg-[#0a0a0a] text-white"
        >
          {/* Mic permission denied banner */}
          {micPermissionDenied && (
            <div
              id="mic-error-banner"
              className="w-full bg-rose-950/60 border-b border-rose-900 px-4 py-3 flex items-center gap-3 text-xs text-rose-200"
            >
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              Allow microphone access to use VoiceForge
            </div>
          )}

          <div className="flex-1 flex flex-col items-center py-8 px-4">
            <div className="w-full max-w-lg">
              {/* Top nav */}
              <div className="flex items-center justify-between pb-6 border-b border-zinc-900">
                <button
                  id="btn-nav-back"
                  onClick={() => navigate("/builder")}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-400 hover:text-white transition-colors py-2"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Builder
                </button>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-bold tracking-widest uppercase">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  Live
                </div>
              </div>

              {/* Business name — 13px muted */}
              <div className="text-center mt-8 mb-4">
                {isAgentLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-500 mx-auto" />
                ) : (
                  <p
                    className="text-zinc-500 font-medium"
                    style={{ fontSize: "13px" }}
                  >
                    {agentInfo?.business_name || "VoiceForge Agent"}
                  </p>
                )}
              </div>

              {/* ── Mic area ────────────────────────────────────────────────── */}
              <div className="flex flex-col items-center justify-center relative py-6">
                {/* Pulse rings while listening */}
                {micStatus === "Listening..." && (
                  <>
                    <div className="absolute w-[200px] h-[200px] bg-white/5 rounded-full border border-white/10 animate-ping opacity-30" />
                    <div className="absolute w-[150px] h-[150px] bg-white/3 rounded-full border border-white/10 animate-pulse" />
                  </>
                )}

                {/*
                  Mic button:
                  - 80px on md+ (w-20 h-20)
                  - 96px on mobile (w-24 h-24) — base class
                  - White background on idle, black icon
                */}
                <button
                  id="btn-mic-trigger"
                  onMouseDown={handleMicStart}
                  onMouseUp={() => handleMicStop()}
                  onMouseLeave={() => handleMicStop()}
                  onTouchStart={handleMicStart}
                  onTouchEnd={() => handleMicStop()}
                  disabled={
                    micStatus === "Thinking..." ||
                    micStatus === "Speaking..." ||
                    isAgentLoading
                  }
                  className={`relative w-24 h-24 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-all focus:outline-none select-none ${
                    micStatus === "Listening..."
                      ? "bg-white text-black scale-95 shadow-2xl shadow-white/20 cursor-pointer"
                      : micStatus === "Speaking..."
                      ? "bg-zinc-800 text-white cursor-not-allowed border border-emerald-500/40"
                      : micStatus === "Thinking..."
                      ? "bg-zinc-800 text-white cursor-not-allowed border border-zinc-700"
                      : "bg-white text-black hover:bg-zinc-100 cursor-pointer shadow-lg"
                  }`}
                  title="Hold to talk"
                >
                  {micStatus === "Thinking..." ? (
                    <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
                  ) : micStatus === "Speaking..." ? (
                    <Volume2 className="w-8 h-8 text-emerald-400 animate-pulse" />
                  ) : (
                    <Mic className="w-8 h-8" />
                  )}
                </button>

                {/* Status label */}
                <p
                  className="mt-5 text-sm font-semibold tracking-wide text-zinc-400 uppercase"
                  id="mic-status-label"
                >
                  {micStatus}
                </p>

                {/* Amplitude bars — hidden on mobile (<768px) */}
                {micStatus === "Listening..." && (
                  <div
                    className="hidden sm:flex items-end gap-1.5 mt-4"
                    id="audio-amplitude-visualizer"
                    style={{ height: "40px" }}
                  >
                    <div className="w-1.5 bg-white rounded-full visualizer-bar" style={{ animationDelay: "0.15s", animationDuration: "0.75s" }} />
                    <div className="w-1.5 bg-white rounded-full visualizer-bar" style={{ animationDelay: "0.30s", animationDuration: "0.55s" }} />
                    <div className="w-1.5 bg-white rounded-full visualizer-bar" style={{ animationDelay: "0.00s", animationDuration: "0.60s" }} />
                    <div className="w-1.5 bg-white rounded-full visualizer-bar" style={{ animationDelay: "0.45s", animationDuration: "0.80s" }} />
                    <div className="w-1.5 bg-white rounded-full visualizer-bar" style={{ animationDelay: "0.20s", animationDuration: "0.65s" }} />
                  </div>
                )}
              </div>

              {/* ── Chat history ────────────────────────────────────────────── */}
              <div className="overflow-y-auto max-h-[200px] md:max-h-[300px] mt-2">
                <div className="space-y-3 px-1 pb-1" id="container-dialogue">
                  {chatTurns.length === 0 ? (
                    <p className="text-xs text-center text-zinc-600 italic py-4">
                      Tap to speak to begin the conversation.
                    </p>
                  ) : (
                    chatTurns.map((turn, i) => (
                      <div
                        key={i}
                        className={`flex ${
                          turn.role === "user" ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div>
                          <div
                            className={`inline-block px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed max-w-[260px] sm:max-w-xs ${
                              turn.role === "user"
                                ? "bg-zinc-900 border border-[#1a1a1a] text-white rounded-tr-none"
                                : "bg-[#111] border border-zinc-800 text-zinc-100 rounded-tl-none"
                            }`}
                          >
                            {turn.text}
                          </div>
                          {/* Language badge for user messages */}
                          {turn.role === "user" && turn.lang && (
                            <p className="text-[9px] text-zinc-600 text-right mt-0.5 pr-1">
                              {turn.lang}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={talkChatEndRef} />
                </div>
              </div>

              {/* ── Keyboard fallback ──────────────────────────────────────── */}
              <div className="pt-4 mt-2">
                <form onSubmit={handleKeyboardSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={keyboardQuery}
                    onChange={(e) => setKeyboardQuery(e.target.value)}
                    disabled={
                      micStatus === "Thinking..." ||
                      micStatus === "Speaking..." ||
                      isKeyboardSubmitting
                    }
                    placeholder="Type a query..."
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-zinc-600 focus:outline-none text-zinc-200 placeholder-zinc-600"
                  />
                  <button
                    type="submit"
                    disabled={
                      !keyboardQuery.trim() ||
                      micStatus === "Thinking..." ||
                      micStatus === "Speaking..."
                    }
                    className="bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    Send
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div className="text-center text-[10px] text-zinc-700 pb-4">
            VoiceClaw Agent ID:{" "}
            <span className="font-mono">{activeAgentId || "demo123"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
