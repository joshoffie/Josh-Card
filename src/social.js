// ---------------------------------------------------------------------------
// Social features: users, sessions, friends, user posts, DMs
// ---------------------------------------------------------------------------
import { db } from "./store.js";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

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

  CREATE TABLE IF NOT EXISTS user_posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    body         TEXT DEFAULT '',
    media_url    TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id    INTEGER NOT NULL,
    receiver_id  INTEGER NOT NULL,
    body         TEXT NOT NULL,
    is_read      INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );
`);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const SALT_ROUNDS = 10;

const insertUser = db.prepare(
  "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)"
);
const getUserByUsername = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE");
const getUserById = db.prepare("SELECT id, username, display_name, bio, avatar_url, created_at FROM users WHERE id = ?");
const insertSession = db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)");
const getSession = db.prepare("SELECT * FROM sessions WHERE token = ?");
const deleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");
const updateProfile = db.prepare(
  "UPDATE users SET display_name = ?, bio = ?, avatar_url = ? WHERE id = ?"
);

export async function registerUser(username, password) {
  if (!username || username.length < 3 || username.length > 20) {
    throw new Error("Username must be 3-20 characters");
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    throw new Error("Username can only contain letters, numbers, and underscores");
  }
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  const existing = getUserByUsername.get(username);
  if (existing) throw new Error("Username already taken");

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const info = insertUser.run(username, hash, username);
  const token = randomBytes(32).toString("hex");
  insertSession.run(token, info.lastInsertRowid);
  return { userId: info.lastInsertRowid, token };
}

export async function loginUser(username, password) {
  const user = getUserByUsername.get(username);
  if (!user) throw new Error("Invalid username or password");
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new Error("Invalid username or password");
  const token = randomBytes(32).toString("hex");
  insertSession.run(token, user.id);
  return { userId: user.id, token };
}

export function logoutUser(token) {
  deleteSession.run(token);
}

export function getSessionUser(token) {
  const session = getSession.get(token);
  if (!session) return null;
  return getUserById.get(session.user_id);
}

export function getPublicProfile(username) {
  const user = getUserByUsername.get(username);
  if (!user) return null;
  return { id: user.id, username: user.username, display_name: user.display_name, bio: user.bio, avatar_url: user.avatar_url, created_at: user.created_at };
}

export function getProfileById(id) {
  return getUserById.get(id);
}

export function updateUserProfile(userId, displayName, bio, avatarUrl) {
  updateProfile.run(displayName, bio, avatarUrl, userId);
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
const insertFriendReq = db.prepare(
  "INSERT OR IGNORE INTO friendships (requester_id, addressee_id) VALUES (?, ?)"
);
const getFriendship = db.prepare(
  "SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)"
);
const acceptFriend = db.prepare(
  "UPDATE friendships SET status = 'accepted' WHERE id = ? AND addressee_id = ?"
);
const rejectFriend = db.prepare(
  "DELETE FROM friendships WHERE id = ? AND addressee_id = ?"
);
const listFriends = db.prepare(`
  SELECT u.id, u.username, u.display_name, u.avatar_url FROM users u
  JOIN friendships f ON (
    (f.requester_id = u.id AND f.addressee_id = ? AND f.status = 'accepted')
    OR (f.addressee_id = u.id AND f.requester_id = ? AND f.status = 'accepted')
  )
`);
const listPendingRequests = db.prepare(`
  SELECT f.id as request_id, u.id, u.username, u.display_name, u.avatar_url, f.created_at
  FROM friendships f JOIN users u ON f.requester_id = u.id
  WHERE f.addressee_id = ? AND f.status = 'pending'
  ORDER BY f.created_at DESC
`);
const listSentRequests = db.prepare(`
  SELECT f.id as request_id, u.id, u.username, u.display_name, u.avatar_url
  FROM friendships f JOIN users u ON f.addressee_id = u.id
  WHERE f.requester_id = ? AND f.status = 'pending'
