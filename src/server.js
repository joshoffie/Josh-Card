import express from "express";
import { resolve } from "node:path";
import {
  CFG, db,
  authTokenFor, verifyAuth,
  createPass, getPassBySerial, getAllSerials,
  updateFields, registerDevice, unregisterDevice,
  getSerialsForDevice, getTokensForSerial,
  getCurrentContent, setContent,
} from "./store.js";
import buildPkpass from "./buildPkpass.js";
import { pushToAll } from "./apns.js";

const app = express();
app.use(express.json());
app.use("/public", express.static(resolve("public")));

// =========================================================================
// Health check (Railway / uptime monitors)
// =========================================================================
app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// =========================================================================
// JOSH'S ENDPOINTS
// =========================================================================

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

app.use("/admin", requireAdmin);
app.use("/admin", express.urlencoded({ extended: false }));

app.get("/admin", (req, res) => {
  const fans = db.prepare("SELECT COUNT(*) as c FROM passes").get().c;
  const devices = db.prepare("SELECT COUNT(DISTINCT push_token) as c FROM registrations").get().c;
  const content = getCurrentContent();
  const recentFans = db.prepare("SELECT name, email, source, created_at FROM passes ORDER BY created_at DESC LIMIT 10").all();
  res.send(renderAdminPage({ fans, devices, content, recentFans }));
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

// =========================================================================
// EXCLUSIVE FAN PAGE — token-gated
// =========================================================================
app.get("/secret/:token", (req, res) => {
  // Find the pass whose authToken matches
  const { token } = req.params;
  const serials = getAllSerials();
  const serial = serials.find((s) => authTokenFor(s) === token);

  if (!serial) {
    return res.status(404).send(renderErrorPage("Invalid or expired link"));
  }

  const pass = getPassBySerial(serial);
  const content = getCurrentContent();

  res.send(renderFanPage(pass, content));
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

function renderFanPage(pass, content) {
  const artistName = CFG.artistName;
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
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      padding: 2rem 1rem;
    }
    .container { max-width: 480px; margin: 0 auto; }
    .header {
      text-align: center;
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid #222;
    }
    .header h1 {
      font-size: 1.6rem;
      color: #fff;
      margin-bottom: 0.3rem;
    }
    .header .subtitle {
      font-size: 0.85rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.15em;
    }
    .welcome {
      font-size: 0.95rem;
      color: #aaa;
      margin-bottom: 2rem;
    }
    .card {
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card h2 {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #666;
      margin-bottom: 0.75rem;
    }
    .card .value {
      font-size: 1.2rem;
      color: #fff;
      line-height: 1.4;
    }
    .card .date {
      font-size: 0.85rem;
      color: #888;
      margin-top: 0.4rem;
    }
    .card .message {
      font-size: 0.95rem;
      color: #ccc;
      line-height: 1.5;
      margin-top: 0.75rem;
    }
    .listen-btn {
      display: block;
      text-align: center;
      background: #fff;
      color: #000;
      font-weight: 600;
      font-size: 1rem;
      padding: 0.9rem;
      border-radius: 8px;
      text-decoration: none;
      margin-top: 1.5rem;
      transition: opacity 0.2s;
    }
    .listen-btn:hover { opacity: 0.85; }
    .footer {
      text-align: center;
      font-size: 0.75rem;
      color: #444;
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid #1a1a1a;
    }
    .empty-state {
      text-align: center;
      padding: 2rem;
      color: #555;
      font-size: 0.95rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${artistName}</h1>
      <div class="subtitle">Fans Only</div>
    </div>

    <p class="welcome">Hey ${pass.name} — thanks for holding the card.</p>

    ${content?.latest_drop ? `
    <div class="card">
      <h2>Latest Drop</h2>
      <div class="value">${escHtml(content.latest_drop)}</div>
      ${content.drop_date ? `<div class="date">${escHtml(content.drop_date)}</div>` : ""}
      ${content.message ? `<div class="message">${escHtml(content.message)}</div>` : ""}
    </div>
    ` : `
    <div class="card empty-state">
      Nothing here yet — you'll be the first to know when something drops.
    </div>
    `}

    ${content?.listen_url ? `
    <a href="${escHtml(content.listen_url)}" class="listen-btn">Listen Now</a>
    ` : ""}

    <div class="footer">
      This page is for card holders only. Don't share the link.
    </div>
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
    <form method="POST" action="/admin?_pw=">
      <input type="password" name="password" placeholder="Password" autofocus>
      <button type="submit">Login</button>
    </form>
  </div>
</body></html>`;
}

function renderAdminPage({ fans, devices, content, recentFans }) {
  const artistName = CFG.artistName;
  const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
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
    input, textarea { width: 100%; padding: 0.65rem; border-radius: 6px;
      border: 1px solid #333; background: #222; color: #fff; font-size: 0.95rem;
      margin-bottom: 1rem; font-family: inherit; }
    textarea { resize: vertical; min-height: 70px; }
    .btn { width: 100%; padding: 0.85rem; border-radius: 8px; border: none;
      background: #fff; color: #000; font-weight: 600; font-size: 1rem; cursor: pointer;
      transition: opacity 0.2s; }
    .btn:hover { opacity: 0.85; }
    .success { background: #1a3a1a; border: 1px solid #2a5a2a; color: #6fcf8a;
      padding: 0.8rem 1rem; border-radius: 8px; margin-bottom: 1.5rem; font-size: 0.9rem; }
    .error { background: #3a1a1a; border: 1px solid #5a2a2a; color: #f66;
      padding: 0.8rem 1rem; border-radius: 8px; margin-bottom: 1.5rem; font-size: 0.9rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; color: #666; font-size: 0.7rem; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 0.5rem 0.3rem; border-bottom: 1px solid #222; }
    td { padding: 0.5rem 0.3rem; border-bottom: 1px solid #1a1a1a; color: #bbb; }
    .current { font-size: 0.85rem; color: #888; line-height: 1.6; }
    .current strong { color: #ccc; }
    .issue-link { display: block; background: #161616; border: 1px solid #2a2a2a;
      border-radius: 8px; padding: 0.8rem 1rem; margin-bottom: 1.5rem;
      color: #888; font-size: 0.8rem; word-break: break-all; }
    .issue-link span { color: #fff; }
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
      if (p.get("error")) el.innerHTML = '<div class="error">Error: ' + p.get("error") + '</div>';
    </script>

    <div class="card">
      <h2>Send Broadcast</h2>
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
