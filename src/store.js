import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "dotenv";

config();

// ---------------------------------------------------------------------------
// Bootstrap certs from Base64 env vars (Railway / Docker)
// If *_B64 vars exist, decode them to /tmp/certs/ and use those paths.
// Falls back to file paths for local dev with certs/ directory.
// ---------------------------------------------------------------------------
const CERT_DIR = "/tmp/certs";

function b64ToFile(envVar, filename) {
  const b64 = process.env[envVar];
  if (!b64) return null;
  mkdirSync(CERT_DIR, { recursive: true });
  const outPath = resolve(CERT_DIR, filename);
  writeFileSync(outPath, Buffer.from(b64, "base64"));
  console.log(`  Decoded ${envVar} → ${outPath}`);
  return outPath;
}

const certPaths = {
  signerCert: b64ToFile("SIGNER_CERT_B64", "signerCert.pem"),
  signerKey:  b64ToFile("SIGNER_KEY_B64",  "signerKey.pem"),
  wwdr:       b64ToFile("WWDR_CERT_B64",   "wwdr.pem"),
  apnsKey:    b64ToFile("APNS_KEY_B64",    "APNsAuthKey.p8"),
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export const CFG = {
  passTypeId:     process.env.PASS_TYPE_ID,
  teamId:         process.env.TEAM_ID,
  signerCert:     certPaths.signerCert || resolve(process.env.SIGNER_CERT  || "certs/signerCert.pem"),
  signerKey:      certPaths.signerKey  || resolve(process.env.SIGNER_KEY   || "certs/signerKey.pem"),
  signerPass:     process.env.SIGNER_PASSPHRASE    || "",
  wwdr:           certPaths.wwdr       || resolve(process.env.WWDR_CERT     || "certs/wwdr.pem"),
  apnsKeyPath:    certPaths.apnsKey    || resolve(process.env.APNS_KEY_PATH || "certs/APNsAuthKey.p8"),
  apnsKeyId:      process.env.APNS_KEY_ID,
  apnsHost:       process.env.APNS_HOST || "https://api.push.apple.com",
  port:           parseInt(process.env.PORT || "3000", 10),
  webServiceUrl:  process.env.WEB_SERVICE_URL,
  artistName:     process.env.ARTIST_NAME || "Josh Card",
};

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------
const DB_PATH = resolve("data/fans.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS passes (
    serial       TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    email        TEXT,
    source       TEXT DEFAULT 'direct',
    fields_json  TEXT DEFAULT '{}',
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS registrations (
    device_lib_id TEXT NOT NULL,
    serial        TEXT NOT NULL,
    push_token    TEXT NOT NULL,
    registered_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (device_lib_id, serial)
  );

  CREATE TABLE IF NOT EXISTS content (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    latest_drop  TEXT DEFAULT '',
    drop_date    TEXT DEFAULT '',
    listen_url   TEXT DEFAULT '',
    message      TEXT DEFAULT '',
    updated_at   TEXT DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO content (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    post_type    TEXT NOT NULL DEFAULT 'text',
    title        TEXT DEFAULT '',
    body         TEXT DEFAULT '',
    media_url    TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    post_slug    TEXT NOT NULL,
    parent_id    INTEGER DEFAULT NULL,
    author_name  TEXT NOT NULL,
    body         TEXT NOT NULL,
    likes        INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
  );
`);

// Migrations — add columns if upgrading from older schema
try { db.exec("ALTER TABLE comments ADD COLUMN parent_id INTEGER DEFAULT NULL"); } catch(e) {}
try { db.exec("ALTER TABLE comments ADD COLUMN likes INTEGER DEFAULT 0"); } catch(e) {}

// ---------------------------------------------------------------------------
// Auth token — deterministic HMAC of the serial, no storage needed
// ---------------------------------------------------------------------------
const AUTH_SECRET = process.env.AUTH_SECRET || CFG.teamId || "fan-wallet-dev";

export function authTokenFor(serial) {
  return createHmac("sha256", AUTH_SECRET).update(serial).digest("hex");
}

export function verifyAuth(serial, token) {
  return token === authTokenFor(serial);
}

// ---------------------------------------------------------------------------
// Pass CRUD
// ---------------------------------------------------------------------------
const insertPass = db.prepare(`
  INSERT OR IGNORE INTO passes (serial, name, email, source)
  VALUES (?, ?, ?, ?)
`);
const getPass = db.prepare("SELECT * FROM passes WHERE serial = ?");
const allSerials = db.prepare("SELECT serial FROM passes");
const updatePassFields = db.prepare(`
  UPDATE passes SET fields_json = ?, updated_at = datetime('now')
  WHERE serial = ?
`);

export function createPass(serial, name, email, source = "direct") {
  insertPass.run(serial, name, email, source);
  return getPass.get(serial);
}

export function getPassBySerial(serial) {
  return getPass.get(serial);
}

export function getAllSerials() {
  return allSerials.all().map((r) => r.serial);
}

export function updateFields(serial, fields) {
  updatePassFields.run(JSON.stringify(fields), serial);
}

// ---------------------------------------------------------------------------
// Registrations (device ↔ pass)
// ---------------------------------------------------------------------------
const insertReg = db.prepare(`
  INSERT OR REPLACE INTO registrations (device_lib_id, serial, push_token)
  VALUES (?, ?, ?)
`);
const deleteReg = db.prepare(`
  DELETE FROM registrations WHERE device_lib_id = ? AND serial = ?
`);
const serialsForDevice = db.prepare(`
  SELECT serial FROM registrations WHERE device_lib_id = ?
`);
const tokensForSerial = db.prepare(`
  SELECT push_token FROM registrations WHERE serial = ?
`);

export function registerDevice(deviceLibId, serial, pushToken) {
  insertReg.run(deviceLibId, serial, pushToken);
}

export function unregisterDevice(deviceLibId, serial) {
  deleteReg.run(deviceLibId, serial);
}

export function getSerialsForDevice(deviceLibId) {
  return serialsForDevice.all(deviceLibId).map((r) => r.serial);
}

export function getTokensForSerial(serial) {
  return tokensForSerial.all(serial).map((r) => r.push_token);
}

export function getAllPushTokens() {
  const rows = db.prepare("SELECT DISTINCT push_token FROM registrations").all();
  return rows.map((r) => r.push_token);
}

// ---------------------------------------------------------------------------
// Content (singleton row for the exclusive page + broadcast state)
// ---------------------------------------------------------------------------
const getContent = db.prepare("SELECT * FROM content WHERE id = 1");
const updateContent = db.prepare(`
  UPDATE content
  SET latest_drop = ?, drop_date = ?, listen_url = ?, message = ?,
      updated_at = datetime('now')
  WHERE id = 1
`);

export function getCurrentContent() {
  return getContent.get();
}

export function setContent(latestDrop, dropDate, listenUrl, message) {
  updateContent.run(latestDrop, dropDate, listenUrl, message);
}

// ---------------------------------------------------------------------------
// Posts (fan-only blog feed)
// ---------------------------------------------------------------------------
const insertPost = db.prepare(`
  INSERT INTO posts (post_type, title, body, media_url) VALUES (?, ?, ?, ?)
`);
const listPosts = db.prepare(
  "SELECT * FROM posts ORDER BY created_at DESC LIMIT ?"
);
const deletePost = db.prepare("DELETE FROM posts WHERE id = ?");
const getPost = db.prepare("SELECT * FROM posts WHERE id = ?");

export function createPost(postType, title, body, mediaUrl) {
  const info = insertPost.run(postType, title, body, mediaUrl || "");
  return getPost.get(info.lastInsertRowid);
}

export function getPosts(limit = 50) {
  return listPosts.all(limit);
}

export function removePost(id) {
  return deletePost.run(id);
}

// ---------------------------------------------------------------------------
// Comments (public blog) — supports replies and likes
// ---------------------------------------------------------------------------
const insertComment = db.prepare(
  "INSERT INTO comments (post_slug, parent_id, author_name, body) VALUES (?, ?, ?, ?)"
);
const commentsBySlug = db.prepare(
  "SELECT * FROM comments WHERE post_slug = ? ORDER BY created_at ASC LIMIT 500"
);
const deleteComment = db.prepare("DELETE FROM comments WHERE id = ?");
const likeComment = db.prepare("UPDATE comments SET likes = likes + 1 WHERE id = ?");
const getCommentById = db.prepare("SELECT * FROM comments WHERE id = ?");

export function addComment(postSlug, authorName, body, parentId = null) {
  const info = insertComment.run(postSlug, parentId, authorName, body);
  return { id: info.lastInsertRowid, post_slug: postSlug, parent_id: parentId, author_name: authorName, body, likes: 0, created_at: new Date().toISOString() };
}

export function getComments(postSlug) {
  return commentsBySlug.all(postSlug);
}

export function incrementLike(commentId) {
  likeComment.run(commentId);
  return getCommentById.get(commentId);
}

export function removeComment(id) {
  return deleteComment.run(id);
}

// ---------------------------------------------------------------------------
// Content moderation — block slurs, allow foul language
// ---------------------------------------------------------------------------
const SLUR_PATTERNS = [
  /\bn[i1!]gg[ae3]r?s?\b/i,
  /\bf[a@]gg?[o0]t?s?\b/i,
  /\bk[i1!]ke?s?\b/i,
  /\bsp[i1!]c?k?s?\b/i,
  /\bch[i1!]nk?s?\b/i,
  /\bw[e3]tb[a@]ck?s?\b/i,
  /\btr[a@]nn(?:y|ie)s?\b/i,
  /\br[e3]t[a@]rd?s?\b/i,
  /\bcoon?s?\b/i,
  /\bgook?s?\b/i,
  /\bdyke?s?\b/i,
  /\bhomo?s?\b/i,
];

export function containsSlurs(text) {
  return SLUR_PATTERNS.some(p => p.test(text));
}