`);

export function sendFriendRequest(requesterId, addresseeId) {
  if (requesterId === addresseeId) throw new Error("Cannot friend yourself");
  const existing = getFriendship.get(requesterId, addresseeId, addresseeId, requesterId);
  if (existing) {
    if (existing.status === "accepted") throw new Error("Already friends");
    throw new Error("Request already exists");
  }
  insertFriendReq.run(requesterId, addresseeId);
}

export function acceptFriendRequest(requestId, userId) {
  const result = acceptFriend.run(requestId, userId);
  if (!result.changes) throw new Error("Request not found");
}

export function rejectFriendRequest(requestId, userId) {
  const result = rejectFriend.run(requestId, userId);
  if (!result.changes) throw new Error("Request not found");
}

export function removeFriend(userId, friendId) {
  db.prepare("DELETE FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))").run(userId, friendId, friendId, userId);
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

export function getFriendshipStatus(userId, otherUserId) {
  const f = getFriendship.get(userId, otherUserId, otherUserId, userId);
  if (!f) return "none";
  if (f.status === "accepted") return "friends";
  if (f.requester_id === userId) return "sent";
  return "pending";
}

// ---------------------------------------------------------------------------
// User Posts
// ---------------------------------------------------------------------------
const insertUserPost = db.prepare(
  "INSERT INTO user_posts (user_id, body, media_url) VALUES (?, ?, ?)"
);
const userPostsByUser = db.prepare(
  "SELECT up.*, u.username, u.display_name, u.avatar_url FROM user_posts up JOIN users u ON up.user_id = u.id WHERE up.user_id = ? ORDER BY up.created_at DESC LIMIT ?"
);
const deleteUserPost = db.prepare(
  "DELETE FROM user_posts WHERE id = ? AND user_id = ?"
);
const feedPosts = db.prepare(`
  SELECT up.*, u.username, u.display_name, u.avatar_url FROM user_posts up
  JOIN users u ON up.user_id = u.id
  WHERE up.user_id = ? OR up.user_id IN (
    SELECT CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
    FROM friendships f
    WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
  )
  ORDER BY up.created_at DESC LIMIT ?
`);

export function createUserPost(userId, body, mediaUrl) {
  const info = insertUserPost.run(userId, body, mediaUrl || "");
  return { id: info.lastInsertRowid, user_id: userId, body, media_url: mediaUrl, created_at: new Date().toISOString() };
}

export function getUserPosts(userId, limit = 50) {
  return userPostsByUser.all(userId, limit);
}

export function deleteUserPostById(postId, userId) {
  return deleteUserPost.run(postId, userId);
}

export function getFeedPosts(userId, limit = 50) {
  return feedPosts.all(userId, userId, userId, userId, limit);
}

// ---------------------------------------------------------------------------
// Messages (DMs)
// ---------------------------------------------------------------------------
const insertMsg = db.prepare(
  "INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)"
);
const getConversation = db.prepare(`
  SELECT m.*, 
    s.username as sender_username, s.display_name as sender_display_name,
    r.username as receiver_username, r.display_name as receiver_display_name
  FROM messages m
  JOIN users s ON m.sender_id = s.id
  JOIN users r ON m.receiver_id = r.id
  WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
  ORDER BY m.created_at ASC LIMIT ?
`);
const markRead = db.prepare(
  "UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0"
);
const conversations = db.prepare(`
  SELECT 
    u.id, u.username, u.display_name, u.avatar_url,
    m.body as last_message, m.created_at as last_message_at,
    (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread
  FROM users u
  JOIN messages m ON m.id = (
    SELECT id FROM messages 
    WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id)
    ORDER BY created_at DESC LIMIT 1
  )
  WHERE u.id != ?
  ORDER BY m.created_at DESC
`);
const unreadCount = db.prepare(
  "SELECT COUNT(*) as c FROM messages WHERE receiver_id = ? AND is_read = 0"
);

export function sendMessage(senderId, receiverId, body) {
  if (!body?.trim()) throw new Error("Message cannot be empty");
  if (body.length > 2000) throw new Error("Message too long");
  const info = insertMsg.run(senderId, receiverId, body.trim());
  return { id: info.lastInsertRowid, sender_id: senderId, receiver_id: receiverId, body: body.trim(), created_at: new Date().toISOString() };
}

export function getMessages(userId, otherUserId, limit = 100) {
  markRead.run(otherUserId, userId);
  return getConversation.all(userId, otherUserId, otherUserId, userId, limit);
}

export function getConversations(userId) {
  return conversations.all(userId, userId, userId, userId);
}

export function getUnreadCount(userId) {
  return unreadCount.get(userId).c;
}

// ---------------------------------------------------------------------------
// Search users
// ---------------------------------------------------------------------------
const searchUsers = db.prepare(
  "SELECT id, username, display_name, avatar_url FROM users WHERE username LIKE ? LIMIT 20"
);

export function findUsers(query) {
  return searchUsers.all(`%${query}%`);
}
