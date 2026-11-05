// ---------------------------------------------------------------------------
// Chats: 1-on-1 DMs between friends, and group chats.
// Adding people to a DM starts a NEW group (the 1-on-1 history stays private).
// ---------------------------------------------------------------------------
import { db } from "./store.js";
import { areFriends, getProfileById, addColumn } from "./social.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT DEFAULT (datetime('now')));

  CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    is_group    INTEGER NOT NULL DEFAULT 0,
    name        TEXT DEFAULT '',
    dm_key      TEXT UNIQUE,              -- "minId:maxId" for 1-on-1s
    created_by  INTEGER,
    flagged     INTEGER DEFAULT 0,        -- rule-based monitoring hit; shows in admin queue
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    joined_at       TEXT DEFAULT (datetime('now')),
    last_read_id    INTEGER DEFAULT 0,
    left_at         TEXT DEFAULT NULL,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id       INTEGER,
    kind            TEXT DEFAULT 'text',     -- text | system
    body            TEXT DEFAULT '',
    gif_url         TEXT DEFAULT '',
    flags           TEXT DEFAULT '',         -- comma list of review flags
    status          TEXT DEFAULT 'visible',  -- visible | removed
    created_at      TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_chat_conv ON chat_messages(conversation_id, id);
  CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
`);

// Members only see messages after start_id (the point they joined or re-joined)
addColumn("conversation_members", "start_id", "INTEGER DEFAULT 0");

const MAX_GROUP = 50;
const maxMsgId = (convId) => db.prepare("SELECT COALESCE(MAX(id), 0) m FROM chat_messages WHERE conversation_id = ?").get(convId).m;
const dmKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;

// ---------------------------------------------------------------------------
// One-time: move old 1-on-1 messages into conversations
// ---------------------------------------------------------------------------
if (!db.prepare("SELECT 1 FROM migrations WHERE name = 'chat-from-legacy-messages'").get()) {
  db.transaction(() => {
    const old = db.prepare("SELECT * FROM messages ORDER BY id").all();
    const convFor = new Map();
    for (const m of old) {
      const key = dmKey(m.sender_id, m.receiver_id);
      if (m.sender_id === m.receiver_id) continue;
      if (!convFor.has(key)) {
        const info = db.prepare("INSERT OR IGNORE INTO conversations (is_group, dm_key, created_by, created_at) VALUES (0, ?, ?, ?)")
          .run(key, m.sender_id, m.created_at);
        const id = info.changes ? Number(info.lastInsertRowid) : db.prepare("SELECT id FROM conversations WHERE dm_key = ?").get(key).id;
        db.prepare("INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?), (?, ?, ?)")
          .run(id, m.sender_id, m.created_at, id, m.receiver_id, m.created_at);
        convFor.set(key, id);
      }
      const cid = convFor.get(key);
      const ins = db.prepare("INSERT INTO chat_messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)")
        .run(cid, m.sender_id, m.body, m.created_at);
      const newId = Number(ins.lastInsertRowid);
      // Sender has read their own message; receiver has read it if is_read
      db.prepare("UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?").run(newId, cid, m.sender_id);
      if (m.is_read) db.prepare("UPDATE conversation_members SET last_read_id = MAX(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?").run(newId, cid, m.receiver_id);
      db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(m.created_at, cid);
    }
    db.prepare("INSERT INTO migrations (name) VALUES ('chat-from-legacy-messages')").run();
  })();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isMember(convId, userId) {
  return !!db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL").get(convId, userId);
}

function getConv(convId) {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId);
}

function members(convId) {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_url, u.status
    FROM conversation_members m JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ? AND m.left_at IS NULL ORDER BY m.joined_at`).all(convId);
}

function systemMessage(convId, text) {
  db.prepare("INSERT INTO chat_messages (conversation_id, sender_id, kind, body) VALUES (?, NULL, 'system', ?)").run(convId, text);
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(convId);
}

const nameOf = (u) => u?.display_name || u?.username || "Someone";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function listChats(userId) {
  const convs = db.prepare(`
    SELECT c.*, m.last_read_id, m.start_id FROM conversations c
    JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ? AND m.left_at IS NULL
    ORDER BY c.updated_at DESC, c.id DESC LIMIT 200`).all(userId);
  return convs.map((c) => {
    const last = db.prepare("SELECT id, sender_id, kind, body, gif_url, created_at FROM chat_messages WHERE conversation_id = ? AND id > ? AND status = 'visible' ORDER BY id DESC LIMIT 1").get(c.id, c.start_id || 0);
    const unread = db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE conversation_id = ? AND id > ? AND status = 'visible' AND kind = 'text' AND (sender_id IS NULL OR sender_id != ?)").get(c.id, Math.max(c.last_read_id, c.start_id || 0), userId).n;
    return { id: c.id, is_group: !!c.is_group, name: c.name, members: members(c.id), last_message: last || null, unread, updated_at: c.updated_at };
  });
}

