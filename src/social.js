// ---------------------------------------------------------------------------
// Accounts, sessions, friends, profiles
// ---------------------------------------------------------------------------
import { db } from "./store.js";
import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    bio          TEXT DEFAULT '',
    avatar_url   TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token        TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    created_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    addressee_id INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (requester_id) REFERENCES users(id),
    FOREIGN KEY (addressee_id) REFERENCES users(id),
    UNIQUE(requester_id, addressee_id)
  );

  -- Legacy tables (kept for history; no longer written to)
  CREATE TABLE IF NOT EXISTS user_posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    body         TEXT DEFAULT '',
    media_url    TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id    INTEGER NOT NULL,
    receiver_id  INTEGER NOT NULL,
    body         TEXT NOT NULL,
    is_read      INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );
`);

export function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

addColumn("users", "points", "INTEGER DEFAULT 0");
addColumn("users", "status", "TEXT DEFAULT 'active'");        // active | suspended | banned
addColumn("users", "status_reason", "TEXT DEFAULT ''");
addColumn("users", "age_confirmed_at", "TEXT DEFAULT NULL");
addColumn("users", "terms_accepted_at", "TEXT DEFAULT NULL");
addColumn("users", "last_visit_day", "TEXT DEFAULT ''");
addColumn("user_posts", "hidden", "INTEGER DEFAULT 0");

// ---------------------------------------------------------------------------
// Admin accounts (can post, moderate). Comma-separated usernames.
// ---------------------------------------------------------------------------
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || "josh")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export function isAdmin(user) {
  return !!user && ADMIN_USERNAMES.includes(String(user.username).toLowerCase());
}

export function adminUser() {
  return db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE username = ? COLLATE NOCASE`).get(ADMIN_USERNAMES[0]);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const SALT_ROUNDS = 10;
const PUBLIC_COLS = "id, username, display_name, bio, avatar_url, created_at, points, status, (age_confirmed_at IS NOT NULL AND terms_accepted_at IS NOT NULL) AS confirmed";

const insertUser = db.prepare(
  `INSERT INTO users (username, password_hash, display_name, age_confirmed_at, terms_accepted_at)
   VALUES (?, ?, ?, datetime('now'), datetime('now'))`
);
const getUserByUsername = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE");
const getUserById = db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`);
const insertSession = db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)");
const getSession = db.prepare("SELECT * FROM sessions WHERE token = ?");
const deleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");
const updateProfile = db.prepare("UPDATE users SET display_name = ?, bio = ?, avatar_url = ? WHERE id = ?");

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function registerUser(username, password, { ageConfirmed, termsAccepted, adminPassword } = {}) {
  username = String(username || "").trim();
  // Admin usernames are reserved: claiming one requires the server's ADMIN_PASSWORD
  if (ADMIN_USERNAMES.includes(username.toLowerCase())) {
    const pw = process.env.ADMIN_PASSWORD || "";
    if (!pw || !safeEqual(adminPassword, pw)) throw new Error("That username is reserved");
  }
  if (!ageConfirmed) throw new Error("You must be 18 or older to join");
  if (!termsAccepted) throw new Error("You need to agree to the community rules to join");
  if (username.length < 3 || username.length > 20) throw new Error("Username must be 3-20 characters");
  if (!/^[a-zA-Z0-9_]+$/.test(username)) throw new Error("Username can only contain letters, numbers, and underscores");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");
  if (getUserByUsername.get(username)) throw new Error("Username already taken");

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const info = insertUser.run(username, hash, username);
  const token = randomBytes(32).toString("hex");
  insertSession.run(token, info.lastInsertRowid);
  return { userId: Number(info.lastInsertRowid), token };
}

export async function loginUser(username, password) {
  const user = getUserByUsername.get(String(username || ""));
  if (!user) throw new Error("Invalid username or password");
  const valid = await bcrypt.compare(String(password || ""), user.password_hash);
  if (!valid) throw new Error("Invalid username or password");
  if (user.status === "banned") throw new Error("This account has been banned.");
  const token = randomBytes(32).toString("hex");
  insertSession.run(token, user.id);
  return { userId: user.id, token };
}

export function logoutUser(token) {
  deleteSession.run(token);
}

export function getSessionUser(token) {
  if (!token) return null;
  const session = getSession.get(token);
  if (!session) return null;
  return getUserById.get(session.user_id) || null;
}

export function getProfileById(id) {
  return getUserById.get(id);
}

export function getPublicProfile(username) {
  const user = getUserByUsername.get(String(username || ""));
  if (!user) return null;
  return getUserById.get(user.id);
}

export function userExists(id) {
  return Number.isInteger(id) && !!getUserById.get(id);
}

export function isActive(user) {
  return !!user && (user.status || "active") === "active";
}

export function updateUserProfile(userId, displayName, bio, avatarUrl) {
  displayName = String(displayName ?? "").trim();
  bio = String(bio ?? "").trim();
  if (displayName.length > 50) throw new Error("Display name must be 50 characters or fewer");
  if (bio.length > 300) throw new Error("Bio must be 300 characters or fewer");
  updateProfile.run(displayName, bio, avatarUrl || "", userId);
}

// Accounts created before the 18+ / rules requirement confirm on next visit
export function confirmAgeAndTerms(userId) {
  db.prepare(`UPDATE users SET age_confirmed_at = COALESCE(age_confirmed_at, datetime('now')),
    terms_accepted_at = COALESCE(terms_accepted_at, datetime('now')) WHERE id = ?`).run(userId);
}

export function setUserStatus(userId, status, reason = "") {
  if (!["active", "suspended", "banned"].includes(status)) throw new Error("Invalid status");
  db.prepare("UPDATE users SET status = ?, status_reason = ? WHERE id = ?").run(status, reason, userId);
  if (status === "banned") db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

// Daily visit — returns true the first time each UTC day
export function markVisit(userId) {
  const day = new Date().toISOString().slice(0, 10);
  const r = db.prepare("UPDATE users SET last_visit_day = ? WHERE id = ? AND last_visit_day != ?").run(day, userId, day);
  return r.changes > 0;
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
const insertFriendReq = db.prepare("INSERT OR IGNORE INTO friendships (requester_id, addressee_id) VALUES (?, ?)");
const getFriendship = db.prepare(
  "SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)"
);
const acceptFriend = db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ? AND addressee_id = ? AND status = 'pending'");
const rejectFriend = db.prepare("DELETE FROM friendships WHERE id = ? AND addressee_id = ? AND status = 'pending'");
const listFriends = db.prepare(`
  SELECT u.id, u.username, u.display_name, u.avatar_url, u.created_at, u.points FROM users u
  JOIN friendships f ON (
    (f.requester_id = u.id AND f.addressee_id = ? AND f.status = 'accepted')
    OR (f.addressee_id = u.id AND f.requester_id = ? AND f.status = 'accepted')
  )
  WHERE u.status != 'banned'
  ORDER BY u.username COLLATE NOCASE
