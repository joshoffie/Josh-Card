// ---------------------------------------------------------------------------
// Content moderation — runs on every member comment, chat message, name,
// bio and image BEFORE it is shown to anyone.
//
// Free by default (no paid services):
//   • Text: slur filter blocks; rule-based flags (off-platform contact,
//     payment handles, links, statements of being under 18) send the item
//     to the admin review queue.
//   • Images/GIF uploads: held as "pending" until the admin approves them.
//
// Optional upgrade: set OPENAI_API_KEY and text + images are also checked by
// OpenAI's moderation model (omni-moderation-latest). Clean images are then
// auto-approved. Its `sexual/minors` category scores TEXT only, so images
// keep a strict no-sexual-content threshold.
// If the AI check is enabled but unreachable, content is rejected (fail-closed).
// ---------------------------------------------------------------------------
import { SLUR_REGEXES } from "./store.js";

// ---------------------------------------------------------------------------
// Slur detection with normalization (zero-width chars, look-alike letters,
// spaced-out letters). Usernames are also checked without word boundaries.
// ---------------------------------------------------------------------------
const HOMOGLYPHS = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "к": "k", "ѕ": "s",
  "ԁ": "d", "ɡ": "g", "һ": "h", "ո": "n", "ı": "i", "α": "a", "ο": "o", "ν": "v", "τ": "t", "κ": "k",
  "@": "a", "$": "s", "0": "o", "3": "e", "1": "i", "!": "i", "|": "i",
};
export function normalizeText(text) {
  let t = String(text || "").normalize("NFKC").replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD]/g, "").toLowerCase();
  t = t.replace(/[^\x00-\x7F]|[@$0-9!|]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
  // Join runs of single letters split by spaces/punctuation: "s l u r" -> "slur"
  t = t.replace(/\b(?:[a-z][\s._*\-]+){2,}[a-z]\b/g, (run) => run.replace(/[\s._*\-]+/g, ""));
  return t;
}
// Boundary-free versions for usernames. Any pattern that would match inside an
// ordinary word (spicy, raccoon, homogeneous, Van Dyke…) is left out.
const SAFE_WORDS = ["spicy", "spice", "spicer", "raccoon", "cocoon", "tycoon", "homogeneous", "homophone", "homonym",
  "vandyke", "chinkapin", "retardant"];
const USERNAME_REGEXES = SLUR_REGEXES
  .map((r) => new RegExp(r.source.replace(/\\b/g, "").replace(/\(\?!.*\)$/, ""), "i"))
  .filter((r) => !SAFE_WORDS.some((w) => r.test(w)));

export function hasSlur(text, { username = false } = {}) {
  const raw = String(text || "");
  const norm = normalizeText(raw);
  if (SLUR_REGEXES.some((r) => r.test(raw) || r.test(norm))) return true;
  if (username) {
    const flat = norm.replace(/[^a-z]/g, "");
    if (USERNAME_REGEXES.some((r) => r.test(flat))) return true;
  }
  return false;
}

export class ModerationUnavailable extends Error {
  constructor(msg = "Content checks are temporarily unavailable. Please try again in a minute.") {
    super(msg);
    this.status = 503;
  }
}

export function aiModerationEnabled() {
  return !!process.env.OPENAI_API_KEY;
}

