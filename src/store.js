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
  artistName:     process.env.ARTIST_NAME || "Fan Card",
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
`);

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
