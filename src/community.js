// ---------------------------------------------------------------------------
// Community: Josh's posts, member comments, likes, activity points
// ---------------------------------------------------------------------------
import { db, CATEGORIES } from "./store.js";
import { adminUser, addColumn, isAdmin } from "./social.js";
import { signPending, discard, isPendingPath } from "./media.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    name   TEXT PRIMARY KEY,
    ran_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS post_comments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id      INTEGER NOT NULL,
    user_id      INTEGER NOT NULL,
    parent_id    INTEGER DEFAULT NULL,
    body         TEXT DEFAULT '',
    gif_url      TEXT DEFAULT '',
    image_url    TEXT DEFAULT '',
    image_status TEXT DEFAULT '',          -- '' | pending | approved | rejected
    status       TEXT DEFAULT 'visible',   -- visible | removed
    created_at   TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pc_post ON post_comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_pc_user ON post_comments(user_id);

  CREATE TABLE IF NOT EXISTS post_likes (
    post_id    INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (comment_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS points_ledger (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    reason     TEXT NOT NULL,
    ref        TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    day        TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE (user_id, reason, ref)
  );
`);

addColumn("users", "avatar_pending_url", "TEXT DEFAULT ''");

// ---------------------------------------------------------------------------
// One-time migrations
// ---------------------------------------------------------------------------
function runOnce(name, fn) {
  if (db.prepare("SELECT 1 FROM migrations WHERE name = ?").get(name)) return;
  db.transaction(() => {
    fn();
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(name);
  })();
  console.log(`Migration ran: ${name}`);
}

// Only Josh posts now: copy @josh's member posts into official posts, hide all member posts
{
  // Don't mark this done if Josh's account is missing but there are posts to carry over
  const josh = adminUser();
  const memberPosts = db.prepare("SELECT COUNT(*) n FROM user_posts").get().n;
  if (!josh && memberPosts) console.warn("Migration waiting: admin account not found; Josh's old posts not copied yet.");
  else runOnce("2026-11-official-posts-only", () => {
  if (josh) {
    const own = db.prepare("SELECT * FROM user_posts WHERE user_id = ? ORDER BY created_at").all(josh.id);
    const ins = db.prepare("INSERT INTO posts (post_type, title, body, media_url, category, created_at) VALUES (?, '', ?, ?, '', ?)");
    for (const p of own) {
      const type = !p.media_url ? "text" : /\/video\/upload\//.test(p.media_url) ? "video" : "image";
      ins.run(type, p.body || "", p.media_url || "", p.created_at);
    }
  }
  db.prepare("UPDATE user_posts SET hidden = 1").run();
  });
}

// Profile photos uploaded before review existed go into the approval queue
runOnce("2026-11-legacy-avatars-to-review", () => {
  const rows = db.prepare("SELECT id, username, avatar_url FROM users WHERE avatar_url != ''").all();
  for (const u of rows) {
    if (isAdmin(u)) continue;
    db.prepare("UPDATE users SET avatar_pending_url = avatar_url, avatar_url = '' WHERE id = ?").run(u.id);
  }
});

// ---------------------------------------------------------------------------
// Activity points
// ---------------------------------------------------------------------------
export const POINTS = {
  visit:          { amount: 1, dailyCap: 1 },   // opening the site, once a day
  comment:        { amount: 2, dailyCap: 10 },  // per comment (first 10 a day count)
  like_given:     { amount: 1, dailyCap: 10 },  // liking a post or comment (once per target, ever)
  like_received:  { amount: 1, dailyCap: 25 },  // someone likes your comment
  reply_received: { amount: 1, dailyCap: 10 },  // someone replies to your comment
};

const today = () => new Date().toISOString().slice(0, 10);

export function award(userId, reason, ref) {
  const rule = POINTS[reason];
  if (!rule || !userId) return 0;
  const day = today();
  const used = db.prepare("SELECT COUNT(*) c FROM points_ledger WHERE user_id = ? AND reason = ? AND day = ?").get(userId, reason, day).c;
  if (used >= rule.dailyCap) return 0;
  const r = db.prepare("INSERT OR IGNORE INTO points_ledger (user_id, reason, ref, amount, day) VALUES (?, ?, ?, ?, ?)")
    .run(userId, reason, String(ref), rule.amount, day);
  if (!r.changes) return 0;
  db.prepare("UPDATE users SET points = points + ? WHERE id = ?").run(rule.amount, userId);
  return rule.amount;
}

// ---------------------------------------------------------------------------
// Posts (read side; Josh-only writes go through store.createPost)
// ---------------------------------------------------------------------------
const POST_SELECT = `
  SELECT p.id, p.post_type, p.title, p.body, p.media_url, COALESCE(p.category, '') AS category, p.created_at,
    COALESCE(p.mood, '') AS mood, COALESCE(p.music, '') AS music,
    (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id AND c.status = 'visible') AS comment_count,
    EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = @viewer) AS liked
  FROM posts p
  WHERE COALESCE(p.hidden, 0) = 0`;

export function listPosts({ category = "", limit = 20, offset = 0, viewerId = 0 } = {}) {
  limit = Math.min(Math.max(parseInt(limit) || 20, 1), 50);
  offset = Math.max(parseInt(offset) || 0, 0);
  if (category && !CATEGORIES.includes(category)) return [];
  const where = category ? " AND p.category = @category" : "";
  return db.prepare(`${POST_SELECT}${where} ORDER BY p.created_at DESC, p.id DESC LIMIT @limit OFFSET @offset`)
    .all({ viewer: viewerId || 0, category, limit, offset })
    .map((p) => ({ ...p, liked: !!p.liked }));
}

export function getPost(id, viewerId = 0) {
  const p = db.prepare(`${POST_SELECT} AND p.id = @id`).get({ viewer: viewerId || 0, id });
  return p ? { ...p, liked: !!p.liked } : null;
}

export function togglePostLike(postId, userId) {
  if (!getPost(postId)) throw new Error("Post not found");
  const had = db.prepare("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?").run(postId, userId).changes;
  if (!had) {
    db.prepare("INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)").run(postId, userId);
    award(userId, "like_given", `post:${postId}`);
  }
  const count = db.prepare("SELECT COUNT(*) c FROM post_likes WHERE post_id = ?").get(postId).c;
  return { liked: !had, like_count: count };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
const COMMENT_SELECT = `
  SELECT c.id, c.post_id, c.user_id, c.parent_id, c.body, c.gif_url, c.image_url, c.image_status, c.status, c.created_at,
    u.username, u.display_name, u.avatar_url, u.created_at AS user_created_at, u.points AS user_points,
    (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id = c.id) AS like_count,
    EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = @viewer) AS liked
  FROM post_comments c JOIN users u ON u.id = c.user_id`;

// Images only show once approved. The uploader (and admins) see a pending image
// through a short-lived signed link; nobody else gets any URL for it.
function presentComment(c, viewerId, viewerIsAdmin) {
  const out = { ...c, liked: !!c.liked };
  if (!c.image_url) return out;
  if (c.image_status === "approved" && !isPendingPath(c.image_url)) return out;
  const canSeePending = viewerIsAdmin || (viewerId && c.user_id === viewerId);
  out.image_url = c.image_status === "pending" && canSeePending ? signPending(c.image_url) : "";
  return out;
}

export function listComments(postId, viewerId = 0, viewerIsAdmin = false) {
  return db.prepare(`${COMMENT_SELECT}
      WHERE c.post_id = @post AND c.status = 'visible' AND u.status != 'banned'
      ORDER BY c.created_at ASC, c.id ASC LIMIT 1000`)
    .all({ viewer: viewerId || 0, post: postId })
    .map((c) => presentComment(c, viewerId, viewerIsAdmin));
}

export function getComment(id) {
  return db.prepare(`${COMMENT_SELECT} WHERE c.id = @id`).get({ viewer: 0, id });
}

// Validate before any file is stored
export function assertCanComment({ postId, parentId = null, body = "", hasMedia = false }) {
  body = String(body || "").trim();
  if (!getPost(postId)) throw new Error("Post not found");
  if (!body && !hasMedia) throw new Error("Comment can't be empty");
  if (body.length > 2000) throw new Error("Comment must be 2,000 characters or fewer");
  if (parentId && !db.prepare("SELECT 1 FROM post_comments WHERE id = ? AND post_id = ? AND status = 'visible'").get(parentId, postId)) {
    throw new Error("The comment you're replying to is gone");
  }
}

export function addComment({ postId, userId, parentId = null, body = "", gifUrl = "", imageUrl = "", imageStatus = "" }) {
  body = String(body || "").trim();
  assertCanComment({ postId, parentId, body, hasMedia: !!(gifUrl || imageUrl) });
  let parent = null;
  if (parentId) {
    parent = db.prepare("SELECT * FROM post_comments WHERE id = ?").get(parentId);
    if (parent.parent_id) parentId = parent.parent_id; // keep threads one level deep
  }
  const info = db.prepare(
    "INSERT INTO post_comments (post_id, user_id, parent_id, body, gif_url, image_url, image_status) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(postId, userId, parentId || null, body, gifUrl || "", imageUrl || "", imageUrl ? imageStatus || "pending" : "");
  const id = Number(info.lastInsertRowid);
  award(userId, "comment", id);
  if (parent && parent.user_id !== userId) award(parent.user_id, "reply_received", id);
  return getComment(id);
}

export function removeComment(id, actor, actorIsAdmin) {
  const c = db.prepare("SELECT * FROM post_comments WHERE id = ?").get(id);
  if (!c || c.status !== "visible") throw new Error("Comment not found");
  if (!actorIsAdmin && c.user_id !== actor.id) throw new Error("You can only delete your own comments");
  db.prepare("UPDATE post_comments SET status = 'removed' WHERE id = ?").run(id);
  if (c.image_url) discard(c.image_url); // stop serving the file
}

export function getPendingCommentImage(id) {
  return db.prepare("SELECT id, image_url FROM post_comments WHERE id = ? AND image_status = 'pending' AND image_url != ''").get(id);
}

export function setCommentImage(id, status, url) {
  if (!["approved", "rejected"].includes(status)) throw new Error("Invalid status");
  db.prepare("UPDATE post_comments SET image_status = ?, image_url = ? WHERE id = ?").run(status, url || "", id);
}

export function toggleCommentLike(commentId, userId) {
  const c = db.prepare("SELECT * FROM post_comments WHERE id = ? AND status = 'visible'").get(commentId);
  if (!c) throw new Error("Comment not found");
  const had = db.prepare("DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?").run(commentId, userId).changes;
  if (!had) {
    db.prepare("INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)").run(commentId, userId);
    award(userId, "like_given", `comment:${commentId}`);
    if (c.user_id !== userId) award(c.user_id, "like_received", `comment:${commentId}:${userId}`);
  }
  const count = db.prepare("SELECT COUNT(*) c FROM comment_likes WHERE comment_id = ?").get(commentId).c;
  return { liked: !had, like_count: count };
}

// Account history shown on profiles
export function commentHistory(userId, viewerId = 0, viewerIsAdmin = false, limit = 30) {
  return db.prepare(`${COMMENT_SELECT}
      JOIN posts p ON p.id = c.post_id AND COALESCE(p.hidden, 0) = 0
      WHERE c.user_id = @user AND c.status = 'visible'
      ORDER BY c.created_at DESC, c.id DESC LIMIT @limit`)
    .all({ viewer: viewerId || 0, user: userId, limit })
    .map((c) => {
      const p = db.prepare("SELECT title, body, category FROM posts WHERE id = ?").get(c.post_id);
      return { ...presentComment(c, viewerId, viewerIsAdmin), post_snippet: (p?.title || p?.body || "").slice(0, 80), post_category: p?.category || "" };
    });
}

export function commentCount(userId) {
  return db.prepare("SELECT COUNT(*) c FROM post_comments WHERE user_id = ? AND status = 'visible'").get(userId).c;
}

// ---------------------------------------------------------------------------
// Profile photos — new uploads wait for approval
// ---------------------------------------------------------------------------
export function setPendingAvatar(userId, url) {
  const old = db.prepare("SELECT avatar_pending_url FROM users WHERE id = ?").get(userId)?.avatar_pending_url;
  if (old) discard(old);
  db.prepare("UPDATE users SET avatar_pending_url = ? WHERE id = ?").run(url, userId);
}

export function getPendingAvatar(userId) {
  return db.prepare("SELECT avatar_pending_url, avatar_url FROM users WHERE id = ?").get(userId);
}

export function finishAvatarReview(userId, approvedUrl) {
  const u = getPendingAvatar(userId);
  if (approvedUrl) {
    if (u?.avatar_url && u.avatar_url !== approvedUrl) discard(u.avatar_url);
    db.prepare("UPDATE users SET avatar_url = ?, avatar_pending_url = '' WHERE id = ?").run(approvedUrl, userId);
  } else {
    db.prepare("UPDATE users SET avatar_pending_url = '' WHERE id = ?").run(userId);
  }
}

// When an account is banned, stop serving everything it uploaded
export function purgeUserMedia(userId) {
  const rows = db.prepare("SELECT id, image_url FROM post_comments WHERE user_id = ? AND image_url != ''").all(userId);
  for (const r of rows) discard(r.image_url);
  db.prepare("UPDATE post_comments SET image_url = '', image_status = CASE WHEN image_status = '' THEN '' ELSE 'rejected' END WHERE user_id = ?").run(userId);
  const u = db.prepare("SELECT avatar_url, avatar_pending_url FROM users WHERE id = ?").get(userId);
  if (u?.avatar_url) discard(u.avatar_url);
  if (u?.avatar_pending_url) discard(u.avatar_pending_url);
  db.prepare("UPDATE users SET avatar_url = '', avatar_pending_url = '' WHERE id = ?").run(userId);
}

export function hasPendingAvatar(userId) {
  return !!db.prepare("SELECT 1 FROM users WHERE id = ? AND avatar_pending_url != ''").get(userId);
}

export function pendingImages() {
  const comments = db.prepare(`
    SELECT c.id, c.post_id, c.body, c.image_url, c.created_at, u.id AS user_id, u.username
    FROM post_comments c JOIN users u ON u.id = c.user_id
    WHERE c.image_status = 'pending' AND c.status = 'visible' ORDER BY c.created_at ASC LIMIT 200`).all();
  const avatars = db.prepare(`
    SELECT id AS user_id, username, avatar_pending_url AS image_url FROM users
    WHERE avatar_pending_url != '' AND status != 'banned' LIMIT 200`).all();
  return { comments, avatars };
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
export function accountAgeBadge(createdAt) {
  const t = new Date(String(createdAt || "").replace(" ", "T") + (String(createdAt).endsWith("Z") ? "" : "Z")).getTime();
  if (!t) return "New";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 7) return "New";
  if (days < 30) return "1 week";
  if (days < 90) return "1 month";
  if (days < 180) return "3 months";
  if (days < 365) return "6 months";
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year" : `${years} years`;
}
