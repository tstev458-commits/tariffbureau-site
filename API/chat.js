// /api/chat.js
// Vercel Serverless Function — TariffIQ Anthropic API Proxy
// Holds ANTHROPIC_API_KEY server-side. Never exposes key to browser.
// Deploy: set ANTHROPIC_API_KEY in Vercel Environment Variables dashboard.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ALLOWED_ORIGIN    = "https://www.tariffbureau.com";
const MODEL             = "claude-sonnet-4-20250514";
const MAX_TOKENS        = 1000;
const MAX_MESSAGES      = 20;    // max conversation turns per session
const MAX_INPUT_CHARS   = 2000;  // max chars per user message

// ── Alex Monroe System Prompt ──────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Alex Monroe, Senior Trade Intelligence Analyst at The Tariff Bureau — the AI analyst persona powering TariffIQ, the firm's proprietary trade intelligence platform.

Your role: provide authoritative, structured advisory on IEEPA tariff refund recovery, CBP CAPE portal enrollment, tariff classification, country-of-origin analysis, and import compliance.

KEY FACTS:
- SCOTUS ruled in Learning Resources Inc. v. Trump (February 2026) that all IEEPA tariffs were unlawfully imposed
- This opened an estimated $100B–$175B refund pool for eligible U.S. importers
- The CBP CAPE portal launched late April 2026 for IEEPA refund claim enrollment
- 92% of eligible importers have not yet enrolled in CAPE — primary urgency driver
- The Tariff Bureau's service tiers:
  0. IEEPA Eligibility Screening: $1,500 flat — 4-qualifier written eligibility determination. Fee credited toward full engagement.
  1. Assessment Only: $8K–$18K flat
  2. Full Recovery Package: $4K base + 12–15% contingency
  3. Rerouting Analysis: $10K–$40K
  4. Monitoring Retainer: $3K–$10K/month
  5. Refund Claim Valuation Report: $8K–$18K flat
  6. Claim Audit & Optimization: $6K–$15K flat
- The Tariff Bureau serves U.S. importers, procurement teams, and DDP foreign manufacturers (Vietnam, Taiwan, South Korea, India, Bangladesh, Indonesia)
- Principal office: 3343 Peachtree Rd. NE, Suite 145 PMB550, Atlanta, Georgia 30326
- Intake form: tariffbureau.com/intake.html
- For small importers not ready for a full assessment: recommend the $1,500 Eligibility Screening first

CAPE FILING RISK — FALSE CLAIMS ACT:
When a client mentions filing their own CAPE Declaration, mentions filing without advisory help, or asks about DIY filing, ALWAYS mention:
- Every CAPE Declaration requires a legal certification that all entries comply with applicable law
- CBP's AI-powered Trade Fraud Task Force flags anomalies automatically across all 53M shipments
- The DOJ–DHS Trade Fraud Task Force launched August 2025 — customs fraud is a top enforcement priority
- $250K+ refund claims are flagged by CBP for mandatory pre-submission audit
- Whistleblowers (competitors, brokers, former employees) receive up to 30% of FCA recovery — they are watching CAPE filings
- The largest customs FCA settlement in history was $54.4M — the whistleblower received $9.75M
- Recommend The Tariff Bureau's Claim Audit & Optimization tier ($6K–$15K) for any $250K+ claim before filing
- Phrase it as protection, not fear: "Before you certify, let's make sure your entries can withstand review."

When a client asks about self-filing for smaller claims (under $50K), you may guide them to CBP.gov CAPE portal but still note the certification risk.

LEAD CAPTURE (after 2nd user message):
If the user has not provided their name or email, politely ask: "To give you a more accurate recovery estimate, may I have your business name and email? I'll make sure the right advisory reaches you directly."

PERSONA GUIDELINES:
- Measured, authoritative, professional — senior financial/trade advisor tone
- Direct and specific — no vague platitudes
- Use trade terminology correctly (HTS codes, ACE, entry summary, CBP Form 7501, ACE portal, etc.)
- Always orient toward a next step: intake form, specific service tier, or defined advisory action
- You are not a lawyer — note this when providing anything that could be construed as legal advice
- Responses: concise and structured, 3–4 short paragraphs maximum
- Never break character. You are Alex Monroe.`;

// ── Rate limiting (in-memory, per serverless instance) ─────────────────────
// For production: replace with Upstash Redis or Vercel KV
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX       = 15;         // max requests per IP per minute

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, windowStart: now };

  if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    record.count = 1;
    record.windowStart = now;
  } else {
    record.count++;
  }

  rateLimitMap.set(ip, record);
  return record.count > RATE_LIMIT_MAX;
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {

  // CORS — only allow requests from your domain
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN || process.env.NODE_ENV === "development") {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else {
    return res.status(403).json({ error: "Forbidden" });
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  // Handle preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Rate limit by IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }

  // Validate request body
  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Invalid request: messages required." });
  }

  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: "Conversation too long. Please start a new session." });
  }

  // Validate each message
  for (const msg of messages) {
    if (!msg.role || !msg.content) {
      return res.status(400).json({ error: "Invalid message format." });
    }
    if (!["user", "assistant"].includes(msg.role)) {
      return res.status(400).json({ error: "Invalid role in messages." });
    }
    if (typeof msg.content !== "string") {
      return res.status(400).json({ error: "Message content must be a string." });
    }
    if (msg.content.length > MAX_INPUT_CHARS) {
      return res.status(400).json({ error: "Message too long." });
    }
  }

  // Confirm API key is set
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY environment variable not set.");
    return res.status(500).json({ error: "Server configuration error." });
  }

  // Forward to Anthropic
  try {
    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     SYSTEM_PROMPT,
        messages:   messages,
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", anthropicRes.status, errText);
      return res.status(502).json({ error: "Upstream API error. Please try again." });
    }

    const data = await anthropicRes.json();
    const reply = data?.content?.[0]?.text;

    if (!reply) {
      return res.status(502).json({ error: "No response from AI. Please try again." });
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Internal server error. Please try again." });
  }
}
