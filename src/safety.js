// ---------------------------------------------------------------------------
// Safety: member reports, automatic moderation log, admin review queue
// ---------------------------------------------------------------------------
import { db } from "./store.js";
import { setUserStatus, getProfileById } from "./social.js";
import { pendingImages } from "./community.js";
import { flaggedChats, getMessage } from "./chat.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id  INTEGER NOT NULL,
    target_type  TEXT NOT NULL,           -- comment | message | user
    target_id    INTEGER NOT NULL,
    reason       TEXT NOT NULL,
    details      TEXT DEFAULT '',
    status       TEXT DEFAULT 'open',     -- open | resolved
    resolution   TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now')),
    resolved_at  TEXT DEFAULT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_once ON reports(reporter_id, target_type, target_id) WHERE status = 'open';

  CREATE TABLE IF NOT EXISTS moderation_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER,
    content_type TEXT NOT NULL,           -- comment | message | profile | image
    context      TEXT DEFAULT '',         -- e.g. "post:12", "chat:4"
    text         TEXT DEFAULT '',
    categories   TEXT DEFAULT '',
    severe       INTEGER DEFAULT 0,
    action       TEXT DEFAULT '',         -- blocked | flagged | suspended
    status       TEXT DEFAULT 'open',
    created_at   TEXT DEFAULT (datetime('now'))
  );
`);

export const REPORT_REASONS = {
  "child-safety": "Involves a minor / child safety",
  "illegal": "Illegal activity (drugs, weapons, scams…)",
  "harassment": "Harassment or threats",
  "hate": "Hate speech",
  "sexual": "Sexual content",
  "spam": "Spam or scam",
  "self-harm": "Self-harm",
  "other": "Something else",
};

/** Log an automatic moderation decision. Severe hits suspend the account. */
export function logModeration({ userId, contentType, context = "", text = "", categories = [], severe = false, action }) {
  db.prepare(`INSERT INTO moderation_events (user_id, content_type, context, text, categories, severe, action)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId || null, contentType, context, String(text).slice(0, 4000), categories.join(","), severe ? 1 : 0, action);
  if (severe && userId) {
    setUserStatus(userId, "suspended", "Automatic: child-safety content detected");
    console.error(`[SAFETY] Severe content from user ${userId} (${contentType} ${context}). Account suspended. Review in /#/mod and report to NCMEC if apparent CSAM.`);
  }
}

export function createReport(reporterId, targetType, targetId, reason, details = "") {
  if (!["comment", "message", "user"].includes(targetType)) throw new Error("Invalid report");
  if (!REPORT_REASONS[reason]) throw new Error("Pick a reason");
  details = String(details || "").trim().slice(0, 1000);
  targetId = Number(targetId);
  if (targetType === "comment" && !db.prepare("SELECT 1 FROM post_comments WHERE id = ?").get(targetId)) throw new Error("Comment not found");
  if (targetType === "user" && !getProfileById(targetId)) throw new Error("User not found");
  if (targetType === "message") {
    const m = getMessage(targetId);
    if (!m) throw new Error("Message not found");
    // You can only report messages from chats you're in
    const member = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(m.conversation_id, reporterId);
    if (!member) throw new Error("Message not found");
  }
  try {
    db.prepare("INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)")
      .run(reporterId, targetType, targetId, reason, details);
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) throw new Error("You've already reported this. Thanks — it's in the review queue.");
    throw e;
  }
}

function describeTarget(r) {
  if (r.target_type === "comment") {
    const c = db.prepare(`SELECT c.*, u.username FROM post_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(r.target_id);
    return c ? { author_id: c.user_id, author: c.username, text: c.body, gif_url: c.gif_url, image_url: c.image_url, post_id: c.post_id, removed: c.status !== "visible" } : null;
  }
  if (r.target_type === "message") {
    const m = db.prepare(`SELECT x.*, u.username FROM chat_messages x LEFT JOIN users u ON u.id = x.sender_id WHERE x.id = ?`).get(r.target_id);
    return m ? { author_id: m.sender_id, author: m.username, text: m.body, gif_url: m.gif_url, chat_id: m.conversation_id, removed: m.status !== "visible" } : null;
  }
  const u = getProfileById(r.target_id);
  return u ? { author_id: u.id, author: u.username, text: u.bio, status: u.status } : null;
}

export function modQueue() {
  const reports = db.prepare(`
    SELECT r.*, u.username AS reporter FROM reports r JOIN users u ON u.id = r.reporter_id
    WHERE r.status = 'open' ORDER BY (r.reason = 'child-safety') DESC, r.created_at ASC LIMIT 200`).all()
    .map((r) => ({ ...r, reason_label: REPORT_REASONS[r.reason] || r.reason, target: describeTarget(r) }));
  const events = db.prepare(`
    SELECT e.*, u.username, u.status AS user_status FROM moderation_events e LEFT JOIN users u ON u.id = e.user_id
    WHERE e.status = 'open' ORDER BY e.severe DESC, e.created_at DESC LIMIT 200`).all();
  const suspended = db.prepare("SELECT id, username, status, status_reason FROM users WHERE status != 'active' ORDER BY id DESC LIMIT 200").all();
  return { reports, events, images: pendingImages(), chats: flaggedChats(), accounts: suspended };
}

export function openModCount() {
  const q = (sql) => db.prepare(sql).get().n;
  return q("SELECT COUNT(*) n FROM reports WHERE status = 'open'")
    + q("SELECT COUNT(*) n FROM moderation_events WHERE status = 'open'")
    + q("SELECT COUNT(*) n FROM post_comments WHERE image_status = 'pending' AND status = 'visible'")
    + q("SELECT COUNT(*) n FROM users WHERE avatar_pending_url != '' AND status != 'banned'")
    + q("SELECT COUNT(*) n FROM conversations WHERE flagged = 1");
}

export function resolveReport(id, resolution) {
  const r = db.prepare("UPDATE reports SET status = 'resolved', resolution = ?, resolved_at = datetime('now') WHERE id = ? AND status = 'open'")
    .run(String(resolution || "dismissed"), id);
  if (!r.changes) throw new Error("Report not found");
}

export function resolveEvent(id) {
  const r = db.prepare("UPDATE moderation_events SET status = 'resolved' WHERE id = ?").run(id);
  if (!r.changes) throw new Error("Event not found");
}

export function getReport(id) {
  const r = db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
  return r ? { ...r, target: describeTarget(r) } : null;
}
