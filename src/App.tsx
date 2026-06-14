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
  MessageSquare,
  Users,
  Database,
  Zap,
} from "lucide-react";
import { ConnectorsPanel } from './components/ConnectorsPanel';
import { InsightsPanel } from './components/InsightsPanel';
import { useConnectors } from './stores/useConnectors';

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

interface ActionCard {
  type: string;
  task: string;
  details: Record<string, string>;
  icon: string;
  color: string;
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
    // Smart suggestions based on business type
    const suggestions: Record<string, { items: string[]; intro: string }> = {
      restaurant: {
        intro: "Let's train your agent on your restaurant! Here's what I need:",
        items: ["📋 Your menu (PDF or website link)", "⏰ Operating hours & location", "💰 Price list or special offers", "📦 Delivery/takeaway policies"],
      },
      clinic: {
        intro: "Let's set up your clinic agent! Upload these so your agent can answer patient queries:",
        items: ["🩺 List of services & treatments", "👨‍⚕️ Doctor profiles & specializations", "⏰ Consultation hours & fees", "📋 Booking policies & insurance info"],
      },
      hospital: {
        intro: "Let's configure your hospital agent! Upload or paste:",
        items: ["🏥 Department list & specialties", "👨‍⚕️ Doctor directory", "⏰ OPD timings & visiting hours", "💰 Package rates & insurance partnerships"],
      },
      salon: {
        intro: "Let's get your salon agent ready! I need:",
        items: ["💇 Services & price menu", "⏰ Working hours & days off", "👩‍🎨 Stylist profiles (optional)", "📋 Booking & cancellation policies"],
      },
      shop: {
        intro: "Let's train your shop agent! Upload:",
        items: ["🛍️ Product catalog or inventory list", "💰 Price list", "⏰ Store hours & location", "🚚 Delivery/return policies"],
      },
      hotel: {
        intro: "Let's set up your hotel agent! Upload these:",
        items: ["🏨 Room types & tariffs", "🍽️ Amenities & dining options", "⏰ Check-in/check-out policies", "📋 Cancellation & booking policies"],
      },
      gym: {
        intro: "Let's set up your fitness center agent! I need:",
        items: ["💪 Membership plans & pricing", "⏰ Class schedule & timings", "🏋️ Facilities & trainer info", "📋 Enrollment & cancellation policies"],
      },
      school: {
        intro: "Let's set up your education agent! Upload:",
        items: ["📚 Courses & programs offered", "💰 Fee structure", "📅 Admission process & deadlines", "📋 Exam schedules & policies"],
      },
      ecommerce: {
        intro: "Let's train your e-commerce agent! Upload:",
        items: ["🛍️ Product catalog with descriptions", "💰 Pricing & offers", "🚚 Shipping & delivery policies", "↩️ Return & refund policies"],
      },
    };

    // Match business type to suggestions (fuzzy)
    const bt = (businessType || "").toLowerCase();
    let matched = suggestions["shop"]; // fallback
    for (const [key, val] of Object.entries(suggestions)) {
      if (bt.includes(key) || key.includes(bt)) {
        matched = val;
        break;
      }
    }
    // Also handle some common Indian business types
    if (bt.includes("dhaba") || bt.includes("cafe") || bt.includes("food") || bt.includes("bakery") || bt.includes("sweet")) {
      matched = suggestions["restaurant"];
    } else if (bt.includes("doctor") || bt.includes("dental") || bt.includes("physio") || bt.includes("ayurved")) {
      matched = suggestions["clinic"];
    } else if (bt.includes("parlour") || bt.includes("parlor") || bt.includes("spa") || bt.includes("beauty")) {
      matched = suggestions["salon"];
    } else if (bt.includes("coaching") || bt.includes("tuition") || bt.includes("institute") || bt.includes("academy")) {
      matched = suggestions["school"];
    } else if (bt.includes("store") || bt.includes("mart") || bt.includes("wholesale") || bt.includes("retail")) {
      matched = suggestions["shop"];
    } else if (bt.includes("lodge") || bt.includes("resort") || bt.includes("guest") || bt.includes("homestay")) {
      matched = suggestions["hotel"];
    }

    const introText = matched.intro;
    const checklistMarkdown = matched.items.map(i => `  ${i}`).join("\n");
    const fullMessage = `${introText}\n\n${checklistMarkdown}\n\nUpload a PDF or paste your website URL below — I'll scrape everything automatically!`;

