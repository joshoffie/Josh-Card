// ---------------------------------------------------------------------------
// Member media lifecycle
//
//   upload  → saved PRIVATELY in data/uploads/pending (never public)
//   viewing → only the uploader and admins get a short-lived signed URL
//   approve → published (Cloudinary if configured, else data/uploads/public)
//   reject / removal → file deleted
// ---------------------------------------------------------------------------
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { db } from "./store.js";

export const PENDING_DIR = resolve("data/uploads/pending");
export const PUBLIC_DIR = resolve("data/uploads/public");
mkdirSync(PENDING_DIR, { recursive: true });
mkdirSync(PUBLIC_DIR, { recursive: true });

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
export const FILE_RE = /^[a-f0-9]{24}\.(jpg|png|webp|gif)$/;

// Signing secret, generated once and kept in the database
db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
let SECRET = db.prepare("SELECT value FROM settings WHERE key = 'media_secret'").get()?.value;
if (!SECRET) {
  SECRET = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO settings (key, value) VALUES ('media_secret', ?)").run(SECRET);
}

const cloudinaryReady = () => !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

export function savePending(buffer, mime) {
  const name = `${randomBytes(12).toString("hex")}.${EXT[mime] || "bin"}`;
  writeFileSync(resolve(PENDING_DIR, name), buffer);
  return `/media/pending/${name}`;
}

const sign = (name, exp) => createHmac("sha256", SECRET).update(`${name}:${exp}`).digest("hex");

/** Pending path → signed, expiring URL path (for the uploader and admins only). */
export function signPending(path, ttlSeconds = 3600) {
  const m = String(path || "").match(/^\/media\/pending\/([a-f0-9]{24}\.(?:jpg|png|webp|gif))$/);
  if (!m) return path;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${path}?exp=${exp}&sig=${sign(m[1], exp)}`;
}

export function verifyPending(name, exp, sig) {
  if (!FILE_RE.test(name) || !/^\d+$/.test(String(exp)) || !/^[a-f0-9]{64}$/.test(String(sig))) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(name, exp));
  return timingSafeEqual(expected, Buffer.from(String(sig)));
}

export const isPendingPath = (p) => /^\/media\/pending\//.test(String(p || ""));

/** Make an approved image public. Returns the new public path. */
export async function publish(path) {
  if (!isPendingPath(path)) return path; // legacy remote URL — already hosted
  const name = path.split("/").pop();
  const file = resolve(PENDING_DIR, name);
  if (!FILE_RE.test(name) || !existsSync(file)) throw new Error("Image file is missing");
  if (cloudinaryReady()) {
    const result = await new Promise((ok, fail) => {
      const stream = cloudinary.uploader.upload_stream({ resource_type: "image", folder: "josh-blog-members" },
        (err, r) => (err ? fail(err) : ok(r)));
      stream.end(readFileSync(file));
    });
    unlinkSync(file);
    return `/media/image/upload/v${result.version}/${result.public_id}.${result.format}`;
  }
  renameSync(file, resolve(PUBLIC_DIR, name));
  return `/media/local/${name}`;
}

/** Delete a member image wherever it lives (best effort). */
export async function discard(path) {
  path = String(path || "");
  try {
    let m;
    if ((m = path.match(/^\/media\/(pending|local)\/([a-f0-9]{24}\.(?:jpg|png|webp|gif))$/))) {
      const file = resolve(m[1] === "pending" ? PENDING_DIR : PUBLIC_DIR, m[2]);
      if (existsSync(file)) unlinkSync(file);
    } else if ((m = path.match(/^\/media\/image\/upload\/v\d+\/(josh-blog-(?:members|avatars)\/[\w-]+)\.\w+$/)) && cloudinaryReady()) {
      await cloudinary.uploader.destroy(m[1], { invalidate: true });
    }
  } catch (e) {
    console.error("Media discard failed:", path, e.message);
  }
}
