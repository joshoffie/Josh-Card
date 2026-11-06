// YouTube lists for the YouTube tab (Josh's current channel) and the Old Stuff tab
// (his old channel), with no API key or paid service.
// Each channel's uploads-playlist RSS feed (newest 15 uploads) is checked at most every
// 15 minutes. Every video the feed has shown is remembered in the database, so uploads
// older than the newest 15 stay listed. A seed file can preload a channel's back catalog.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./store.js";

export const CHANNELS = {
  main: process.env.YOUTUBE_CHANNEL_ID || "UCGHriOkfa6n_a0LawFbTrQA",
  old: process.env.YOUTUBE_OLD_CHANNEL_ID || "UC58D_1R64itBfH4wjP8E8jQ",
};
export const CHANNEL_ID = CHANNELS.main;
const FEED_MAX = 15;
const REFRESH_MS = 15 * 60e3;
// A channel's uploads playlist id is its channel id with "UC" swapped for "UU"
const feedUrl = (ch) => `https://www.youtube.com/feeds/videos.xml?playlist_id=UU${ch.slice(2)}`;

db.exec(`CREATE TABLE IF NOT EXISTS youtube_videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  published TEXT NOT NULL DEFAULT '',
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
try { db.exec("ALTER TABLE youtube_videos ADD COLUMN pos INTEGER DEFAULT 0"); } catch {}

// Back catalog of the old channel (older than its feed reaches), newest first
const seedFile = resolve(dirname(fileURLToPath(import.meta.url)), "seed", "old-youtube.json");
if (existsSync(seedFile)) {
  try {
    const seed = JSON.parse(readFileSync(seedFile, "utf8"));
    const ins = db.prepare(`INSERT INTO youtube_videos (video_id, channel_id, title, published, pos) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET pos = excluded.pos`);
    db.transaction(() => { for (const v of seed.videos || []) ins.run(v.video_id, seed.channel_id, v.title || "", v.published || "", v.pos || 0); })();
  } catch (e) {
    console.warn("[youtube] couldn't load seed:", e.message);
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (_, e) => ENTITIES[e]);

export function parseFeed(xml) {
  const out = [];
  for (const [, e] of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    if (!id) continue;
    out.push({
      video_id: id,
      title: decode((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").trim(),
      published: (e.match(/<published>([^<]+)<\/published>/) || [])[1] || "",
    });
  }
  return out;
}

const stored = (ch) => db.prepare(
  "SELECT video_id, title, published, pos FROM youtube_videos WHERE channel_id = ?"
).all(ch);
// Newest first; videos without a known date keep the channel's own order after the dated ones
const byNewest = (a, b) => (b.published || "").localeCompare(a.published || "") || (a.pos || 0) - (b.pos || 0);

async function refresh(ch) {
  const r = await fetch(feedUrl(ch), { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`feed returned ${r.status}`);
  const feed = parseFeed(await r.text());
  const upsert = db.prepare(`INSERT INTO youtube_videos (video_id, channel_id, title, published) VALUES (?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, published = excluded.published`);
  db.transaction(() => { for (const v of feed) upsert.run(v.video_id, ch, v.title, v.published); })();
  // A feed with fewer than 15 entries is the whole channel. A full feed gets the
  // remembered uploads that are older than its oldest entry (or undated) added after it.
  let videos = feed;
  if (feed.length >= FEED_MAX) {
    const inFeed = new Set(feed.map((v) => v.video_id));
    const oldest = feed.reduce((min, v) => (v.published < min ? v.published : min), feed[0].published);
    videos = [...feed, ...stored(ch).filter((v) => !inFeed.has(v.video_id) && (!v.published || v.published < oldest))];
  }
  return videos.sort(byNewest).map(({ video_id, title, published }) => ({ video_id, title, published }));
}

const cache = new Map();
const inflight = new Map();

export async function listVideos(key = "main") {
  const ch = CHANNELS[key];
  if (!ch) throw Object.assign(new Error("Unknown channel"), { status: 404 });
  const c = cache.get(ch);
  if (c && Date.now() - c.at < REFRESH_MS) return { channel_id: ch, videos: c.videos };
  if (!inflight.has(ch)) {
    inflight.set(ch, refresh(ch)
      .then((videos) => { cache.set(ch, { at: Date.now(), videos }); return videos; })
      .catch((e) => {
        console.warn(`[youtube] ${key}: using saved list:`, e.message);
        const videos = stored(ch).sort(byNewest).map(({ video_id, title, published }) => ({ video_id, title, published }));
        cache.set(ch, { at: Date.now() - REFRESH_MS + 60e3, videos }); // try the feed again in a minute
        return videos;
      })
      .finally(() => inflight.delete(ch)));
  }
  return { channel_id: ch, videos: await inflight.get(ch) };
}
