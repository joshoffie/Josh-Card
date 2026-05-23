import { readFileSync } from "node:fs";
import { connect } from "node:http2";
import { createPrivateKey, createSign } from "node:crypto";
import { CFG } from "./store.js";

// ---------------------------------------------------------------------------
// APNs token-based auth (ES256 JWT, cached ~50 min)
// ---------------------------------------------------------------------------
let cachedJwt = null;
let cachedAt  = 0;
const JWT_TTL = 50 * 60 * 1000; // refresh every 50 min (Apple max = 60)

function loadKey() {
  return readFileSync(CFG.apnsKeyPath, "utf8");
}

function makeJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: "ES256", kid: CFG.apnsKeyId })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: CFG.teamId, iat: now })).toString("base64url");

  const key = createPrivateKey(loadKey());
  const sig = createSign("SHA256")
    .update(`${header}.${payload}`)
    .sign({ key, dsaEncoding: "ieee-p1363" }, "base64url");

  return `${header}.${payload}.${sig}`;
}

function getJwt() {
  if (!cachedJwt || Date.now() - cachedAt > JWT_TTL) {
    cachedJwt = makeJwt();
    cachedAt  = Date.now();
  }
  return cachedJwt;
}

// ---------------------------------------------------------------------------
// Push one empty notification to a device token
// Wallet pushes are always: empty body, background priority, topic = passTypeId
// ---------------------------------------------------------------------------
export function pushToToken(pushToken) {
  return new Promise((resolve, reject) => {
    const host = CFG.apnsHost.replace(/^https?:\/\//, "");
    const client = connect(`https://${host}`);

    client.on("error", (err) => {
      client.close();
      reject(err);
    });

    const req = client.request({
      ":method": "POST",
      ":path":   `/3/device/${pushToken}`,
      "authorization": `bearer ${getJwt()}`,
      "apns-topic":     CFG.passTypeId,
      "apns-push-type": "background",
      "apns-priority":  "5",
    });

    let status;
    let body = "";

    req.on("response", (headers) => {
      status = headers[":status"];
    });

    req.on("data", (chunk) => { body += chunk; });

    req.on("end", () => {
      client.close();
      if (status === 200) {
        resolve({ status, pushToken });
      } else {
        reject(new Error(`APNs ${status}: ${body} (token: ${pushToken})`));
      }
    });

    // Wallet push = empty JSON body
    req.end(JSON.stringify({}));
  });
}

// ---------------------------------------------------------------------------
// Fan-out push to all tokens (best-effort, logs failures)
// ---------------------------------------------------------------------------
export async function pushToAll(tokens) {
  const results = await Promise.allSettled(
    tokens.map((t) => pushToToken(t))
  );

  const ok   = results.filter((r) => r.status === "fulfilled").length;
  const fail = results.filter((r) => r.status === "rejected");

  if (fail.length) {
    console.error(`APNs: ${ok} sent, ${fail.length} failed:`);
    fail.forEach((f) => console.error("  ", f.reason?.message));
  } else {
    console.log(`APNs: ${ok} pushes sent`);
  }

  return { sent: ok, failed: fail.length };
}
