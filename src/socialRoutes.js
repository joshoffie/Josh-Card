// ---------------------------------------------------------------------------
// Josh's Blog API — mounted at /api/social
//   Guests: read posts + comments.
//   Members (18+): comment, like, friend, chat, report.
//   Admin (@josh): post, moderate.
// ---------------------------------------------------------------------------
import { Router } from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPost, removePost, cleanLinks, CATEGORIES, MOODS } from "./store.js";
import * as S from "./social.js";
import * as C from "./community.js";
import * as Chat from "./chat.js";
import * as YouTube from "./youtube.js";
import * as Hits from "./hits.js";
import * as Safety from "./safety.js";
import { checkText, checkImage, sniffImage, sniffAudio, validGifUrl, aiModerationEnabled } from "./moderation.js";
import { limit, clientIp, hit } from "./ratelimit.js";
import { savePending, signPending, publish, discard, isPendingPath, PUBLIC_DIR } from "./media.js";

const router = Router();
const memberUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const adminUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 10 } });

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------
router.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

router.use((req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  req.user = S.getSessionUser(token);
  if (req.user?.status === "banned") req.user = null;
  next();
});

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    const status = e.status || (e.code === "LIMIT_FILE_SIZE" ? 413 : 400);
    if (status >= 500) console.error(e);
    res.status(status).json({ error: e.code === "LIMIT_FILE_SIZE" ? "That file is too large" : e.message || "Request failed" });
  });

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Log in or join to do that" });
  next();
}

// Members whose account is suspended can still read, but can't post or message
function requireActive(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Log in or join to do that" });
  if (!S.isActive(req.user)) return res.status(403).json({ error: "Your account is suspended pending review." });
  if (!req.user.confirmed) return res.status(403).json({ error: "Please confirm you're 18+ and agree to the rules first.", code: "confirm_required" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !S.isAdmin(req.user) || !S.isActive(req.user)) return res.status(403).json({ error: "Admins only" });
  next();
}

const byUser = (req) => req.user?.id || clientIp(req);
const id = (v) => {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Invalid id");
  return n;
};

// ---------------------------------------------------------------------------
// Media storage — Cloudinary if configured, otherwise the server's data/ folder
// Member images are returned as /media/... paths so they can be served (and
// hash-scanned) through a domain you control.
// ---------------------------------------------------------------------------
const cloudinaryReady = () => !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY);
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

async function storeMedia(buffer, { mime, folder, resourceType = "image" }) {
  if (cloudinaryReady()) {
    const result = await new Promise((ok, fail) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: resourceType, folder },
        (err, r) => (err ? fail(err) : ok(r))
      );
      stream.end(buffer);
    });
    return { path: `/media/${result.resource_type}/upload/v${result.version}/${result.public_id}.${result.format}`, url: result.secure_url };
  }
  if (resourceType !== "image") throw new Error("Video and music uploads need Cloudinary configured");
  const name = `${randomBytes(12).toString("hex")}.${EXT[mime] || "bin"}`;
  writeFileSync(resolve(PUBLIC_DIR, name), buffer);
  return { path: `/media/local/${name}`, url: `/media/local/${name}` };
}

function readMemberImage(file) {
  if (!file) return null;
  const mime = sniffImage(file.buffer);
  if (!mime) throw new Error("Images must be JPG, PNG, WebP or GIF");
  return { buffer: file.buffer, mime };
}

// Text check shared by comments, chats, names. Throws if blocked.
async function screenText(req, text, { contentType, context, username = false }) {
  const r = await checkText(text, { username });
  if (!r.allowed) {
    Safety.logModeration({ userId: req.user.id, contentType, context, text, categories: r.blocked, severe: r.severe, action: r.severe ? "suspended" : "blocked" });
    throw Object.assign(new Error("That can't be posted because it breaks the community rules."), { status: 422 });
  }
  return r.flags;
}