    setConversationHistory((prev) => [
      ...prev,
      { role: "assistant" as const, content: fullMessage },
    ]);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `ai-upload-intro-${Date.now()}`,
        role: "assistant" as const,
        content: fullMessage,
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
          system: `You are an onboarding assistant helping a non-technical Indian business owner set up their AI voice agent. Be warm, friendly, and efficient — like a helpful consultant who values their time.

IMPORTANT RULES:
- Keep every message under 3 sentences. Business owners are busy.
- Ask at most 2 related questions per message.
- Use simple English. No jargon.
- If the user gives you multiple answers at once, acknowledge all of them and move on.

FLOW (complete in 3-4 exchanges, NOT 6):

STEP 1: "What's your business name and what kind of business is it? (e.g., restaurant, clinic, salon, shop)"
→ This gets business_name + business_type in one go.

STEP 2: "What language do most of your customers speak? And what are the top 2-3 things they usually ask about?"
→ Gets primary_language + top_faqs together.

STEP 3: "How should the agent greet callers? And is there anything it should never say or promise?"
→ Gets greeting + restrictions.

After all answers collected, output the config wrapped in <config></config> tags:
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

THEN recommend connectors. Based on the business type, pick the MOST relevant ones from:
- "calendar" — Google Calendar (for clinics, salons, hospitals, consultants — anything with appointments)
- "whatsapp" — WhatsApp / Twilio (for sending confirmations, reminders, order updates to customers)
- "shopify" — Shopify / Catalog (for shops, restaurants, e-commerce — anything selling products)
- "hubspot" — HubSpot / CRM (for tracking leads, customer info, follow-ups)

Your message MUST follow this exact pattern:
1. Output the hidden tag: <tools>calendar,whatsapp</tools> (with your recommended tools)
2. Then write a brief message listing each recommendation and directing them to the Connectors Panel. Example:

"I'd recommend connecting these for [business name]:
📅 **Google Calendar** — so customers can book appointments directly
💬 **WhatsApp** — to send booking confirmations automatically

You can enable these anytime using the **Connectors & Tools** panel on the right. Now, let's get your agent trained on your business knowledge!"

Do not ask for confirmation or wait for a reply about tools.

Never ask two unrelated questions at once. If user answers partially, ask only for what's missing.`,
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