export function unreadChatCount(userId) {
  return db.prepare(`
    SELECT COUNT(*) n FROM chat_messages x
    JOIN conversation_members m ON m.conversation_id = x.conversation_id AND m.user_id = ? AND m.left_at IS NULL
    WHERE x.id > MAX(m.last_read_id, m.start_id) AND x.status = 'visible' AND x.kind = 'text' AND x.sender_id != ?`).get(userId, userId).n;
}

export function getOrCreateDM(userId, otherId) {
  if (userId === otherId) throw new Error("You can't message yourself");
  const other = getProfileById(otherId);
  if (!other || other.status === "banned") throw new Error("User not found");
  if (!areFriends(userId, otherId)) throw new Error("You can only message friends. Send a friend request first.");
  const key = dmKey(userId, otherId);
  let conv = db.prepare("SELECT * FROM conversations WHERE dm_key = ?").get(key);
  if (!conv) {
    const info = db.prepare("INSERT INTO conversations (is_group, dm_key, created_by) VALUES (0, ?, ?)").run(key, userId);
    conv = getConv(Number(info.lastInsertRowid));
    db.prepare("INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)").run(conv.id, userId, conv.id, otherId);
  }
  return conv.id;
}

export function getChat(convId, userId, { afterId = 0 } = {}) {
  const conv = getConv(convId);
  if (!conv || !isMember(convId, userId)) throw Object.assign(new Error("Chat not found"), { status: 404 });
  const startId = db.prepare("SELECT start_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, userId)?.start_id || 0;
  const msgs = db.prepare(`
    SELECT x.id, x.sender_id, x.kind, x.body, x.gif_url, x.created_at,
      u.username, u.display_name, u.avatar_url
    FROM chat_messages x LEFT JOIN users u ON u.id = x.sender_id
    WHERE x.conversation_id = ? AND x.status = 'visible' AND x.id > ?
    ORDER BY x.id DESC LIMIT 300`).all(convId, Math.max(afterId, startId)).reverse();
  if (msgs.length) {
    db.prepare("UPDATE conversation_members SET last_read_id = MAX(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?")
      .run(msgs[msgs.length - 1].id, convId, userId);
  }
  const mem = members(convId);
  let canSend = true, reason = "";
  if (!conv.is_group) {
    const other = mem.find((m) => m.id !== userId);
    if (!other || !areFriends(userId, other.id)) { canSend = false; reason = "You're no longer friends, so this chat is read-only."; }
  }
  return { id: conv.id, is_group: !!conv.is_group, name: conv.name, members: mem, messages: msgs, can_send: canSend, read_only_reason: reason };
}

export function sendChatMessage(convId, userId, { body = "", gifUrl = "", flags = [] }) {
  body = String(body || "").trim();
  const conv = getConv(convId);
  if (!conv || !isMember(convId, userId)) throw Object.assign(new Error("Chat not found"), { status: 404 });
  if (!body && !gifUrl) throw new Error("Message can't be empty");
  if (body.length > 2000) throw new Error("Message must be 2,000 characters or fewer");
  if (!conv.is_group) {
    const other = members(convId).find((m) => m.id !== userId);
    if (!other || !areFriends(userId, other.id)) throw new Error("You're no longer friends, so you can't send messages here.");
  }
  const info = db.prepare("INSERT INTO chat_messages (conversation_id, sender_id, body, gif_url, flags) VALUES (?, ?, ?, ?, ?)")
    .run(convId, userId, body, gifUrl || "", flags.join(","));
  const id = Number(info.lastInsertRowid);
  db.prepare("UPDATE conversations SET updated_at = datetime('now')" + (flags.length ? ", flagged = 1" : "") + " WHERE id = ?").run(convId);
  db.prepare("UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?").run(id, convId, userId);
  return { id };
}

/** Add friends to a chat. On a 1-on-1, this creates a new group and returns its id. */
export function addMembers(convId, userId, userIds) {
  const conv = getConv(convId);
  if (!conv || !isMember(convId, userId)) throw Object.assign(new Error("Chat not found"), { status: 404 });
  const ids = [...new Set((userIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new Error("Pick at least one friend to add");
  const adder = getProfileById(userId);
  const current = members(convId).map((m) => m.id);
  if (!conv.is_group && current.some((m) => m !== userId && !areFriends(userId, m))) {
    throw new Error("You're no longer friends, so you can't start a group from this chat.");
  }
  const toAdd = ids.filter((id) => !current.includes(id));
  if (!toAdd.length) throw new Error("They're already in this chat");
  for (const id of toAdd) {
    const u = getProfileById(id);
    if (!u || u.status === "banned") throw new Error("User not found");
    if (!areFriends(userId, id)) throw new Error(`You can only add your friends (${u.username} isn't one yet)`);
  }
  if (current.length + toAdd.length > MAX_GROUP) throw new Error(`Group chats are limited to ${MAX_GROUP} people`);

  let targetId = convId;
  if (!conv.is_group) {
    const info = db.prepare("INSERT INTO conversations (is_group, created_by) VALUES (1, ?)").run(userId);
    targetId = Number(info.lastInsertRowid);
    for (const id of current) db.prepare("INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)").run(targetId, id);
    systemMessage(targetId, `${nameOf(adder)} started a group chat`);
  }
  const start = maxMsgId(targetId);
  for (const id of toAdd) {
    db.prepare(`INSERT INTO conversation_members (conversation_id, user_id, start_id, last_read_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_id, user_id) DO UPDATE SET left_at = NULL, joined_at = datetime('now'), start_id = excluded.start_id, last_read_id = excluded.last_read_id`)
      .run(targetId, id, start, start);
  }
  const names = toAdd.map((id) => nameOf(getProfileById(id))).join(", ");
  systemMessage(targetId, `${nameOf(adder)} added ${names}`);
  return targetId;
}

export function leaveGroup(convId, userId) {
  const conv = getConv(convId);
  if (!conv || !isMember(convId, userId)) throw Object.assign(new Error("Chat not found"), { status: 404 });
  if (!conv.is_group) throw new Error("You can't leave a 1-on-1 chat");
  db.prepare("UPDATE conversation_members SET left_at = datetime('now') WHERE conversation_id = ? AND user_id = ?").run(convId, userId);
  systemMessage(convId, `${nameOf(getProfileById(userId))} left`);
}

export function renameGroup(convId, userId, name) {
  const conv = getConv(convId);
  if (!conv || !isMember(convId, userId)) throw Object.assign(new Error("Chat not found"), { status: 404 });
  if (!conv.is_group) throw new Error("Only group chats can be renamed");
  name = String(name || "").trim();
  if (name.length > 50) throw new Error("Group name must be 50 characters or fewer");
  db.prepare("UPDATE conversations SET name = ? WHERE id = ?").run(name, convId);
  systemMessage(convId, `${nameOf(getProfileById(userId))} ${name ? `renamed the group to "${name}"` : "removed the group name"}`);
}

export function getMessage(id) {
  return db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id);
}

export function isChatMember(convId, userId) {
  return isMember(convId, userId);
}

// ---------------------------------------------------------------------------
// Admin views (monitoring)
// ---------------------------------------------------------------------------
export function adminGetChat(convId) {
  const conv = getConv(convId);
  if (!conv) throw Object.assign(new Error("Chat not found"), { status: 404 });
  const all = db.prepare(`
    SELECT u.id, u.username, u.display_name, m.left_at FROM conversation_members m JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ?`).all(convId);
  const msgs = db.prepare(`
    SELECT x.*, u.username FROM chat_messages x LEFT JOIN users u ON u.id = x.sender_id
    WHERE x.conversation_id = ? ORDER BY x.id DESC LIMIT 1000`).all(convId).reverse();
  return { ...conv, members: all, messages: msgs };
}

export function flaggedChats() {
  return db.prepare(`
    SELECT c.id, c.is_group, c.name, c.updated_at,
      (SELECT COUNT(*) FROM chat_messages x WHERE x.conversation_id = c.id AND x.flags != '') AS flagged_messages
    FROM conversations c WHERE c.flagged = 1 ORDER BY c.updated_at DESC LIMIT 100`).all()
    .map((c) => ({ ...c, members: members(c.id).map((m) => m.username) }));
}

export function clearChatFlag(convId) {
  db.prepare("UPDATE conversations SET flagged = 0 WHERE id = ?").run(convId);
  db.prepare("UPDATE chat_messages SET flags = '' WHERE conversation_id = ?").run(convId);
}

export function removeMessage(id) {
  const r = db.prepare("UPDATE chat_messages SET status = 'removed' WHERE id = ? AND kind = 'text'").run(id);
  if (!r.changes) throw new Error("Message not found");
}