// Screens an image and saves it PRIVATELY as pending. Returns the pending path.
async function screenAndHoldImage(req, img, { context }) {
  const r = await checkImage(img.buffer, img.mime);
  if (r.status === "rejected") {
    Safety.logModeration({ userId: req.user.id, contentType: "image", context, categories: r.blocked, action: "blocked" });
    throw Object.assign(new Error("That image can't be posted because it breaks the community rules."), { status: 422 });
  }
  return savePending(img.buffer, img.mime);
}

// GIFs: only ones this server handed out from a PG-rated GIPHY search are accepted
const servedGifs = new Map(); // id -> { url, t }
function rememberGifs(list) {
  const now = Date.now();
  for (const g of list) servedGifs.set(g.id, { url: g.url, t: now });
  if (servedGifs.size > 20000) for (const [k, v] of servedGifs) if (now - v.t > 24 * 3600e3) servedGifs.delete(k);
}
function resolveGif(gifId) {
  gifId = String(gifId || "").trim();
  if (!gifId) return "";
  const g = servedGifs.get(gifId);
  if (!g || !validGifUrl(g.url)) throw new Error("That GIF expired. Please pick it again from the GIF button.");
  return g.url;
}

// ---------------------------------------------------------------------------
// Session info
// ---------------------------------------------------------------------------
function me(userId) {
  const u = S.getProfileById(userId);
  if (!u) return null;
  const extra = S.isAdmin(u)
    ? { mod_open: Safety.openModCount(), moderation_mode: aiModerationEnabled() ? "ai+rules" : "rules" }
    : {};
  const pending = C.hasPendingAvatar(u.id);
  return {
    ...u,
    confirmed: !!u.confirmed,
    is_admin: S.isAdmin(u),
    badge: C.accountAgeBadge(u.created_at),
    unread_chats: Chat.unreadChatCount(u.id),
    pending_requests: S.getPendingRequests(u.id).length,
    avatar_pending: pending,
    ...extra,
  };
}

router.get("/config", (req, res) => {
  const josh = S.adminUser();
  res.json({
    categories: CATEGORIES,
    moods: MOODS,
    // Public "About Me" box in the sidebar
    about: josh ? { id: josh.id, username: josh.username, display_name: josh.display_name, bio: josh.bio, avatar_url: josh.avatar_url, created_at: josh.created_at } : null,
    gif_search: !!process.env.GIPHY_API_KEY,
    report_reasons: Safety.REPORT_REASONS,
    points: C.POINTS,
  });
});

// Old-school hit counter: counts each visitor once a day
router.post("/hits", (req, res) => res.json({ count: Hits.countVisit(req.ip) }));
router.get("/hits", (req, res) => res.json({ count: Hits.total() }));

// Every upload on Josh's YouTube channel (?channel=old for his old channel on the Old Stuff tab)
router.get("/youtube", wrap(async (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json(await YouTube.listVideos(String(req.query.channel || "main")));
}));

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
router.post("/auth/register", limit("register", 5, 3600e3), wrap(async (req, res) => {
  const { username, password, age_confirmed, terms_accepted, admin_password } = req.body || {};
  const check = await checkText(username, { username: true });
  if (!check.allowed) throw new Error("Please pick a different username");
  const r = await S.registerUser(username, password, { ageConfirmed: age_confirmed === true, termsAccepted: terms_accepted === true, adminPassword: admin_password });
  S.markVisit(r.userId);
  C.award(r.userId, "visit", new Date().toISOString().slice(0, 10));
  res.status(201).json({ token: r.token, user: me(r.userId) });
}));

router.post("/auth/login", limit("login", 10, 15 * 60e3), wrap(async (req, res) => {
  const { username, password } = req.body || {};
  // Per-account throttle too, so changing IPs doesn't allow unlimited guessing
  if (!hit(`login-user:${String(username || "").toLowerCase()}`, 20, 15 * 60e3)) {
    throw Object.assign(new Error("Too many login attempts for this account. Try again in a few minutes."), { status: 429 });
  }
  const r = await S.loginUser(username, password).catch((e) => { throw Object.assign(e, { status: 401 }); });
  res.json({ token: r.token, user: me(r.userId) });
}));