// ---------------------------------------------------------------------------
// Rule-based review flags (do not block; queue for a human)
// ---------------------------------------------------------------------------
const REVIEW_RULES = [
  { flag: "phone-number", re: /(?:\+?\d[\s.\-()]*){10,}/ },
  { flag: "email-address", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { flag: "link", re: /\bhttps?:\/\/(?!(?:media\d*|i)\.giphy\.com\/)\S+|\bwww\.\S+\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io|app|gg|me|co|ly|xyz|link|site|online|info|biz|us|uk|ca|tv|to|cc|ru|cn)\b(?:\/\S*)?|\/media\/(?:pending|local|image)\//i },
  { flag: "payment-handle", re: /\b(cash\s?app|venmo|zelle|paypal|apple\s?pay|western\s?union|gift\s?cards?|bitcoin|btc|usdt|crypto\s?wallet)\b|\$[a-z][a-z0-9_]{2,}/i },
  { flag: "off-platform-contact", re: /\b(telegram|whats\s?app|snap\s?chat|snap|kik|wickr|signal\s+app|discord|dm\s+me\s+on|text\s+me|add\s+me\s+on)\b/i },
  { flag: "possible-minor", re: /\b(?:i'?m|i\s+am|im)\s+(?:only\s+)?(?:1[0-7]|[1-9])\b(?!\s*(?:min|minutes|hours|hrs|mins|days|weeks|months|am|pm|%|k|ft|feet|in|lbs|kg|th|st|nd|rd|\.\d|:\d))|\b(?:1[0-7]|[1-9])\s*(?:yo|y\/o|years?\s*old)\b|\b(?:middle|high)\s+school(?:er)?\b|\b(?:7th|8th|9th|10th|11th)\s+grade\b/i },
  { flag: "asks-age", re: /\bhow\s+old\s+(?:are|r)\s+(?:you|u)\b|\basl\b/i },
];

export function reviewFlags(text) {
  text = String(text || "");
  return REVIEW_RULES.filter((r) => r.re.test(text)).map((r) => r.flag);
}

// ---------------------------------------------------------------------------
// Optional AI check (OpenAI moderation — free endpoint, needs an API key)
// ---------------------------------------------------------------------------
const OPENAI_URL = "https://api.openai.com/v1/moderations";
const SEVERE = ["sexual/minors"];
const IMAGE_LIMITS = { "sexual": 0.2, "violence/graphic": 0.4, "self-harm": 0.4, "self-harm/intent": 0.3, "self-harm/instructions": 0.3 };
const TEXT_LIMITS = { "sexual/minors": 0.05, "illicit/violent": 0.3, "harassment/threatening": 0.4, "hate/threatening": 0.4, "self-harm/instructions": 0.3 };

async function aiCheck(parts, isImage) {
  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input: parts }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.error("Moderation request failed:", e.message);
    throw new ModerationUnavailable();
  }
  if (!res.ok) {
    console.error("Moderation API error:", res.status);
    throw new ModerationUnavailable();
  }
  const result = (await res.json()).results?.[0];
  if (!result) throw new ModerationUnavailable();
  const scores = result.category_scores || {};
  const hits = new Set(Object.entries(result.categories || {}).filter(([, v]) => v).map(([k]) => k));
  const limits = isImage ? IMAGE_LIMITS : TEXT_LIMITS;
  for (const [cat, max] of Object.entries(limits)) if ((scores[cat] ?? 0) >= max) hits.add(cat);
  return [...hits];
}

/**
 * Check member text before saving it.
 * @returns {Promise<{allowed:boolean, severe:boolean, blocked:string[], flags:string[]}>}
 *   blocked → reject the content; flags → save it but queue for review.
 */
export async function checkText(text, { username = false } = {}) {
  text = String(text || "").trim();
  const out = { allowed: true, severe: false, blocked: [], flags: [] };
  if (!text) return out;
  if (hasSlur(text, { username })) out.blocked.push("slur");
  out.flags = [...new Set([...reviewFlags(text), ...reviewFlags(normalizeText(text))])];
  if (aiModerationEnabled() && !out.blocked.length) {
    const hits = await aiCheck([{ type: "text", text }], false);
    out.blocked.push(...hits);
    out.severe = hits.some((c) => SEVERE.includes(c));
  }
  out.allowed = out.blocked.length === 0;
  return out;
}

/**
 * Pre-screen an uploaded image. Every member image still waits for an admin;
 * the optional AI check can only reject early, never approve.
 * @returns {Promise<{status:'pending'|'rejected', blocked:string[]}>}
 */
export async function checkImage(buffer, mime) {
  if (!aiModerationEnabled()) return { status: "pending", blocked: [] };
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
  const hits = await aiCheck([{ type: "image_url", image_url: { url: dataUrl } }], true);
  return hits.length ? { status: "rejected", blocked: hits } : { status: "pending", blocked: [] };
}

// ---------------------------------------------------------------------------
// Image sniffing — trust file bytes, not the client's declared type
// ---------------------------------------------------------------------------
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 6).toString("ascii") === "GIF87a" || buf.slice(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export function validGifUrl(url) {
  return /^https:\/\/(?:media\d*|i)\.giphy\.com\/[\w\-./]+\.(?:gif|webp)(?:\?[\w=&.-]*)?$/i.test(String(url || ""));
}
