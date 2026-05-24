import { PKPass } from "passkit-generator";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
      logoText:            "Josh Card",
      webServiceURL:       CFG.webServiceUrl,
      authenticationToken: authToken,
    }
  );

  // Pass type — storeCard supports strip images
  pkpass.type = "storeCard";

  // --- Images ---
  for (const [filename, buf] of Object.entries(images)) {
    if (buf) pkpass.addBuffer(filename, buf);
  }

  // --- Text fields ---
  pkpass.headerFields.push({
    key: "memberSince",
    label: "MEMBER",
    value: new Date().getFullYear().toString(),
  });

  pkpass.primaryFields.push({
    key: "fanName",
    label: "",
    value: name,
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