router.post("/auth/confirm", requireAuth, wrap(async (req, res) => {
  if (req.body?.age_confirmed !== true || req.body?.terms_accepted !== true) throw new Error("Please confirm both boxes");
  S.confirmAgeAndTerms(req.user.id);
  res.json(me(req.user.id));
}));

router.post("/auth/logout", requireAuth, (req, res) => {
  S.logoutUser(req.headers.authorization?.replace("Bearer ", ""));
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, (req, res) => {
  if (S.isActive(req.user) && S.markVisit(req.user.id)) {
    C.award(req.user.id, "visit", new Date().toISOString().slice(0, 10));
  }
  res.json(me(req.user.id));
});

// ---------------------------------------------------------------------------
// Posts — anyone can read; only the admin can write
// ---------------------------------------------------------------------------
router.get("/posts", (req, res) => {
  res.json(C.listPosts({
    category: String(req.query.category || ""),
    limit: req.query.limit,
    offset: req.query.offset,
    viewerId: req.user?.id,
  }));
});

// Pinned posts for a tab (?category=music)
router.get("/posts/pinned", (req, res) => {
  res.json(C.listPinned(String(req.query.category || ""), req.user?.id));
});

router.post("/posts/:id/pin", requireAdmin, wrap(async (req, res) => {
  res.json(C.setPinned(id(req.params.id), !!req.body?.pinned, { first: !!req.body?.first }));
}));

router.get("/posts/:id", wrap(async (req, res) => {
  const post = C.getPost(id(req.params.id), req.user?.id);
  if (!post) throw Object.assign(new Error("Post not found"), { status: 404 });
  const comments = C.listComments(post.id, req.user?.id, S.isAdmin(req.user));
  res.json({ post, comments });
}));

router.post("/posts", requireAdmin, adminUpload.array("media", 10), wrap(async (req, res) => {
  const body = String(req.body.body || "").trim();
  const title = String(req.body.title || "").trim();
  const category = String(req.body.category || "");
  if (category && !CATEGORIES.includes(category)) throw new Error("Invalid category");
  const files = req.files || [];
  // Images already hosted in the repo (docs/art, docs/software, docs/music on GitHub Pages) can be posted by URL
  let linked = [];
  if (req.body.media_urls) {
    try { linked = JSON.parse(req.body.media_urls); } catch { linked = String(req.body.media_urls).split(/\s+/); }
    linked = [].concat(linked).map((u) => String(u).trim()).filter(Boolean);
    if (linked.length + files.length > 10) throw new Error("Up to 10 photos or videos per post");
    for (const u of linked) {
      if (!/^https:\/\/(?:www\.)?joshsblog\.org\/(?:art|software|music)\/[\w\-./]+\.(?:jpe?g|png|webp|gif)$/i.test(u) || u.includes("..")) {
        throw new Error("Linked media must be an image under joshsblog.org/art/, /software/ or /music/");
      }
    }
  }
  let links = [];
  if (req.body.links) {
    let raw;
    try { raw = JSON.parse(req.body.links); } catch { throw new Error("Couldn't read the links"); }
    links = cleanLinks(raw);
  }
  if (!body && !title && !files.length && !linked.length && !links.length) throw new Error("Write something or add a photo, video, song or link");
  // Sort the uploads: pictures, videos and music. Music posts take up to 10 tracks and one cover picture.
  const kinds = files.map((f) => {
    const image = sniffImage(f.buffer);
    if (image) return { f, kind: "image", mime: image };
    const audio = sniffAudio(f.buffer, f.mimetype);
    if (audio) return { f, kind: "audio", ext: audio };
    if (f.mimetype.startsWith("video/")) return { f, kind: "video", mime: f.mimetype };
    throw new Error(`${f.originalname}: unsupported file type`);
  });
  const audioCount = kinds.filter((k) => k.kind === "audio").length;
  if (audioCount) {
    if (kinds.some((k) => k.kind === "video")) throw new Error("A music post can't also have videos");
    if (kinds.filter((k) => k.kind === "image").length + linked.length > 1) throw new Error("A music post can have one cover picture");
  }
  let titles = [];
  try { titles = JSON.parse(req.body.track_titles || "[]"); } catch { titles = []; }
  const tracks = [];
  const urls = [...linked];
  let hasVideo = false;
  // Cover first, then the tracks in the order they were picked
  for (const k of [...kinds.filter((k) => k.kind !== "audio"), ...kinds.filter((k) => k.kind === "audio")]) {
    if (k.kind === "audio") {
      const stored = await storeMedia(k.f.buffer, { mime: "audio/" + k.ext, folder: "josh-blog-music", resourceType: "video" });
      // Cloudinary converts on request: stream lossless/odd formats as MP3 so every browser can play them
      urls.push(["mp3", "m4a", "aac"].includes(k.ext) ? stored.url : stored.url.replace(/\.\w+$/, ".mp3"));
      const i = tracks.length;
      const fallback = String(k.f.originalname || `Track ${i + 1}`).replace(/\.[^.]+$/, "");
      tracks.push(String(titles[i] || fallback).trim().slice(0, 120) || `Track ${i + 1}`);
      continue;
    }
    hasVideo ||= k.kind === "video";
    const stored = await storeMedia(k.f.buffer, { mime: k.mime, folder: "josh-blog", resourceType: k.kind });
    urls.push(stored.url);
  }
  const type = audioCount ? "audio" : !urls.length ? "text" : hasVideo && urls.length === 1 ? "video" : "image";
  const mediaUrl = urls.length === 1 ? urls[0] : urls.length ? JSON.stringify(urls) : "";
  const post = createPost(type, title, body, mediaUrl, category || (audioCount ? "music" : ""),
    { mood: String(req.body.mood || ""), music: req.body.music, tracks, links });
  res.status(201).json(C.getPost(post.id, req.user.id));
}));

router.delete("/posts/:id", requireAdmin, wrap(async (req, res) => {
  removePost(id(req.params.id));
  res.json({ ok: true });
}));

router.post("/posts/:id/like", requireActive, limit("like", 60, 60e3, byUser), wrap(async (req, res) => {
  res.json(C.togglePostLike(id(req.params.id), req.user.id));
}));

// ---------------------------------------------------------------------------
// Comments — text, a GIPHY GIF, and/or one image (images need approval)
// ---------------------------------------------------------------------------
router.post("/posts/:id/comments",
  requireActive,
  limit("comment", 6, 60e3, byUser),
  limit("comment-day", 200, 24 * 3600e3, byUser),
  memberUpload.single("image"),
  wrap(async (req, res) => {
    const postId = id(req.params.id);
    if (!C.getPost(postId)) throw Object.assign(new Error("Post not found"), { status: 404 });
    const body = String(req.body.body || "").trim();
    const gifUrl = resolveGif(req.body.gif_id);
    const img = readMemberImage(req.file);
    const parentId = req.body.parent_id ? id(req.body.parent_id) : null;
    C.assertCanComment({ postId, parentId, body, hasMedia: !!(gifUrl || img) });
    const context = `post:${postId}`;
    const flags = await screenText(req, body, { contentType: "comment", context });
    const imageUrl = img ? await screenAndHoldImage(req, img, { context }) : "";
    let comment;
    try {
      comment = C.addComment({ postId, userId: req.user.id, parentId, body, gifUrl, imageUrl, imageStatus: imageUrl ? "pending" : "" });
    } catch (e) { if (imageUrl) discard(imageUrl); throw e; }
    if (flags.length) Safety.logModeration({ userId: req.user.id, contentType: "comment", context: `${context}:comment:${comment.id}`, text: body, categories: flags, action: "flagged" });
    res.status(201).json({ ...comment, image_url: imageUrl ? signPending(imageUrl) : "", liked: false, pending_image: !!imageUrl });
  })
);

router.delete("/comments/:id", requireAuth, wrap(async (req, res) => {
  C.removeComment(id(req.params.id), req.user, S.isAdmin(req.user));
  res.json({ ok: true });
}));

router.post("/comments/:id/like", requireActive, limit("like", 60, 60e3, byUser), wrap(async (req, res) => {
  res.json(C.toggleCommentLike(id(req.params.id), req.user.id));
}));

// GIPHY search proxy (keeps the key server-side and forces a PG rating)
router.get("/gifs", requireActive, limit("gifs", 30, 60e3, byUser), wrap(async (req, res) => {
  const key = process.env.GIPHY_API_KEY;
  if (!key) throw Object.assign(new Error("GIF search isn't set up"), { status: 404 });
  const q = String(req.query.q || "").trim().slice(0, 50);
  const base = process.env.GIPHY_API_BASE || "https://api.giphy.com"; // overridable for tests
  const url = q
    ? `${base}/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&limit=24&rating=pg&lang=en`
    : `${base}/v1/gifs/trending?api_key=${encodeURIComponent(key)}&limit=24&rating=pg`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw Object.assign(new Error("GIF search is unavailable right now"), { status: 502 });
  const data = await r.json();
  const list = (data.data || []).filter((g) => ["g", "pg"].includes(String(g.rating || "").toLowerCase())).map((g) => ({
    id: g.id,
    url: g.images?.fixed_height?.url,
    preview: g.images?.fixed_height_small?.url || g.images?.fixed_height?.url,
    width: Number(g.images?.fixed_height?.width) || 200,
    height: Number(g.images?.fixed_height?.height) || 200,
  })).filter((g) => validGifUrl(g.url));
  rememberGifs(list);
  res.json(list);
}));

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
router.get("/users/search", requireAuth, (req, res) => {
  const q = String(req.query.q || "");
  if (!q) return res.json([]);
  res.json(S.findUsers(q));
});

router.get("/users/:username", requireAuth, wrap(async (req, res) => {
  const profile = S.getPublicProfile(req.params.username);
  const admin = S.isAdmin(req.user);
  if (!profile || (profile.status === "banned" && !admin)) throw Object.assign(new Error("User not found"), { status: 404 });
  const friendStatus = profile.id === req.user.id ? "self" : S.getFriendshipStatus(req.user.id, profile.id);
  res.json({
    ...profile,
    is_admin: S.isAdmin(profile),
    badge: C.accountAgeBadge(profile.created_at),
    friend_status: friendStatus,
    can_message: friendStatus !== "self" && profile.status !== "banned" && Chat.canDM(req.user.id, profile.id),
    request_id: friendStatus === "pending" ? S.getIncomingRequestId(req.user.id, profile.id) : null,
    comment_count: C.commentCount(profile.id),
    friends_count: S.getFriends(profile.id).length,
    history: C.commentHistory(profile.id, req.user.id, admin),
  });
}));

router.put("/profile", requireActive, limit("profile", 10, 3600e3, byUser), memberUpload.single("avatar"), wrap(async (req, res) => {
  const displayName = req.body.display_name ?? req.user.display_name;
  const bio = req.body.bio ?? req.user.bio;
  const flags = [
    ...(await screenText(req, displayName, { contentType: "profile", context: "display_name", username: true })),
    ...(await screenText(req, bio, { contentType: "profile", context: "bio" })),
  ];
  S.updateUserProfile(req.user.id, displayName, bio, req.user.avatar_url);
  let avatarPending = false;
  const img = readMemberImage(req.file);
  if (img) {
    C.setPendingAvatar(req.user.id, await screenAndHoldImage(req, img, { context: "avatar" }));
    avatarPending = true;
  }
  if (flags.length) Safety.logModeration({ userId: req.user.id, contentType: "profile", context: "profile", text: `${displayName}\n${bio}`, categories: flags, action: "flagged" });
  res.json({ ok: true, avatar_pending: avatarPending, user: me(req.user.id) });
}));

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
router.post("/friends/request/:userId", requireActive, limit("friend", 30, 3600e3, byUser), wrap(async (req, res) => {
  S.sendFriendRequest(req.user.id, id(req.params.userId));
  res.json({ ok: true });
}));
router.post("/friends/accept/:requestId", requireActive, wrap(async (req, res) => {
  S.acceptFriendRequest(id(req.params.requestId), req.user.id);
  res.json({ ok: true });
}));
router.post("/friends/reject/:requestId", requireAuth, wrap(async (req, res) => {
  S.rejectFriendRequest(id(req.params.requestId), req.user.id);
  res.json({ ok: true });
}));
router.delete("/friends/:userId", requireAuth, wrap(async (req, res) => {
  S.removeFriend(req.user.id, id(req.params.userId));
  res.json({ ok: true });
}));
router.get("/friends", requireAuth, (req, res) => res.json(S.getFriends(req.user.id)));
router.get("/friends/requests", requireAuth, (req, res) => {
  res.json({ received: S.getPendingRequests(req.user.id), sent: S.getSentRequests(req.user.id) });
});

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------
router.get("/chats", requireAuth, (req, res) => res.json(Chat.listChats(req.user.id)));

router.post("/chats/direct/:userId", requireActive, wrap(async (req, res) => {
  res.json({ id: Chat.getOrCreateDM(req.user.id, id(req.params.userId)) });
}));

router.get("/chats/:id", requireAuth, wrap(async (req, res) => {
  res.json(Chat.getChat(id(req.params.id), req.user.id, { afterId: parseInt(req.query.after, 10) || 0 }));
}));

router.post("/chats/:id/messages", requireActive, limit("msg", 20, 60e3, byUser), limit("msg-day", 1000, 24 * 3600e3, byUser), wrap(async (req, res) => {
  const convId = id(req.params.id);
  const body = String(req.body?.body || "").trim();
  if (!Chat.isChatMember(convId, req.user.id)) throw Object.assign(new Error("Chat not found"), { status: 404 });
  const gifUrl = resolveGif(req.body?.gif_id);
  const flags = await screenText(req, body, { contentType: "message", context: `chat:${convId}` });
  const msg = Chat.sendChatMessage(convId, req.user.id, { body, gifUrl, flags });
  if (flags.length) Safety.logModeration({ userId: req.user.id, contentType: "message", context: `chat:${convId}:message:${msg.id}`, text: body, categories: flags, action: "flagged" });
  res.status(201).json(msg);
}));

router.post("/chats/:id/members", requireActive, limit("chat-add", 20, 3600e3, byUser), wrap(async (req, res) => {
  res.json({ id: Chat.addMembers(id(req.params.id), req.user.id, req.body?.user_ids) });
}));

router.post("/chats/:id/leave", requireAuth, wrap(async (req, res) => {
  Chat.leaveGroup(id(req.params.id), req.user.id);
  res.json({ ok: true });
}));

router.put("/chats/:id", requireActive, limit("chat-rename", 10, 3600e3, byUser), wrap(async (req, res) => {
  const convId = id(req.params.id);
  const name = String(req.body?.name || "");
  if (!Chat.isChatMember(convId, req.user.id)) throw Object.assign(new Error("Chat not found"), { status: 404 });
  await screenText(req, name, { contentType: "message", context: `chat:${convId}:name` });
  Chat.renameGroup(convId, req.user.id, name);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
router.post("/reports", requireAuth, limit("report", 20, 3600e3, byUser), wrap(async (req, res) => {
  const { target_type, target_id, reason, details } = req.body || {};
  Safety.createReport(req.user.id, target_type, target_id, reason, details);
  res.status(201).json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Moderation (admin)
// ---------------------------------------------------------------------------
router.get("/mod/queue", requireAdmin, (req, res) => {
  const q = Safety.modQueue();
  q.images.comments.forEach((c) => { c.image_url = signPending(c.image_url); });
  q.images.avatars.forEach((a) => { a.image_url = signPending(a.image_url); });
  q.reports.forEach((r) => { if (r.target?.image_url) r.target.image_url = signPending(r.target.image_url); });
  res.json(q);
});

router.post("/mod/reports/:id/resolve", requireAdmin, wrap(async (req, res) => {
  const r = Safety.getReport(id(req.params.id));
  if (!r || r.status !== "open") throw new Error("Report not found or already resolved");
  const { remove_content, ban_user } = req.body || {};
  const done = [];
  if (remove_content && r.target && !r.target.removed) {
    if (r.target_type === "comment") C.removeComment(r.target_id, req.user, true);
    if (r.target_type === "message") Chat.removeMessage(r.target_id);
    done.push("removed content");
  }
  if (ban_user && r.target?.author_id && !S.isAdmin(S.getProfileById(r.target.author_id))) {
    S.setUserStatus(r.target.author_id, "banned", `Report #${r.id}: ${r.reason}`);
    C.purgeUserMedia(r.target.author_id);
    done.push("banned user");
  }
  Safety.resolveReport(r.id, done.join(", ") || "dismissed");
  res.json({ ok: true, actions: done });
}));

router.post("/mod/events/:id/resolve", requireAdmin, wrap(async (req, res) => {
  Safety.resolveEvent(id(req.params.id));
  res.json({ ok: true });
}));

router.post("/mod/images/comment/:id", requireAdmin, wrap(async (req, res) => {
  const c = C.getPendingCommentImage(id(req.params.id));
  if (!c) throw new Error("Image not found or already reviewed");
  if (req.body?.approve === true) C.setCommentImage(c.id, "approved", await publish(c.image_url));
  else { await discard(c.image_url); C.setCommentImage(c.id, "rejected", ""); }
  res.json({ ok: true });
}));

router.post("/mod/images/avatar/:userId", requireAdmin, wrap(async (req, res) => {
  const userId = id(req.params.userId);
  const u = C.getPendingAvatar(userId);
  if (!u?.avatar_pending_url) throw new Error("No pending photo");
  if (req.body?.approve === true) C.finishAvatarReview(userId, await publish(u.avatar_pending_url));
  else { await discard(u.avatar_pending_url); C.finishAvatarReview(userId, null); }
  res.json({ ok: true });
}));

router.post("/mod/users/:id/status", requireAdmin, wrap(async (req, res) => {
  const target = S.getProfileById(id(req.params.id));
  if (!target) throw new Error("User not found");
  if (S.isAdmin(target)) throw new Error("Can't change an admin's status");
  S.setUserStatus(target.id, String(req.body?.status || ""), String(req.body?.reason || "").slice(0, 200));
  if (req.body?.status === "banned") C.purgeUserMedia(target.id);
  res.json({ ok: true });
}));

router.get("/mod/chats/:id", requireAdmin, wrap(async (req, res) => res.json(Chat.adminGetChat(id(req.params.id)))));

router.post("/mod/chats/:id/clear", requireAdmin, wrap(async (req, res) => {
  Chat.clearChatFlag(id(req.params.id));
  res.json({ ok: true });
}));

router.post("/mod/messages/:id/remove", requireAdmin, wrap(async (req, res) => {
  Chat.removeMessage(id(req.params.id));
  res.json({ ok: true });
}));

router.post("/mod/comments/:id/remove", requireAdmin, wrap(async (req, res) => {
  C.removeComment(id(req.params.id), req.user, true);
  res.json({ ok: true });
}));

// Multer / unexpected errors
router.use((err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "That file is too large" });
  if (err?.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ error: "Too many files" });
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

export default router;
