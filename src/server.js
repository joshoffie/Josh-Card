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