      // Strip <config> and <tools> blocks from the displayed message
      const cleanText = rawText
        .replace(/<config>[\s\S]*?<\/config>/g, "")
        .replace(/<tools>[\s\S]*?<\/tools>/g, "")
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
  const [agentId, setLocalAgentId] = useState<string | null>(null);
  const { setAgentId, loadConnectors, connectors, activeCount } = useConnectors();
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [micStatus, setMicStatus] = useState<
    "Tap to speak" | "Listening..." | "Thinking..." | "Speaking..."
  >("Tap to speak");
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [keyboardQuery, setKeyboardQuery] = useState("");
  const [isKeyboardSubmitting, setIsKeyboardSubmitting] = useState(false);
  const [chatTurns, setChatTurns] = useState<VoiceTurn[]>([]);
  const [activeActionCard, setActiveActionCard] = useState<ActionCard | null>(null);
  const actionCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const talkChatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    talkChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatTurns]);

  // Auto-dismiss action card after 5 seconds
  useEffect(() => {
    if (activeActionCard) {
      if (actionCardTimerRef.current) clearTimeout(actionCardTimerRef.current);
      actionCardTimerRef.current = setTimeout(() => setActiveActionCard(null), 5000);
    }
    return () => {
      if (actionCardTimerRef.current) clearTimeout(actionCardTimerRef.current);
    };
  }, [activeActionCard]);

  // ── ACTION TAG PARSER ──────────────────────────────────────────────────────────
  const parseActionTags = (text: string): { cleanText: string; action: ActionCard | null } => {
    const actionRegex = /<action\s+([^/>]+)\/>/gi;
    const match = actionRegex.exec(text);
    if (!match) return { cleanText: text, action: null };

    // Parse attributes from the tag
    const attrString = match[1];
    const attrs: Record<string, string> = {};
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    const actionType = attrs.type || "unknown";
    const task = attrs.task || "Action completed";
    delete attrs.type;
    delete attrs.task;

    // Map connector type to icon name and color
    const iconMap: Record<string, { icon: string; color: string }> = {
      calendar: { icon: "calendar", color: "from-blue-500 to-cyan-400" },
      twilio: { icon: "message", color: "from-green-500 to-emerald-400" },
      shopify: { icon: "shop", color: "from-amber-500 to-orange-400" },
      hubspot: { icon: "users", color: "from-purple-500 to-violet-400" },
    };
    const mapped = iconMap[actionType] || { icon: "check", color: "from-zinc-500 to-zinc-400" };

    // Strip all action tags from the text
    const cleanText = text.replace(/<action\s+[^/>]*\/>/gi, "").trim();

    return {
      cleanText,
      action: {
        type: actionType,
        task,
        details: attrs,
        icon: mapped.icon,
        color: mapped.color,
      },
    };
  };

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
      const generatedId = agentId;
      setLocalAgentId(generatedId);
      setAgentId(generatedId); // update Zustand
      loadConnectors(generatedId);
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

      // Build enabled connectors list
      const enabled_connectors: string[] = [];
      if (isCalendarConnected) enabled_connectors.push("calendar");
      if (isTwilioConnected) enabled_connectors.push("twilio");
      if (isShopifyConnected) enabled_connectors.push("shopify");
      if (isHubspotConnected) enabled_connectors.push("hubspot");

      // 4. Query RAG
      const qRes = await fetch(getApiUrl("/api/query"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          source_lang: language,
          agent_id: activeAgentId || "demo123",
          history: last4,
          enabled_connectors,
        }),
      });
      if (!qRes.ok) throw new Error("Query failed");
      let { answer_text } = await qRes.json();

      // 5. AI enrichment — append one natural follow-up question
      try {
        const langHint = language !== "en-IN" ? ` The user is speaking in ${language}. You MUST respond in that same language, not English.` : "";
        const enrichRes = await fetch(getApiUrl("/api/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system: `You are a voice assistant for ${agentInfo?.business_name || "this business"}. Take the answer and append ONE short natural follow-up question. Max 2 sentences.${langHint} Respond in the EXACT same language as the answer text. IMPORTANT: If the answer contains any XML tags like <action .../>, preserve them exactly as-is at the end.`,
            messages: [
              {
                role: "user",
                content: `Answer: ${answer_text}. Append a follow-up question in the same language.`,
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

      // 5b. Parse and extract action tags BEFORE sending to TTS
      const { cleanText: spokenText, action } = parseActionTags(answer_text);
      if (action) {
        setActiveActionCard(action);
      }

      // 6. Append agent turn (clean text without XML tags)
      setChatTurns((prev) => [...prev, { role: "agent", text: spokenText }]);

      // 7. TTS (send ONLY clean spoken text — no XML tags)
      const ttsRes = await fetch(getApiUrl("/api/tts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: spokenText, source_lang: language, agent_id: activeAgentId || "demo123" }),
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
        @keyframes actionCardSlideIn {
          0% { opacity: 0; transform: translateY(30px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes actionCardFadeOut {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-10px) scale(0.97); }
        }
        @keyframes actionProgressBar {
          0% { width: 100%; }
          100% { width: 0%; }
        }
        .action-card-enter {
          animation: actionCardSlideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes morph {
          0% { border-radius: 50% 50% 50% 50% / 50% 50% 50% 50%; }
          25% { border-radius: 60% 40% 55% 45% / 55% 45% 60% 40%; }
          50% { border-radius: 50% 55% 40% 60% / 40% 60% 50% 50%; }
          75% { border-radius: 40% 60% 50% 55% / 50% 40% 60% 45%; }
          100% { border-radius: 50% 50% 50% 50% / 50% 50% 50% 50%; }
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

            {/* Capability Badges */}
            {activeCount > 0 && (
              <div className="bg-[#111] border border-white/10 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3 font-medium">
                  Active Capabilities
                </p>
                <div className="flex flex-col gap-2">
                  {connectors.google_calendar?.enabled && (
                    <div className="flex items-center gap-2 text-xs text-zinc-300">
                      <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                      Books appointments to Google Calendar
                    </div>
                  )}
                  {connectors.whatsapp_twilio?.enabled && (
                    <div className="flex items-center gap-2 text-xs text-zinc-300">
                      <Send className="w-3.5 h-3.5 text-emerald-400" />
                      Sends SMS/WhatsApp confirmations
                    </div>
                  )}
                  {connectors.shopify_catalog?.enabled && (
                    <div className="flex items-center gap-2 text-xs text-zinc-300">
                      <ShoppingBag className="w-3.5 h-3.5 text-emerald-400" />
                      Searches live inventory on Shopify
                    </div>
                  )}
                  {connectors.hubspot_crm?.enabled && (
                    <div className="flex items-center gap-2 text-xs text-zinc-300">
                      <Database className="w-3.5 h-3.5 text-emerald-400" />
                      Saves customer data to HubSpot CRM
                    </div>
                  )}
                  {Object.keys(connectors).filter(k => k.startsWith('custom_') && connectors[k].enabled).map(key => (
                    <div key={key} className="flex items-center gap-2 text-xs text-zinc-300">
                      <Zap className="w-3.5 h-3.5 text-emerald-400" />
                      {(connectors[key].config as any)?.name || 'Custom Webhook Integration'}
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                              accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.webp"
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
              <ConnectorsPanel />

              {/* Insights & Self-Improvement Panel */}
              {activeAgentId && (
                <div className="md:col-span-4">
                  <InsightsPanel agentId={activeAgentId} />
                </div>
              )}

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
          className="w-full min-h-screen flex flex-col bg-black text-white relative overflow-hidden"
        >
          {/* Cosmic background radial gradient */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(120,119,198,0.08)_0%,_rgba(0,0,0,0)_70%)] pointer-events-none" />

          {/* Mic permission denied banner (only showing icon, no text) */}
          {micPermissionDenied && (
            <div
              id="mic-error-banner"
              className="absolute top-0 left-0 right-0 z-50 bg-rose-950/60 border-b border-rose-900/40 px-4 py-3 flex items-center justify-center backdrop-blur-md"
            >
              <AlertCircle className="w-5 h-5 text-rose-500" />
            </div>
          )}

          {/* Header */}
          <div className="w-full flex items-center justify-between p-6 z-10">
            <button
              id="btn-nav-back"
              onClick={() => navigate("/builder")}
              className="w-10 h-10 rounded-full bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-all active:scale-95 cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 bg-zinc-900/60 border border-zinc-800/80 px-3 py-1.5 rounded-full select-none">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
            </div>
          </div>

          {/* Main Content Area: Centered Glowing Orb */}
          <div className="flex-1 flex flex-col items-center justify-center z-10 px-4">
            <div className="flex flex-col items-center justify-center relative">
              {/* Concentric Pulse rings while listening */}
              {micStatus === "Listening..." && (
                <>
                  <div className="absolute w-[320px] h-[320px] bg-cyan-500/10 rounded-full animate-ping opacity-25" />
                  <div className="absolute w-[260px] h-[260px] bg-blue-500/5 rounded-full animate-pulse opacity-40" />
                </>
              )}
              {/* Concentric Pulse rings while speaking */}
              {micStatus === "Speaking..." && (
                <>
                  <div className="absolute w-[300px] h-[300px] bg-emerald-500/10 rounded-full animate-ping opacity-25" />
                  <div className="absolute w-[240px] h-[240px] bg-teal-500/5 rounded-full animate-pulse opacity-40" />
                </>
              )}

              {/* The Glowing Orb */}
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
                className={`relative w-40 h-40 rounded-full flex items-center justify-center transition-all duration-700 focus:outline-none select-none ${
                  micStatus === "Listening..."
                    ? "bg-gradient-to-tr from-cyan-400 via-blue-500 to-indigo-500 shadow-[0_0_50px_rgba(6,182,212,0.5)] scale-105 cursor-pointer animate-[morph_6s_ease-in-out_infinite]"
                    : micStatus === "Speaking..."
                    ? "bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-500 shadow-[0_0_50px_rgba(16,185,129,0.5)] cursor-not-allowed animate-[morph_4s_ease-in-out_infinite]"
                    : micStatus === "Thinking..."
                    ? "bg-gradient-to-tr from-violet-600 via-fuchsia-500 to-indigo-600 shadow-[0_0_40px_rgba(139,92,246,0.4)] cursor-not-allowed animate-[spin_8s_linear_infinite]"
                    : "bg-gradient-to-tr from-zinc-800 via-zinc-900 to-zinc-850 border border-zinc-700/60 shadow-[0_0_30px_rgba(255,255,255,0.03)] hover:shadow-[0_0_40px_rgba(255,255,255,0.08)] cursor-pointer hover:scale-102"
                }`}
              >
                {/* Center symbol */}
                <div className="transition-all duration-300">
                  {micStatus === "Thinking..." ? (
                    <Sparkles className="w-10 h-10 text-white animate-pulse" />
                  ) : micStatus === "Speaking..." ? (
                    <Volume2 className="w-10 h-10 text-white animate-[bounce_1s_infinite]" />
                  ) : isAgentLoading ? (
                    <Loader2 className="w-10 h-10 text-zinc-500 animate-spin" />
                  ) : (
                    <Mic className="w-10 h-10 text-white" />
                  )}
                </div>
              </button>

              {/* Minimalist Visualizer Waves */}
              {micStatus === "Listening..." && (
                <div
                  className="flex items-end gap-2 mt-12 h-8"
                  id="audio-amplitude-visualizer"
                >
                  <div className="w-1 bg-white/60 rounded-full visualizer-bar" style={{ animationDelay: "0.15s", animationDuration: "0.75s" }} />
                  <div className="w-1 bg-white/60 rounded-full visualizer-bar" style={{ animationDelay: "0.30s", animationDuration: "0.55s" }} />
                  <div className="w-1 bg-white/60 rounded-full visualizer-bar" style={{ animationDelay: "0.00s", animationDuration: "0.60s" }} />
                  <div className="w-1 bg-white/60 rounded-full visualizer-bar" style={{ animationDelay: "0.45s", animationDuration: "0.80s" }} />
                  <div className="w-1 bg-white/60 rounded-full visualizer-bar" style={{ animationDelay: "0.20s", animationDuration: "0.65s" }} />
                </div>
              )}
            </div>
          </div>

          {/* ── Action Card Overlay ──────────────────────────────────────── */}
          {activeActionCard && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 action-card-enter" id="action-card-overlay">
              <div className="relative w-[320px] rounded-2xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-[0_8px_40px_rgba(0,0,0,0.5)] overflow-hidden">
                {/* Top gradient accent bar */}
                <div className={`h-1 w-full bg-gradient-to-r ${activeActionCard.color}`} />
                
                <div className="p-5 flex items-start gap-4">
                  {/* Icon */}
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${activeActionCard.color} flex items-center justify-center shrink-0 shadow-lg`}>
                    {activeActionCard.icon === "calendar" && <Calendar className="w-5 h-5 text-white" />}
                    {activeActionCard.icon === "message" && <MessageSquare className="w-5 h-5 text-white" />}
                    {activeActionCard.icon === "shop" && <ShoppingBag className="w-5 h-5 text-white" />}
                    {activeActionCard.icon === "users" && <Users className="w-5 h-5 text-white" />}
                    {activeActionCard.icon === "check" && <CheckCircle2 className="w-5 h-5 text-white" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Connector label */}
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1">
                      {activeActionCard.type === "calendar" ? "Google Calendar" : activeActionCard.type === "twilio" ? "WhatsApp" : activeActionCard.type === "shopify" ? "Shopify" : activeActionCard.type === "hubspot" ? "HubSpot" : "Action"}
                    </p>
                    {/* Task description */}
                    <p className="text-sm font-semibold text-white/90 leading-snug">
                      {activeActionCard.task}
                    </p>
                    {/* Detail attributes */}
                    {Object.keys(activeActionCard.details).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {Object.entries(activeActionCard.details).map(([key, value]) => (
                          <span key={key} className="inline-flex items-center gap-1 text-[10px] bg-white/10 text-white/60 px-2 py-0.5 rounded-full">
                            <span className="text-white/30">{key}:</span> {value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Dismiss button */}
                  <button
                    onClick={() => setActiveActionCard(null)}
                    className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/40 hover:text-white/80 transition-all shrink-0 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {/* Auto-dismiss progress bar */}
                <div className="h-0.5 bg-white/5">
                  <div
                    className={`h-full bg-gradient-to-r ${activeActionCard.color} opacity-60`}
                    style={{ animation: "actionProgressBar 5s linear forwards" }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Minimalist branding indicator */}
          <div className="w-full flex justify-center pb-8 z-10">
            <div className="flex items-center gap-1.5 opacity-20 hover:opacity-45 transition-opacity duration-300">
              <span className="w-1 h-3 bg-white rounded-full animate-pulse" />
              <span className="w-1 h-5 bg-white rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
              <span className="w-1 h-2 bg-white rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
