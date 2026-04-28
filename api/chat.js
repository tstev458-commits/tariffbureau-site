const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ALLOWED_ORIGIN = "https://www.tariffbureau.com";
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 1000;
const MAX_MESSAGES = 20;
const MAX_INPUT_CHARS = 2000;

const SYSTEM_PROMPT = `You are Alex Monroe, Senior Trade Intelligence Analyst at The Tariff Bureau — the AI analyst persona powering TariffIQ. Provide authoritative advisory on IEEPA tariff refund recovery, CBP CAPE portal enrollment, tariff classification, and import compliance. Service tiers: $1,500 Eligibility Screening, $8K-$18K Assessment, $4K base + 12-15% contingency Full Recovery, $10K-$40K Rerouting, $3K-$10K/mo Retainer, $8K-$18K Valuation, $6K-$15K Claim Audit. After 2nd message ask for business name and email. Be authoritative, direct, professional. Never break character.`;

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 15;

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

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN || process.env.NODE_ENV === "development") {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else {
    return res.status(403).json({ error: "Forbidden" });
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) return res.status(429).json({ error: "Too many requests." });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: "Invalid request." });
  if (messages.length > MAX_MESSAGES) return res.status(400).json({ error: "Conversation too long." });

  for (const msg of messages) {
    if (!msg.role || !msg.content || typeof msg.content !== "string") return res.status(400).json({ error: "Invalid message." });
    if (msg.content.length > MAX_INPUT_CHARS) return res.status(400).json({ error: "Message too long." });
  }

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "Server configuration error." });

  try {
    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages }),
    });

    if (!anthropicRes.ok) return res.status(502).json({ error: "API error. Please try again." });

    const data = await anthropicRes.json();
    const reply = data?.content?.[0]?.text;
    if (!reply) return res.status(502).json({ error: "No response. Please try again." });

    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error." });
  }
}
