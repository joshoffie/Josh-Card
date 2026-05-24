import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { resolve } from "node:path";
import {
  CFG, db,
  authTokenFor, verifyAuth,
  createPass, getPassBySerial, getAllSerials,
  updateFields, registerDevice, unregisterDevice,
  getSerialsForDevice, getTokensForSerial,
  getCurrentContent, setContent,
  createPost, getPosts, removePost,
  addComment, getComments, removeComment, incrementLike, containsSlurs,
} from "./store.js";
import buildPkpass from "./buildPkpass.js";
import { pushToAll } from "./apns.js";

const app = express();
app.use(express.json());
app.use("/public", express.static(resolve("public")));

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// CORS for GitHub Pages blog
app.use("/api/comments", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use("/api/posts", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use("/api/upload", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// =========================================================================
// Public Posts API (for the blog)
// =========================================================================
app.get("/api/posts", (req, res) => {
  const posts = getPosts(100);
  const formatted = posts.map(p => ({
    slug: "post-" + p.id,
    title: p.title || "",
    date: (p.created_at || "").slice(0, 10),
    type: p.post_type || "text",
    body: p.body || "",
    mediaUrl: p.media_url || "",
  }));
  res.json(formatted);
});

// Admin: create post with optional media (from blog drag-and-drop)
app.post("/api/posts", upload.array("media", 20), async (req, res) => {
  const pw = req.headers.authorization;
  if (pw !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: "unauthorized" });

  const { title, body, type } = req.body;
  const files = req.files || [];
  const urls = [];

  // Upload each file to Cloudinary
  for (const file of files) {
    try {
      const result = await new Promise((resolve, reject) => {
        const resourceType = file.mimetype.startsWith("video/") ? "video" : "image";
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: resourceType, folder: "josh-blog" },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(file.buffer);
      });
      urls.push(result.secure_url);
    } catch (e) {
      console.error("Cloudinary upload error:", e.message);
    }
  }

  // Determine post type
  let postType = type || "text";
  if (!type && urls.length) {
    const firstFile = files[0];
    postType = firstFile.mimetype.startsWith("video/") ? "video" : "image";
  }

  // For multiple images, store as JSON array in media_url
  const mediaUrl = urls.length === 1 ? urls[0] : urls.length > 1 ? JSON.stringify(urls) : "";

  const post = createPost(postType, title || "", body || "", mediaUrl);
  res.status(201).json({ ...post, urls });
});

// Admin: upload media files only (returns URLs)
app.post("/api/upload", upload.array("media", 20), async (req, res) => {
  const pw = req.headers.authorization;
  if (pw !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: "unauthorized" });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "no files" });

  const urls = [];
  for (const file of files) {
    try {
      const result = await new Promise((resolve, reject) => {
        const resourceType = file.mimetype.startsWith("video/") ? "video" : "image";
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: resourceType, folder: "josh-blog" },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(file.buffer);
      });
      urls.push(result.secure_url);
    } catch (e) {
      console.error("Cloudinary upload error:", e.message);
    }
  }
  res.json({ urls });
});

// =========================================================================
// Comments API (for the public blog) — replies, likes, moderation
// =========================================================================
app.get("/api/comments/:slug", (req, res) => {
  const comments = getComments(req.params.slug);
  res.json(comments);
});

app.post("/api/comments/:slug", (req, res) => {
  const { name, body, parentId } = req.body;
  if (!name?.trim() || !body?.trim()) return res.status(400).json({ error: "name and body required" });
  if (body.length > 2000) return res.status(400).json({ error: "comment too long" });
  if (containsSlurs(name) || containsSlurs(body)) {
    return res.status(400).json({ error: "Your comment contains language that isn't allowed. Slurs are blocked." });
  }
  const comment = addComment(req.params.slug, name.trim(), body.trim(), parentId || null);
  res.status(201).json(comment);
});

app.post("/api/comments/:id/like", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const updated = incrementLike(id);
  if (!updated) return res.status(404).json({ error: "comment not found" });
  res.json({ likes: updated.likes });
});

// Admin delete comment (requires ADMIN_PASSWORD in Authorization header)
app.delete("/api/comments/:id", (req, res) => {
  const pw = req.headers.authorization;
  if (pw !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: "unauthorized" });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "invalid id" });
  removeComment(id);
  res.json({ deleted: true });
});

// =========================================================================
// Health check (Railway / uptime monitors)
// =========================================================================
app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// =========================================================================
// JOSH'S ENDPOINTS
// =========================================================================

