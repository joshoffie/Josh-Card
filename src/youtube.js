// YouTube tab: lists every upload on Josh's channel, with no API key or paid service.
// The channel's uploads-playlist RSS feed (newest 15 uploads) is checked at most every
// 15 minutes. Every video the feed has shown is remembered in the database, so uploads
// older than the newest 15 stay listed once the channel grows past that.
import { db } from "./store.js";

export const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || "UCGHriOkfa6n_a0LawFbTrQA";
const FEED_MAX = 15;
const REFRESH_MS = 15 * 60e3;
// A channel's uploads playlist id is its channel id with "UC" swapped for "UU"
const feedUrl = () => `https://www.youtube.com/feeds/videos.xml?playlist_id=UU${CHANNEL_ID.slice(2)}`;

db.exec(`CREATE TABLE IF NOT EXISTS youtube_videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  published TEXT NOT NULL DEFAULT '',
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

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

const stored = () => db.prepare(
  "SELECT video_id, title, published FROM youtube_videos WHERE channel_id = ? ORDER BY published DESC"
).all(CHANNEL_ID);

async function refresh() {
  const r = await fetch(feedUrl(), { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`feed returned ${r.status}`);
  const feed = parseFeed(await r.text());
  const upsert = db.prepare(`INSERT INTO youtube_videos (video_id, channel_id, title, published) VALUES (?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, published = excluded.published`);
  db.transaction(() => { for (const v of feed) upsert.run(v.video_id, CHANNEL_ID, v.title, v.published); })();
  // A feed with fewer than 15 entries is the whole channel. A full feed gets the
  // remembered uploads that are older than its oldest entry added after it.
  let videos = feed;
  if (feed.length >= FEED_MAX) {
    const oldest = feed.reduce((min, v) => (v.published < min ? v.published : min), feed[0].published);
    videos = [...feed, ...stored().filter((v) => v.published < oldest)];
  }
  return videos.sort((a, b) => b.published.localeCompare(a.published));
}

let cache = null;
let inflight = null;

export async function listVideos() {
  if (cache && Date.now() - cache.at < REFRESH_MS) return cache.videos;
  inflight ||= refresh()
    .then((videos) => { cache = { at: Date.now(), videos }; return videos; })
    .catch((e) => {
      console.warn("[youtube] using saved list:", e.message);
      const videos = stored();
      cache = { at: Date.now() - REFRESH_MS + 60e3, videos }; // try the feed again in a minute
      return videos;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
