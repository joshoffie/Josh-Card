// ---------------------------------------------------------------------------
// Simple in-memory sliding-window rate limiter (single Railway instance).
// ---------------------------------------------------------------------------
const buckets = new Map();

/**
 * @param {string} key      e.g. "comment:42" or "register:1.2.3.4"
 * @param {number} limit    max events in the window
 * @param {number} windowMs window length
 * @returns {boolean} true if allowed
 */
export function hit(key, limit, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

// Uses Express's req.ip, which honors app.set("trust proxy") — the raw
// X-Forwarded-For header is client-controlled and must not be trusted directly.
export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Express middleware factory. keyFn(req) returns the identity to limit on.
export function limit(name, max, windowMs, keyFn) {
  return (req, res, next) => {
    const id = keyFn ? keyFn(req) : clientIp(req);
    if (!hit(`${name}:${id}`, max, windowMs)) {
      return res.status(429).json({ error: "You're doing that too fast. Please wait a bit and try again." });
    }
    next();
  };
}

// Clean up old keys every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    if (!arr.length || now - arr[arr.length - 1] > 24 * 3600 * 1000) buckets.delete(k);
  }
}, 10 * 60 * 1000).unref();