// --- Fan signup page (QR code destination) --------------------------------
app.get("/join", (req, res) => {
  const artistName = CFG.artistName;
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(artistName)} — Get Your Card</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a; color: #e0e0e0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center; padding: 2rem 1rem; }
    .container { width: 100%; max-width: 380px; }
    .header { text-align: center; margin-bottom: 2rem; }
    .header h1 { font-size: 1.5rem; color: #fff; margin-bottom: 0.3rem; }
    .header p { font-size: 0.85rem; color: #666; }
    .form-card { background: #161616; border: 1px solid #2a2a2a; border-radius: 14px;
      padding: 1.5rem; }
    label { display: block; font-size: 0.75rem; color: #888; text-transform: uppercase;
      letter-spacing: 0.08em; margin-bottom: 0.3rem; }
    input { width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid #333;
      background: #222; color: #fff; font-size: 1rem; margin-bottom: 1rem;
      font-family: inherit; -webkit-appearance: none; }
    input::placeholder { color: #555; }
    input:focus { outline: none; border-color: #555; }
    .btn { width: 100%; padding: 0.9rem; border-radius: 10px; border: none;
      background: #fff; color: #000; font-weight: 600; font-size: 1.05rem;
      cursor: pointer; transition: opacity 0.2s; -webkit-appearance: none; }
    .btn:hover { opacity: 0.85; }
    .btn:active { opacity: 0.7; }
    .note { text-align: center; font-size: 0.75rem; color: #444; margin-top: 1.5rem;
      line-height: 1.5; }
    .wallet-icon { display: inline-block; width: 20px; height: 20px;
      vertical-align: middle; margin-right: 0.3rem; }
  </style>
</head><body>
  <div class="container">
    <div class="header">
      <h1>${escHtml(artistName)}</h1>
      <p>Get your fan card</p>
    </div>
    <div class="form-card">
      <form id="joinForm">
        <label>First Name</label>
        <input type="text" name="name" placeholder="Your name" required autofocus autocomplete="given-name">
        <button type="submit" class="btn">Add to Apple Wallet</button>
      </form>
    </div>
    <p class="note">Free. No app needed. Card goes straight to your iPhone wallet<br>with exclusive access and lock-screen updates.</p>
  </div>
  <script>
    document.getElementById("joinForm").addEventListener("submit", function(e) {
      e.preventDefault();
      const name = encodeURIComponent(this.name.value.trim());
      if (!name) return;
      window.location.href = "/issue?name=" + name + "&source=qr";
    });
  </script>
</body></html>`);
});

// --- Issue a new pass ---------------------------------------------------
// GET /issue?name=...&email=...&source=...
app.get("/issue", async (req, res) => {
  try {
    const { name, email, source } = req.query;
    if (!name) return res.status(400).json({ error: "name is required" });

    const serial = `fan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createPass(serial, name, email || "", source || "direct");

    const buf = await buildPkpass({ name, email: email || "", serial, source });

    res.set({
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="${name.replace(/\s+/g, "_")}_fancard.pkpass"`,
    });
    res.send(buf);
  } catch (err) {
    console.error("Issue error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Broadcast update to all fans ---------------------------------------
// POST /broadcast { latestDrop, dropDate, listenUrl, message }
app.post("/broadcast", async (req, res) => {
  try {
    const { latestDrop, dropDate, listenUrl, message } = req.body;

    // 1. Save the new content
    setContent(
      latestDrop || "",
      dropDate   || "",
      listenUrl  || "",
      message    || ""
    );

    // 2. Update every pass's fields so next fetch returns fresh data
    const serials = getAllSerials();
    for (const serial of serials) {
      updateFields(serial, { latestDrop, dropDate, listenUrl, message });
    }

    // 3. Collect all push tokens and fan-out
    const allTokens = new Set();
    for (const serial of serials) {
      for (const token of getTokensForSerial(serial)) {
        allTokens.add(token);
      }
    }

    let pushResult = { sent: 0, failed: 0 };
    if (allTokens.size > 0) {
      pushResult = await pushToAll([...allTokens]);
    }

    res.json({
      updated: serials.length,
      pushes: pushResult,
    });
  } catch (err) {
    console.error("Broadcast error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// ADMIN DASHBOARD — password-protected
// =========================================================================
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "changeme";

function requireAdmin(req, res, next) {
  // Check session cookie or query param
  const cookie = (req.headers.cookie || "").match(/admin_token=([^;]+)/);
  const token = cookie?.[1];
  if (token === Buffer.from(ADMIN_PASS).toString("base64")) return next();
  // Show login form
  if (req.method === "GET" && !req.query._pw) {
    return res.send(renderAdminLogin());
  }
  // Check password from form POST or query
  const pw = req.body?.password || req.query._pw;
  if (pw === ADMIN_PASS) {
    const tok = Buffer.from(ADMIN_PASS).toString("base64");
    res.setHeader("Set-Cookie", `admin_token=${tok}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=86400`);
    return next();
  }
  return res.send(renderAdminLogin("Wrong password"));
}

app.use("/admin", express.urlencoded({ extended: false }));
app.use("/admin", requireAdmin);

// POST /admin handles login — middleware sets cookie, then redirect to GET
app.post("/admin", (req, res) => {
  res.redirect("/admin");
});

app.get("/admin", (req, res) => {
  const fans = db.prepare("SELECT COUNT(*) as c FROM passes").get().c;
  const devices = db.prepare("SELECT COUNT(DISTINCT push_token) as c FROM registrations").get().c;
  const content = getCurrentContent();
  const recentFans = db.prepare("SELECT name, email, source, created_at FROM passes ORDER BY created_at DESC LIMIT 10").all();
  const posts = getPosts(20);
  const allComments = db.prepare("SELECT * FROM comments ORDER BY created_at DESC LIMIT 100").all();
  res.send(renderAdminPage({ fans, devices, content, recentFans, posts, allComments }));
});

app.post("/admin/broadcast", async (req, res) => {
  try {
    const { latestDrop, dropDate, listenUrl, message } = req.body;
    setContent(latestDrop || "", dropDate || "", listenUrl || "", message || "");
    const serials = getAllSerials();
    for (const serial of serials) {
      updateFields(serial, { latestDrop, dropDate, listenUrl, message });
    }
    const allTokens = new Set();
    for (const serial of serials) {
      for (const token of getTokensForSerial(serial)) allTokens.add(token);
    }
    let pushResult = { sent: 0, failed: 0 };
    if (allTokens.size > 0) pushResult = await pushToAll([...allTokens]);
    res.redirect("/admin?sent=1&updated=" + serials.length + "&pushed=" + pushResult.sent);
  } catch (err) {
    console.error("Admin broadcast error:", err);
    res.redirect("/admin?error=" + encodeURIComponent(err.message));
  }
});

// --- Admin: create a post --------------------------------------------------
app.post("/admin/post", (req, res) => {
  const { postType, title, body, mediaUrl } = req.body;
  createPost(postType || "text", title || "", body || "", mediaUrl || "");
  res.redirect("/admin?posted=1");
});

// --- Admin: delete a post --------------------------------------------------
app.post("/admin/post/delete", (req, res) => {
  const { id } = req.body;
  if (id) removePost(Number(id));
  res.redirect("/admin?deleted=1");
});

// --- Admin: delete a comment ------------------------------------------------
app.post("/admin/comment/delete", (req, res) => {
  const { id } = req.body;
  if (id) removeComment(Number(id));
  res.redirect("/admin?comment_deleted=1");
});

// =========================================================================
// EXCLUSIVE FAN PAGE — token-gated blog feed
// =========================================================================
app.get("/secret/:token", (req, res) => {
  const { token } = req.params;
  const serials = getAllSerials();
  const serial = serials.find((s) => authTokenFor(s) === token);

  if (!serial) {
    return res.status(404).send(renderErrorPage("Invalid or expired link"));
  }

  const pass = getPassBySerial(serial);
  const content = getCurrentContent();
  const posts = getPosts(50);

  res.send(renderFanPage(pass, content, posts));
});

// =========================================================================
// APPLE WALLET WEB SERVICE (called BY the device)
// Spec: https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes
// =========================================================================

// Middleware: verify Authorization: ApplePass <token>
function requirePassAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("ApplePass ")) {
    return res.sendStatus(401);
  }
  req.passToken = auth.replace("ApplePass ", "");
  next();
}

// --- Register device for pass updates ----------------------------------
app.post(
  "/v1/devices/:deviceLibId/registrations/:passTypeId/:serial",
  requirePassAuth,
  (req, res) => {
    const { deviceLibId, serial } = req.params;
    const { pushToken } = req.body;

    if (!verifyAuth(serial, req.passToken)) return res.sendStatus(401);
    if (!pushToken) return res.sendStatus(400);

    registerDevice(deviceLibId, serial, pushToken);
    console.log(`Registered device ${deviceLibId} for pass ${serial}`);
    res.sendStatus(201);
  }
);

// --- Unregister --------------------------------------------------------
app.delete(
  "/v1/devices/:deviceLibId/registrations/:passTypeId/:serial",
  requirePassAuth,
  (req, res) => {
    const { deviceLibId, serial } = req.params;
    if (!verifyAuth(serial, req.passToken)) return res.sendStatus(401);

    unregisterDevice(deviceLibId, serial);
    console.log(`Unregistered device ${deviceLibId} for pass ${serial}`);
    res.sendStatus(200);
  }
);

// --- Get serials for device (which passes changed) ----------------------
app.get(
  "/v1/devices/:deviceLibId/registrations/:passTypeId",
  (req, res) => {
    const { deviceLibId } = req.params;
    const serials = getSerialsForDevice(deviceLibId);

    if (!serials.length) return res.sendStatus(204);

    // passesUpdatedSince filtering — simplified: always return all
    // A production system would compare updated_at timestamps
    res.json({
      serialNumbers: serials,
      lastUpdated: new Date().toISOString(),
    });
  }
);

// --- Fetch updated pass -------------------------------------------------
app.get(
  "/v1/passes/:passTypeId/:serial",
  requirePassAuth,
  async (req, res) => {
    const { serial } = req.params;
    if (!verifyAuth(serial, req.passToken)) return res.sendStatus(401);

    const pass = getPassBySerial(serial);
    if (!pass) return res.sendStatus(404);

    try {
      const buf = await buildPkpass({
        name:   pass.name,
        email:  pass.email,
        serial: pass.serial,
        source: pass.source,
      });

      res.set("Content-Type", "application/vnd.apple.pkpass");
      res.send(buf);
    } catch (err) {
      console.error("Pass rebuild error:", err);
      res.sendStatus(500);
    }
  }
);

// --- Log (Apple sends device-side errors here) --------------------------
app.post("/v1/log", (req, res) => {
  if (req.body?.logs) {
    console.log("Wallet device logs:", req.body.logs);
  }
  res.sendStatus(200);
});

// =========================================================================
// HTML Renderers
// =========================================================================

function renderFanPage(pass, content, posts) {
  const artistName = CFG.artistName;

  function renderPost(p) {
    const date = p.created_at?.slice(0, 10) || "";
    const typeIcon = { text: "", music: "", image: "", video: "" }[p.post_type] || "";

    let mediaHtml = "";
    if (p.post_type === "music" && p.media_url) {
      // Spotify embed
      if (p.media_url.includes("spotify.com")) {
        const embedUrl = p.media_url
          .replace("open.spotify.com/", "open.spotify.com/embed/")
          .split("?")[0];
        mediaHtml = `<iframe src="${escHtml(embedUrl)}" width="100%" height="152"
          frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy" style="border-radius:8px; margin-top:0.75rem;"></iframe>`;
      } else if (p.media_url.includes("soundcloud.com")) {
        mediaHtml = `<iframe width="100%" height="166" scrolling="no" frameborder="no"
          src="https://w.soundcloud.com/player/?url=${encodeURIComponent(p.media_url)}&color=%23ffffff&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false"
          style="margin-top:0.75rem;"></iframe>`;
      } else {
        mediaHtml = `<a href="${escHtml(p.media_url)}" class="listen-link" target="_blank">Listen</a>`;
      }
    } else if (p.post_type === "image" && p.media_url) {
      mediaHtml = `<img src="${escHtml(p.media_url)}" alt="${escHtml(p.title)}"
        style="width:100%; border-radius:8px; margin-top:0.75rem;">`;
    } else if (p.post_type === "video" && p.media_url) {
      let embedSrc = p.media_url;
      if (p.media_url.includes("youtube.com/watch")) {
        const vid = new URL(p.media_url).searchParams.get("v");
        embedSrc = `https://www.youtube.com/embed/${vid}`;
      } else if (p.media_url.includes("youtu.be/")) {
        const vid = p.media_url.split("youtu.be/")[1]?.split("?")[0];
        embedSrc = `https://www.youtube.com/embed/${vid}`;
      }
      mediaHtml = `<div style="position:relative;padding-bottom:56.25%;height:0;margin-top:0.75rem;">
        <iframe src="${escHtml(embedSrc)}" frameborder="0" allowfullscreen
          style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:8px;"></iframe>
      </div>`;
    }

    return `<div class="post">
      ${p.title ? `<div class="post-title">${escHtml(p.title)}</div>` : ""}
      ${p.body ? `<div class="post-body">${escHtml(p.body).replace(/\n/g, "<br>")}</div>` : ""}
      ${mediaHtml}
      <div class="post-date">${date}</div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${artistName} — Fans Only</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a; color: #e0e0e0; min-height: 100vh;
    }
    .container { max-width: 520px; margin: 0 auto; padding: 2rem 1rem; }
    .header { text-align: center; margin-bottom: 2rem; padding-bottom: 1.5rem;
      border-bottom: 1px solid #222; }
    .header h1 { font-size: 1.6rem; color: #fff; margin-bottom: 0.3rem; }
    .header .subtitle { font-size: 0.8rem; color: #666; text-transform: uppercase;
      letter-spacing: 0.15em; }
    .welcome { font-size: 0.95rem; color: #aaa; margin-bottom: 1.5rem; }

    /* Pinned latest drop */
    .pinned { background: #161616; border: 1px solid #2a2a2a; border-radius: 12px;
      padding: 1.5rem; margin-bottom: 2rem; }
    .pinned .pin-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.12em;
      color: #555; margin-bottom: 0.5rem; }
    .pinned .pin-title { font-size: 1.3rem; color: #fff; font-weight: 600; }
    .pinned .pin-date { font-size: 0.8rem; color: #666; margin-top: 0.3rem; }
    .pinned .pin-msg { font-size: 0.9rem; color: #bbb; margin-top: 0.5rem; line-height: 1.5; }
    .listen-btn { display: block; text-align: center; background: #fff; color: #000;
      font-weight: 600; font-size: 1rem; padding: 0.85rem; border-radius: 8px;
      text-decoration: none; margin-top: 1rem; transition: opacity 0.2s; }
    .listen-btn:hover { opacity: 0.85; }

    /* Feed */
    .feed-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em;
      color: #444; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid #1a1a1a; }
    .post { background: #131313; border: 1px solid #222; border-radius: 10px;
      padding: 1.25rem; margin-bottom: 1rem; }
    .post-title { font-size: 1.1rem; color: #fff; font-weight: 600; margin-bottom: 0.4rem; }
    .post-body { font-size: 0.92rem; color: #ccc; line-height: 1.55; }
    .post-date { font-size: 0.75rem; color: #444; margin-top: 0.75rem; }
    .listen-link { display: inline-block; color: #fff; background: #222; padding: 0.5rem 1.2rem;
      border-radius: 6px; text-decoration: none; font-size: 0.9rem; margin-top: 0.75rem;
      font-weight: 500; }
    .listen-link:hover { background: #333; }

    .empty { text-align: center; padding: 3rem 1rem; color: #444; font-size: 0.95rem; }
    .footer { text-align: center; font-size: 0.7rem; color: #333; margin-top: 3rem;
      padding-top: 1rem; border-top: 1px solid #151515; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${escHtml(artistName)}</h1>
      <div class="subtitle">Fans Only</div>
    </div>

    <p class="welcome">Hey ${escHtml(pass.name)} — thanks for holding the card.</p>

    ${content?.latest_drop ? `
    <div class="pinned">
      <div class="pin-label">Latest Drop</div>
      <div class="pin-title">${escHtml(content.latest_drop)}</div>
      ${content.drop_date ? `<div class="pin-date">${escHtml(content.drop_date)}</div>` : ""}
      ${content.message ? `<div class="pin-msg">${escHtml(content.message)}</div>` : ""}
      ${content.listen_url ? `<a href="${escHtml(content.listen_url)}" class="listen-btn" target="_blank">Listen Now</a>` : ""}
    </div>
    ` : ""}

    ${posts.length ? `
    <div class="feed-label">Feed</div>
    ${posts.map(p => renderPost(p)).join("")}
    ` : `
    <div class="empty">Nothing here yet — you'll be the first to know.</div>
    `}

    <div class="footer">Card holders only. Don't share this link.</div>
  </div>
</body>
</html>`;
}

function renderErrorPage(msg) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Not Found</title>
  <style>
    body {
      font-family: -apple-system, sans-serif;
      background: #0a0a0a; color: #888;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0;
    }
    .msg { text-align: center; }
    h1 { font-size: 1.2rem; color: #ccc; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <div class="msg">
    <h1>${escHtml(msg)}</h1>
    <p>If you think this is an error, re-open the link from the back of your card.</p>
  </div>
</body>
</html>`;
}

function renderAdminLogin(error = "") {
  return `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #e0e0e0;
      display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .box { background: #161616; border: 1px solid #2a2a2a; border-radius: 12px;
      padding: 2rem; width: 320px; }
    h1 { font-size: 1.1rem; margin-bottom: 1rem; color: #fff; }
    input { width: 100%; padding: 0.7rem; border-radius: 6px; border: 1px solid #333;
      background: #222; color: #fff; font-size: 1rem; margin-bottom: 1rem; }
    button { width: 100%; padding: 0.7rem; border-radius: 6px; border: none;
      background: #fff; color: #000; font-weight: 600; font-size: 1rem; cursor: pointer; }
    .err { color: #f66; font-size: 0.85rem; margin-bottom: 0.75rem; }
  </style>
</head><body>
  <div class="box">
    <h1>Admin</h1>
    ${error ? `<p class="err">${escHtml(error)}</p>` : ""}
    <form method="POST" action="/admin">
      <input type="password" name="password" placeholder="Password" autofocus>
      <button type="submit">Login</button>
    </form>
  </div>
</body></html>`;
}

function renderAdminPage({ fans, devices, content, recentFans, posts, allComments }) {
  const artistName = CFG.artistName;
  return `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${artistName} — Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #e0e0e0;
      padding: 2rem 1rem; }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { font-size: 1.4rem; color: #fff; margin-bottom: 0.3rem; }
    .sub { font-size: 0.8rem; color: #666; text-transform: uppercase; letter-spacing: 0.1em;
      margin-bottom: 2rem; }
    .stats { display: flex; gap: 1rem; margin-bottom: 2rem; }
    .stat { flex: 1; background: #161616; border: 1px solid #2a2a2a; border-radius: 10px;
      padding: 1.2rem; text-align: center; }
    .stat .n { font-size: 2rem; font-weight: 700; color: #fff; }
    .stat .l { font-size: 0.7rem; color: #666; text-transform: uppercase; letter-spacing: 0.1em;
      margin-top: 0.3rem; }
    .card { background: #161616; border: 1px solid #2a2a2a; border-radius: 12px;
      padding: 1.5rem; margin-bottom: 1.5rem; }
    .card h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: #666; margin-bottom: 1rem; }
    label { display: block; font-size: 0.8rem; color: #888; margin-bottom: 0.3rem;
      text-transform: uppercase; letter-spacing: 0.05em; }
    input, textarea, select { width: 100%; padding: 0.65rem; border-radius: 6px;
      border: 1px solid #333; background: #222; color: #fff; font-size: 0.95rem;
      margin-bottom: 1rem; font-family: inherit; }
    textarea { resize: vertical; min-height: 70px; }
    select { appearance: none; cursor: pointer; }
    .btn { width: 100%; padding: 0.85rem; border-radius: 8px; border: none;
      background: #fff; color: #000; font-weight: 600; font-size: 1rem; cursor: pointer;
      transition: opacity 0.2s; }
    .btn:hover { opacity: 0.85; }
    .btn-sm { padding: 0.4rem 0.8rem; font-size: 0.8rem; width: auto; border-radius: 6px;
      background: #333; color: #ccc; border: none; cursor: pointer; }
    .btn-sm:hover { background: #500; color: #f99; }
    .success { background: #1a3a1a; border: 1px solid #2a5a2a; color: #6fcf8a;
      padding: 0.8rem 1rem; border-radius: 8px; margin-bottom: 1.5rem; font-size: 0.9rem; }
    .error { background: #3a1a1a; border: 1px solid #5a2a2a; color: #f66;
      padding: 0.8rem 1rem; border-radius: 8px; margin-bottom: 1.5rem; font-size: 0.9rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; color: #666; font-size: 0.7rem; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 0.5rem 0.3rem; border-bottom: 1px solid #222; }
    td { padding: 0.5rem 0.3rem; border-bottom: 1px solid #1a1a1a; color: #bbb; }
    .issue-link { display: block; background: #161616; border: 1px solid #2a2a2a;
      border-radius: 8px; padding: 0.8rem 1rem; margin-bottom: 1.5rem;
      color: #888; font-size: 0.8rem; word-break: break-all; }
    .issue-link span { color: #fff; }
    .post-item { display: flex; justify-content: space-between; align-items: center;
      padding: 0.6rem 0; border-bottom: 1px solid #1a1a1a; }
    .post-item:last-child { border-bottom: none; }
    .post-info { flex: 1; }
    .post-info .pi-title { color: #ddd; font-size: 0.9rem; }
    .post-info .pi-meta { color: #555; font-size: 0.75rem; margin-top: 0.15rem; }
    .type-badge { display: inline-block; font-size: 0.65rem; padding: 0.15rem 0.4rem;
      border-radius: 4px; background: #222; color: #888; text-transform: uppercase;
      letter-spacing: 0.05em; margin-right: 0.4rem; }
  </style>
</head><body>
  <div class="container">
    <h1>${escHtml(artistName)}</h1>
    <div class="sub">Admin Dashboard</div>

    <div class="stats">
      <div class="stat"><div class="n">${fans}</div><div class="l">Cards Issued</div></div>
      <div class="stat"><div class="n">${devices}</div><div class="l">Devices</div></div>
    </div>

    <div id="msg"></div>
    <script>
      const p = new URLSearchParams(location.search);
      const el = document.getElementById("msg");
      if (p.get("sent")) el.innerHTML = '<div class="success">Broadcast sent! Updated ' + p.get("updated") + ' cards, pushed to ' + p.get("pushed") + ' devices.</div>';
      if (p.get("posted")) el.innerHTML = '<div class="success">Post published to your fan feed.</div>';
      if (p.get("deleted")) el.innerHTML = '<div class="success">Post deleted.</div>';
      if (p.get("comment_deleted")) el.innerHTML = '<div class="success">Comment deleted.</div>';
      if (p.get("error")) el.innerHTML = '<div class="error">Error: ' + p.get("error") + '</div>';
    </script>

    <div class="card">
      <h2>Send Broadcast (updates card + push notification)</h2>
      <form method="POST" action="/admin/broadcast">
        <label>Drop Title</label>
        <input name="latestDrop" placeholder="e.g. New Single — Out Now" value="${escHtml(content?.latest_drop || "")}">
        <label>Date</label>
        <input name="dropDate" placeholder="e.g. 2026-06-01" value="${escHtml(content?.drop_date || "")}">
        <label>Listen URL</label>
        <input name="listenUrl" placeholder="https://open.spotify.com/..." value="${escHtml(content?.listen_url || "")}">
        <label>Message</label>
        <textarea name="message" placeholder="What should fans see on the exclusive page?">${escHtml(content?.message || "")}</textarea>
        <button type="submit" class="btn">Broadcast to All Fans</button>
      </form>
    </div>

    <div class="card">
      <h2>New Post</h2>
      <div id="drop-zone" style="border:2px dashed #333; border-radius:10px; padding:2rem; text-align:center;
        color:#555; cursor:pointer; margin-bottom:1rem; transition:border-color 0.2s, background 0.2s;"
        onclick="document.getElementById('file-input').click()">
        <p style="font-size:0.95rem;">Drop photos or videos here</p>
        <p style="font-size:0.75rem; margin-top:0.3rem; color:#444;">or click to browse</p>
        <input type="file" id="file-input" multiple accept="image/*,video/*" style="display:none;">
      </div>
      <div id="drop-preview" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:1rem;"></div>
      <div id="upload-status" style="color:#6fcf8a; font-size:0.85rem; margin-bottom:0.5rem;"></div>

      <label>Title</label>
      <input id="post-title" placeholder="Optional title">
      <label>Body</label>
      <textarea id="post-body" placeholder="Write something..."></textarea>
      <label>Or paste a media URL <span style="color:#555; text-transform:none; letter-spacing:0;">(Spotify, YouTube, image link)</span></label>
      <input id="post-url" placeholder="https://...">
      <select id="post-type" style="margin-bottom:1rem;">
        <option value="">Auto-detect type</option>
        <option value="text">Text / Update</option>
        <option value="music">Music Embed</option>
        <option value="image">Image</option>
        <option value="video">Video</option>
      </select>
      <button class="btn" id="post-btn" onclick="submitPost()">Publish Post</button>
    </div>

    <script>
      let pendingFiles = [];
      const dropZone = document.getElementById("drop-zone");
      const fileInput = document.getElementById("file-input");
      const preview = document.getElementById("drop-preview");

      dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.style.borderColor = "#666"; dropZone.style.background = "#1a1a1a"; });
      dropZone.addEventListener("dragleave", () => { dropZone.style.borderColor = "#333"; dropZone.style.background = ""; });
      dropZone.addEventListener("drop", e => {
        e.preventDefault(); dropZone.style.borderColor = "#333"; dropZone.style.background = "";
        addFiles(e.dataTransfer.files);
      });
      fileInput.addEventListener("change", e => addFiles(e.target.files));

      function addFiles(fileList) {
        for (const f of fileList) {
          if (f.type.startsWith("image/") || f.type.startsWith("video/")) pendingFiles.push(f);
        }
        renderPreview();
      }

      function renderPreview() {
        preview.innerHTML = pendingFiles.map((f, i) => {
          const url = URL.createObjectURL(f);
          const remove = '<span onclick="removeFile(' + i + ')" style="position:absolute;top:2px;right:4px;color:#f66;cursor:pointer;font-size:14px;">&times;</span>';
          if (f.type.startsWith("video/"))
            return '<div style="position:relative;display:inline-block;"><video src="' + url + '" style="height:60px;border-radius:4px;"></video>' + remove + '</div>';
          return '<div style="position:relative;display:inline-block;"><img src="' + url + '" style="height:60px;border-radius:4px;object-fit:cover;">' + remove + '</div>';
        }).join("");
      }

      function removeFile(i) { pendingFiles.splice(i, 1); renderPreview(); }

      async function submitPost() {
        const btn = document.getElementById("post-btn");
        const status = document.getElementById("upload-status");
        const title = document.getElementById("post-title").value;
        const body = document.getElementById("post-body").value;
        const url = document.getElementById("post-url").value;
        const type = document.getElementById("post-type").value;

        if (!pendingFiles.length && !body && !url && !title) { alert("Add some content first"); return; }

        btn.disabled = true; btn.textContent = "Publishing...";
        status.textContent = "";

        if (pendingFiles.length) {
          // Upload via API with files
          const form = new FormData();
          form.append("title", title);
          form.append("body", body);
          if (type) form.append("type", type);
          for (const f of pendingFiles) form.append("media", f);

          try {
            status.textContent = "Uploading " + pendingFiles.length + " file(s)...";
            const res = await fetch("/api/posts", {
              method: "POST",
              headers: { "Authorization": "${escHtml(process.env.ADMIN_PASSWORD || "")}" },
              body: form,
            });
            if (!res.ok) { const e = await res.json(); alert(e.error || "Upload failed"); return; }
            status.textContent = "Published!";
            pendingFiles = []; preview.innerHTML = "";
            document.getElementById("post-title").value = "";
            document.getElementById("post-body").value = "";
            setTimeout(() => location.reload(), 500);
          } catch(e) { alert("Error: " + e.message); }
          finally { btn.disabled = false; btn.textContent = "Publish Post"; }
        } else {
          // Text/URL post — use the regular form submit
          const form = document.createElement("form");
          form.method = "POST"; form.action = "/admin/post";
          const fields = { postType: type || "text", title, body, mediaUrl: url };
          for (const [k, v] of Object.entries(fields)) {
            const inp = document.createElement("input");
            inp.type = "hidden"; inp.name = k; inp.value = v;
            form.appendChild(inp);
          }
          document.body.appendChild(form);
          form.submit();
        }
      }
    </script>

    ${posts.length ? `
    <div class="card">
      <h2>Recent Posts</h2>
      ${posts.map(p => `<div class="post-item">
        <div class="post-info">
          <div class="pi-title"><span class="type-badge">${escHtml(p.post_type)}</span>${escHtml(p.title || p.body?.slice(0, 60) || "(no content)")}</div>
          <div class="pi-meta">${escHtml(p.created_at?.slice(0, 10) || "")}</div>
        </div>
        <form method="POST" action="/admin/post/delete" style="margin:0;">
          <input type="hidden" name="id" value="${p.id}">
          <button type="submit" class="btn-sm" onclick="return confirm('Delete this post?')">Delete</button>
        </form>
      </div>`).join("")}
    </div>
    ` : ""}

    ${allComments && allComments.length ? `
    <div class="card">
      <h2>Comments (${allComments.length})</h2>
      ${allComments.map(c => `<div class="post-item">
        <div class="post-info">
          <div class="pi-title"><strong>${escHtml(c.author_name)}</strong> on <em>${escHtml(c.post_slug)}</em></div>
          <div class="pi-meta">${escHtml(c.body?.slice(0, 100) || "")}${c.body?.length > 100 ? "..." : ""} — ${escHtml(c.created_at?.slice(0, 10) || "")}</div>
        </div>
        <form method="POST" action="/admin/comment/delete" style="margin:0;">
          <input type="hidden" name="id" value="${c.id}">
          <button type="submit" class="btn-sm" onclick="return confirm('Delete this comment?')">Delete</button>
        </form>
      </div>`).join("")}
    </div>
    ` : ""}

    <div class="issue-link">
      Issue link: <span>${escHtml(CFG.webServiceUrl)}/issue?name=NAME&email=EMAIL</span>
    </div>

    ${recentFans.length ? `
    <div class="card">
      <h2>Recent Fans</h2>
      <table>
        <tr><th>Name</th><th>Email</th><th>Source</th><th>Joined</th></tr>
        ${recentFans.map(f => `<tr>
          <td>${escHtml(f.name)}</td>
          <td>${escHtml(f.email || "—")}</td>
          <td>${escHtml(f.source || "—")}</td>
          <td>${escHtml(f.created_at?.slice(0, 10) || "—")}</td>
        </tr>`).join("")}
      </table>
    </div>
    ` : ""}
  </div>
</body></html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// =========================================================================
// Start
// =========================================================================
app.listen(CFG.port, () => {
  console.log(`Fan Wallet server running on :${CFG.port}`);
  console.log(`  Issue:     ${CFG.webServiceUrl}/issue?name=...&email=...`);
  console.log(`  Broadcast: POST ${CFG.webServiceUrl}/broadcast`);
  console.log(`  Health:    ${CFG.webServiceUrl}/health`);
});
