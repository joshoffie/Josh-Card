# Fan Wallet

Apple Wallet fan card — issue `.pkpass` files, push lock-screen updates, serve an exclusive content page. No app, no social media, no feed. Just a card in your fans' wallets.

## Architecture

```
Fan taps "Add to Wallet" link
  → GET /issue?name=...&email=...
  → server mints a signed .pkpass, returns it
  → iPhone adds the pass + POSTs registration (device token) back to the server

You drop new content:
  → POST /broadcast { latestDrop, dropDate, listenUrl, message }
  → server updates all passes + pushes APNs to every registered device
  → each device fetches the updated pass
  → lock screen shows "New drop: ..."

Fan taps "Fans Only" link on back of card:
  → GET /secret/:token
  → token-gated page with exclusive content
```

## Setup

### 1. Apple Developer Portal

You need an [Apple Developer account](https://developer.apple.com) ($99/yr).

**Create a Pass Type ID:**
1. Certificates, Identifiers & Profiles → Identifiers → + → Pass Type IDs
2. Description: `Fan Card`, Identifier: `pass.com.yourname.fancard`
3. Note your **Team ID** (top right of the portal, or Membership page)

**Create the signing certificate:**
1. Open **Keychain Access** on your Mac
2. Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority
3. Enter your email, select "Saved to disk", click Continue → saves a `.certSigningRequest`
4. Back in the portal: Certificates → + → Pass Type ID Certificate
5. Select your Pass Type ID, upload the CSR, download the `.cer`
6. Double-click the `.cer` to install in Keychain
7. In Keychain Access, find the cert, right-click → Export → save as `.p12` (set a passphrase)

**Convert to PEM (run in terminal):**
```bash
# Extract the signing cert
openssl pkcs12 -in pass.p12 -clcerts -nokeys -out certs/signerCert.pem -legacy

# Extract the private key
openssl pkcs12 -in pass.p12 -nocerts -out certs/signerKey.pem -legacy
```

**Download WWDR G4 certificate:**
```bash
# Download from Apple
curl -O https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer

# Convert DER to PEM
openssl x509 -inform der -in AppleWWDRCAG4.cer -out certs/wwdr.pem
```
> **Important:** Must be the G4 generation. Wrong WWDR = pass won't open on device.

**Create APNs auth key:**
1. Portal → Keys → + → Apple Push Notifications service (APNs)
2. Download the `.p8` file (you can only download it once)
3. Note the **Key ID**
4. Save to `certs/APNsAuthKey.p8`

### 2. Pass Images

Place PNG images in `pass-template/`:

| File | Size | Purpose |
|------|------|---------|
| `icon.png` | 29×29 | Notification icon |
| `icon@2x.png` | 58×58 | Notification icon (retina) |
| `logo.png` | ~160×50 | Top-left logo on the card |
| `logo@2x.png` | ~320×100 | Logo (retina) |
| `strip.png` | 375×123 | Banner image behind primary fields |
| `strip@2x.png` | 750×246 | Banner (retina) |

All must be PNG. Transparency is supported.

### 3. Environment Variables

```bash
cp .env.example .env
```

Fill in all values. For Railway, set these as environment variables in the Railway dashboard instead.

**Railway-specific note:** The `WEB_SERVICE_URL` must be your Railway public URL (e.g., `https://your-app.up.railway.app`) — this URL gets baked into every pass at issue time.

### 4. Deploy to Railway

The repo is configured for Railway with `railway.json`. Connect your GitHub repo in the Railway dashboard and it will auto-deploy on push.

**Railway environment variables to set:**
- `PASS_TYPE_ID` — your pass type identifier
- `TEAM_ID` — Apple Team ID
- `APNS_KEY_ID` — APNs key ID
- `APNS_KEY_PATH` — path to .p8 (upload as a Railway volume or base64-encode)
- `WEB_SERVICE_URL` — your Railway public URL
- `ARTIST_NAME` — displayed on the card and fan page
- `SIGNER_CERT`, `SIGNER_KEY`, `WWDR_CERT` — cert paths
- `PORT` — Railway sets this automatically

For certs on Railway, you have two options:
1. **Volume mount:** attach a volume, upload certs there, point env vars to the mount path
2. **Base64 env vars:** encode each cert as base64, decode at startup (requires a small code tweak)

### 5. Test Ladder

Test in this order — each step depends on the previous one passing:

1. **Build/sign:** `curl "https://your-app.up.railway.app/issue?name=Test&email=test@test.com" --output test.pkpass` → AirDrop to iPhone → tap → should show "Add"
2. **Registration:** after adding, watch Railway logs for the registration POST from the device
3. **Push:** `curl -X POST https://your-app.up.railway.app/broadcast -H "Content-Type: application/json" -d '{"latestDrop":"First Drop","dropDate":"2026-01-01","listenUrl":"https://spotify.com","message":"Welcome to the inner circle"}'` → lock screen should show "New drop: First Drop"
4. **Fan page:** open the "Fans Only" link from the back of the card → should show the exclusive content page

## API Reference

### `GET /issue?name=&email=&source=`
Mint and return a `.pkpass`. The `source` param is for attribution tracking.

### `POST /broadcast`
```json
{
  "latestDrop": "Track Name",
  "dropDate": "2026-06-01",
  "listenUrl": "https://open.spotify.com/...",
  "message": "Exclusive early listen for card holders"
}
```
Updates all passes and pushes to all registered devices.

### `GET /secret/:token`
Token-gated exclusive content page. The token is the pass's auth token — linked from the back of the card.

### `GET /health`
Returns `{ "status": "ok" }` — used by Railway health checks.
