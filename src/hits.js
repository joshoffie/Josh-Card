// Hit counter for the footer ("you are visitor #000123").
// Counts each visitor once per day. Visitors are told apart by a salted hash of
// their IP address that is kept in memory only for the current day.
import { createHash, randomBytes } from "node:crypto";
import { db } from "./store.js";

db.exec(`CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`);
db.prepare("INSERT OR IGNORE INTO counters (name, value) VALUES ('visitors', 0)").run();

const getStmt = db.prepare("SELECT value FROM counters WHERE name = 'visitors'");
const bumpStmt = db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'visitors'");

let day = "";
let salt = randomBytes(16);
let seen = new Set();

export function total() {
  return getStmt.get()?.value || 0;
}

export function countVisit(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; salt = randomBytes(16); seen = new Set(); }
  const key = createHash("sha256").update(salt).update(String(ip || "")).digest("base64").slice(0, 22);
  if (!seen.has(key) && seen.size < 200000) {
    seen.add(key);
    bumpStmt.run();
  }
  return total();
}