`);
const listPendingRequests = db.prepare(`
  SELECT f.id as request_id, u.id, u.username, u.display_name, u.avatar_url, f.created_at
  FROM friendships f JOIN users u ON f.requester_id = u.id
  WHERE f.addressee_id = ? AND f.status = 'pending' AND u.status != 'banned'
  ORDER BY f.created_at DESC
`);
const listSentRequests = db.prepare(`
  SELECT f.id as request_id, u.id, u.username, u.display_name, u.avatar_url
  FROM friendships f JOIN users u ON f.addressee_id = u.id
  WHERE f.requester_id = ? AND f.status = 'pending'
`);

export function sendFriendRequest(requesterId, addresseeId) {
  if (requesterId === addresseeId) throw new Error("Cannot friend yourself");
  const target = getUserById.get(addresseeId);
  if (!target || target.status === "banned") throw new Error("User not found");
  const existing = getFriendship.get(requesterId, addresseeId, addresseeId, requesterId);
  if (existing) {
    if (existing.status === "accepted") throw new Error("Already friends");
    throw new Error("Request already exists");
  }
  insertFriendReq.run(requesterId, addresseeId);
}

export function acceptFriendRequest(requestId, userId) {
  if (!acceptFriend.run(requestId, userId).changes) throw new Error("Request not found");
}

export function rejectFriendRequest(requestId, userId) {
  if (!rejectFriend.run(requestId, userId).changes) throw new Error("Request not found");
}

export function removeFriend(userId, friendId) {
  db.prepare(
    "DELETE FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))"
  ).run(userId, friendId, friendId, userId);
}

export function areFriends(a, b) {
  const f = getFriendship.get(a, b, b, a);
  return !!f && f.status === "accepted";
}

export function getFriends(userId) {
  return listFriends.all(userId, userId);
}

export function getPendingRequests(userId) {
  return listPendingRequests.all(userId);
}

export function getSentRequests(userId) {
  return listSentRequests.all(userId);
}

export function getIncomingRequestId(userId, otherUserId) {
  const f = getFriendship.get(userId, otherUserId, otherUserId, userId);
  return f && f.status === "pending" && f.addressee_id === userId ? f.id : null;
}

export function getFriendshipStatus(userId, otherUserId) {
  const f = getFriendship.get(userId, otherUserId, otherUserId, userId);
  if (!f) return "none";
  if (f.status === "accepted") return "friends";
  if (f.requester_id === userId) return "sent";
  return "pending";
}

// ---------------------------------------------------------------------------
// Search users (literal match; banned accounts excluded)
// ---------------------------------------------------------------------------
const searchUsers = db.prepare(
  "SELECT id, username, display_name, avatar_url FROM users WHERE username LIKE ? ESCAPE '\\' AND status != 'banned' LIMIT 20"
);

export function findUsers(query) {
  const escaped = String(query).slice(0, 50).replace(/[\\%_]/g, (c) => "\\" + c);
  return searchUsers.all(`%${escaped}%`);
}
