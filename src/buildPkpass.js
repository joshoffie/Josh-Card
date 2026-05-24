import { PKPass } from "passkit-generator";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { CFG, authTokenFor, getCurrentContent } from "./store.js";

// ---------------------------------------------------------------------------
// Load signing materials lazily (so server boots even without certs)
// ---------------------------------------------------------------------------
let _signerCert, _signerKey, _wwdr;

function loadCerts() {
  if (!_signerCert) {
    _signerCert = readFileSync(CFG.signerCert);
    _signerKey  = readFileSync(CFG.signerKey);
    _wwdr       = readFileSync(CFG.wwdr);
  }
  return { signerCert: _signerCert, signerKey: _signerKey, wwdr: _wwdr };
}

// ---------------------------------------------------------------------------
// Image buffers — loaded once from pass-template/
// ---------------------------------------------------------------------------
const TEMPLATE = resolve("pass-template");

function tryImage(name) {
  try { return readFileSync(resolve(TEMPLATE, name)); }
  catch { return null; }
}

const images = {
  "icon.png":      tryImage("icon.png"),
  "icon@2x.png":   tryImage("icon@2x.png"),
  "logo.png":      tryImage("logo.png"),
  "logo@2x.png":   tryImage("logo@2x.png"),
  "strip.png":     tryImage("strip.png"),
  "strip@2x.png":  tryImage("strip@2x.png"),
};

// ---------------------------------------------------------------------------
// Generate a personalized strip with the fan's name baked in (black text)
// ---------------------------------------------------------------------------
async function personalizedStrip(name, scale) {
  const base = scale === 2 ? images["strip@2x.png"] : images["strip.png"];
  if (!base) return null;
  const w = scale === 2 ? 1125 : 563;
  const h = scale === 2 ? 432 : 216;
  const fontSize = scale === 2 ? 72 : 36;
  const x = scale === 2 ? 60 : 30;
  const y = scale === 2 ? 260 : 130;

  const svg = `<svg width="${w}" height="${h}">
    <text x="${x}" y="${y}" font-size="${fontSize}" font-family="Helvetica, Arial, sans-serif" font-weight="300" fill="#000000">${name.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</text>
  </svg>`;

  return sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

// ---------------------------------------------------------------------------
// Build a signed .pkpass buffer for one fan
// ---------------------------------------------------------------------------
export default async function buildPkpass({ name, email, serial, source }) {
  const content = getCurrentContent();
  const authToken = authTokenFor(serial);
  const secretUrl = `${CFG.webServiceUrl}/secret/${authToken}`;

  const certs = loadCerts();

  const pkpass = new PKPass(
    {},  // no template directory — we add buffers manually
    {
      signerCert: certs.signerCert,
      signerKey: certs.signerKey,
      signerKeyPassphrase: CFG.signerPass || undefined,
      wwdr: certs.wwdr,
    },
    {
      serialNumber:        serial,
      passTypeIdentifier:  CFG.passTypeId,
      teamIdentifier:      CFG.teamId,
      organizationName:    "Josh Card",
      description:         "Josh Card",
      foregroundColor:     "rgb(0, 0, 0)",
      backgroundColor:     "rgb(251, 242, 234)",
      labelColor:          "rgb(80, 80, 80)",
      webServiceURL:       CFG.webServiceUrl,
      authenticationToken: authToken,
    }
  );

  // Pass type — storeCard supports strip images
  pkpass.type = "storeCard";

  // --- Images (with personalized strip) ---
  for (const [filename, buf] of Object.entries(images)) {
    if (filename.startsWith("strip")) continue; // we'll add custom strips
    if (buf) pkpass.addBuffer(filename, buf);
  }
  const strip2x = await personalizedStrip(name, 2);
  const strip1x = await personalizedStrip(name, 1);
  if (strip2x) pkpass.addBuffer("strip@2x.png", strip2x);
  if (strip1x) pkpass.addBuffer("strip.png", strip1x);

  // --- Text fields ---
  pkpass.headerFields.push({
    key: "memberSince",
    label: "MEMBER",
    value: new Date().getFullYear().toString(),
  });

  pkpass.secondaryFields.push({
    key: "latestDrop",
    label: "NEW SINGLE",
    value: content?.latest_drop || "Stay tuned...",
    // changeMessage triggers lock-screen notification on update
    changeMessage: "New drop: %@",
  });

  if (content?.drop_date) {
    pkpass.secondaryFields.push({
      key: "dropDate",
      label: "DATE",
      value: content.drop_date,
    });
  }

  // --- Back of card ---
  pkpass.backFields.push(
    {
      key: "exclusiveLink",
      label: "Fans Only",
      value: secretUrl,
    },
    {
      key: "listenLink",
      label: "Listen",
      value: content?.listen_url || CFG.webServiceUrl,
    },
    {
      key: "about",
      label: "About This Card",
      value:
        "This card gets you access to exclusive content, early releases, " +
        "and fan-only drops. Keep it in your Apple Wallet — we'll send " +
        "updates straight to your lock screen.",
    }
  );

  // --- QR code (for live shows / merch scanning) ---
  pkpass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: JSON.stringify({ serial, name, t: authToken }),
    messageEncoding: "iso-8859-1",
  });

  // Generate the signed buffer
  return pkpass.getAsBuffer();
}
