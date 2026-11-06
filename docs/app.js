// =========================================================================
// Josh's Blog — single-page app (no build step)
// Looks like a personal blog from about 2003: Blogger-style entries,
// LiveJournal moods, an AIM-style messenger, XP pop-up windows and GIFs.
// =========================================================================
const API = window.JOSH_API || "https://josh-card-production.up.railway.app";
const CATS = { software: "Software", art: "Art", music: "Music", old: "Old Stuff" };
// Josh's YouTube channels: the current one (YouTube tab) and his old one (Old Stuff tab)
const YOUTUBE = { channelId: "UCGHriOkfa6n_a0LawFbTrQA", name: "Josh Hoffman", handle: "@JoshHoffmanMusic" };
const OLD_YOUTUBE = { channelId: "UC58D_1R64itBfH4wjP8E8jQ", name: "Calvin Kingston", handle: "@calvinkingston_" };
const OLD_SPOTIFY = "https://open.spotify.com/artist/6nN86x5WiStduylr1z2735";
const PAGE = 20;
const MOOD_FALLBACK = ["happy", "excited", "chill", "creative", "sleepy", "hungry", "sad", "annoyed", "loved",
  "cool", "accomplished", "nostalgic", "silly", "thoughtful", "busy"];

const state = {
  token: safeGet("token"),
  me: null,
  config: { categories: Object.keys(CATS), gif_search: false, report_reasons: {}, points: {}, moods: MOOD_FALLBACK, about: null },
  route: { name: "feed", params: [] },
  posts: [], postsKey: "", postsDone: false, loadingPosts: false, pinned: [],
  post: null, comments: [],
  profile: null,
  friends: [], requests: { received: [], sent: [] },
  chats: [], chat: null, chatTimer: null,
  mod: null,
  youtube: null,
  recent: [], hits: null,
  cc: { replyTo: null, gif: null, file: null, gifOpen: false },   // comment composer
  pc: { files: [] },                                               // Josh's post composer
  mc: { gifOpen: false },                                          // message composer
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function src(u) {
  u = String(u || "");
  if (u.startsWith("/media/")) return API + u;
  return /^https?:\/\//i.test(u) ? u : "";
}
function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${m}</a>`);
}
function parseDate(d) {
  if (!d) return 0;
  d = String(d);
  return new Date(d.includes("T") ? (/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : d + "Z") : d.replace(" ", "T") + "Z").getTime();
}
const pad2 = (n) => String(n).padStart(2, "0");
function fmtTime(d) {
  const t = parseDate(d); if (!t) return "";
  return new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function fmtDay(d) {
  const t = parseDate(d); if (!t) return "";
  const x = new Date(t);
  return `${x.toLocaleDateString("en-US", { weekday: "long" })}, ${x.toLocaleDateString("en-US", { month: "long" })} ${pad2(x.getDate())}, ${x.getFullYear()}`;
}
function fmtStamp(d) {   // 11/06/2026 3:45 PM — how Blogger stamped comments
  const t = parseDate(d); if (!t) return "";
  const x = new Date(t);
  return `${pad2(x.getMonth() + 1)}/${pad2(x.getDate())}/${x.getFullYear()} ${fmtTime(d)}`;
}
function fmtChat(d) {     // AIM-style (3:42 PM), with the date if it's not today
  const t = parseDate(d); if (!t) return "";
  const x = new Date(t);
  return x.toDateString() === new Date().toDateString() ? fmtTime(d) : `${pad2(x.getMonth() + 1)}/${pad2(x.getDate())} ${fmtTime(d)}`;
}
function timeAgo(d) {
  const t = parseDate(d); if (!t) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const ago = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (s < 3600) return ago(Math.floor(s / 60), "min");
  if (s < 86400) return ago(Math.floor(s / 3600), "hour");
  if (s < 604800) return ago(Math.floor(s / 86400), "day");
  return fmtStamp(d).split(" ")[0];
}
function joined(d) {
  const t = parseDate(d);
  return t ? new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";
}
const isNew = (d) => Date.now() - parseDate(d) < 3 * 86400000;
function ageBadge(createdAt) {
  const t = parseDate(createdAt); const days = t ? Math.floor((Date.now() - t) / 86400000) : 0;
  if (days < 7) return "New";
  if (days < 30) return "1 week"; if (days < 90) return "1 month"; if (days < 180) return "3 months"; if (days < 365) return "6 months";
  const y = Math.floor(days / 365); return y === 1 ? "1 year" : `${y} years`;
}
// 80x15 "antipixel" style badges, the 2003 web-standards look
function ap(left, right, cls = "") { return `<span class="ap ${cls}"><b>${esc(left)}</b><i>${esc(right)}</i></span>`; }
function badgeHtml(label) {
  if (label === "New") return ap("NEW", "MEMBER", "ap-new");
  return ap(label.replace(" years", " YRS").replace(" year", " YR").replace(" months", " MO").replace(" month", " MO").replace(" week", " WK").toUpperCase(), "MEMBER", "ap-age");
}
const joshBadge = () => ap("BLOG", "AUTHOR", "ap-josh");
const pts = (n) => `<span class="pts">★ ${n || 0} pts</span>`;
function initial(n) { return (String(n || "?").trim()[0] || "?").toUpperCase(); }
const AV_COLORS = ["#ff66cc", "#6699ff", "#33cc99", "#ff9933", "#9966ff", "#33ccff", "#ff6666", "#99cc33"];
function avColor(n) { let h = 0; for (const c of String(n || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
function avatar(u, cls = "") {
  const url = src(u?.avatar_url);
  if (url) return `<span class="av ${cls}"><img src="${esc(url)}" alt="" loading="lazy"></span>`;
  return `<span class="av ${cls}" style="background:${avColor(u?.username)}">${esc(initial(u?.display_name || u?.username))}</span>`;
}
function joshPic(cls = "") {
  const url = src(state.config.about?.avatar_url);
  if (url) return `<span class="av josh-pic ${cls}"><img src="${esc(url)}" alt="Josh"></span>`;
  return `<span class="av josh-pic ${cls}">J</span>`;
}
const pix = (name, cls = "") => `<span class="pix pix-${name} ${cls}" aria-hidden="true"></span>`;
const uicon = `<img class="uicon" src="img/user.gif" alt="" width="12" height="13">`;
const loading = (what = "Loading") => `<div class="empty"><img src="img/hourglass.gif" alt="" class="hg"> ${esc(what)}...</div>`;
const heart = `<span class="props" aria-hidden="true"></span>`;
const ICON_FOR = { u: "profile", join: "login" };

function toast(msg, ok = false) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast" + (ok ? " ok" : "");
  el.innerHTML = `<b>${ok ? "✔" : "⚠"}</b> <span></span>`;
  el.querySelector("span").textContent = msg;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
window.addEventListener("unhandledrejection", (e) => {
  const err = e.reason;
  if (err?.status === 401 && state.token) { logoutLocal(); toast("Please log in again"); return; }
  if (err?.code === "confirm_required") { openConfirm(); return; }
  toast(err?.message || "Something went wrong");
});

// Pop-up "windows". The first <h3> in the html becomes the title bar.
function modal(html, cls = "") {
  closeModal();
  const back = document.createElement("div");
  back.className = "modal-back";
  back.id = "modal";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const h3 = tmp.querySelector("h3");
  const title = h3 ? h3.textContent : "Josh's Blog";
  h3?.remove();
  back.innerHTML = `<div class="win modal ${cls}" role="dialog" aria-label="${esc(title)}">
    <div class="win-title"><span>${esc(title)}</span><button class="win-x" onclick="closeModal()" aria-label="Close">✕</button></div>
    <div class="win-body"></div></div>`;
  back.querySelector(".win-body").append(...tmp.childNodes);
  back.addEventListener("click", (e) => { if (e.target === back) closeModal(); });
  document.body.appendChild(back);
}
function closeModal() { document.getElementById("modal")?.remove(); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  if (state.token) headers.Authorization = "Bearer " + state.token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(API + "/api/social" + path, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Request failed"), { status: res.status, code: data.code });
  return data;
}

// Same as api() for form uploads, but reports progress (big music files take a while)
function apiUpload(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", API + "/api/social" + path);
    if (state.token) x.setRequestHeader("Authorization", "Bearer " + state.token);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    x.onload = () => {
      let data = {}; try { data = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300) resolve(data);
      else reject(Object.assign(new Error(data.error || "Upload failed"), { status: x.status, code: data.code }));
    };
    x.onerror = () => reject(new Error("Upload failed — check your connection"));
    x.send(form);
  });
}

function logoutLocal() {
  state.token = null; state.me = null; safeSet("token", null);
  stopChatPoll();
  render();
}

function needAccount(what = "do that") {
  if (state.me) return false;
  modal(`<h3>Members only</h3>
    <div class="row" style="align-items:flex-start"><img src="img/i-login.png" class="sprite-still" alt="">
    <p>You need a screen name to ${esc(what)}. It's free! Members must be <b>18 or older</b>.</p></div>
    <div class="win-buttons"><a class="btn btn-primary" href="#/join" onclick="closeModal()">Get a screen name</a>
    <a class="btn" href="#/login" onclick="closeModal()">Sign on</a></div>`);
  return true;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const name = parts[0] || "feed";
  return { name, params: parts.slice(1) };
}

async function go() {
  state.route = parseRoute();
  stopChatPoll();
  closeModal();
  const { name, params } = state.route;
  const needsMe = ["chats", "chat", "friends", "settings", "mod", "u"];
  if (needsMe.includes(name) && !state.me) {
    render();
    return;
  }
  try {
    if (name === "music" && params[0] === "youtube") { location.replace("#/youtube"); return; } // old link
    if (["feed", ...Object.keys(CATS)].includes(name)) await Promise.all([loadPosts(true), loadPinned()]);
    if (name === "post") await loadPost(params[0]);
    if (name === "u") { state.profile = null; render(); state.profile = await api("/users/" + encodeURIComponent(params[0])); }
    if (name === "friends") await loadFriends();
    if (name === "chats") state.chats = await api("/chats");
    if (name === "chat") { state.chat = null; render(); await loadChat(params[0]); startChatPoll(); }
    if (name === "mod") state.mod = await api("/mod/queue");
    if (name === "youtube") { state.youtube = null; render(); state.youtube = await api("/youtube").catch(() => ({ error: true })); }
    if (name === "old") state.oldYoutube = await api("/youtube?channel=old").catch(() => ({ error: true }));
  } catch (e) {
    if (e.status === 404) { render(`<div class="entry"><div class="empty">404 — that page doesn't exist anymore. <a href="#/feed">Go home</a></div></div>`); return; }
    toast(e.message);
  }
  render();
  window.scrollTo(0, 0);
  if (name === "chat") { scrollChatToBottom(); document.querySelector(".im")?.scrollIntoView({ block: "start" }); }
}
window.addEventListener("hashchange", go);
const nav = (h) => { if (location.hash === h) go(); else location.hash = h; };

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
function currentCategory() { return CATS[state.route.name] ? state.route.name : ""; }

async function loadPosts(reset) {
  const cat = currentCategory();
  const key = cat || "all";
  if (reset || state.postsKey !== key) { state.posts = []; state.postsDone = false; state.postsKey = key; }
  if (state.postsDone || state.loadingPosts) return;
  state.loadingPosts = true;
  try {
    const batch = await api(`/posts?limit=${PAGE}&offset=${state.posts.length}${cat ? "&category=" + cat : ""}`);
    state.posts.push(...batch);
    if (batch.length < PAGE) state.postsDone = true;
  } finally { state.loadingPosts = false; }
}
async function loadMore() { await loadPosts(false); render(); }
async function loadPinned() {
  const cat = currentCategory();
  state.pinned = cat ? await api("/posts/pinned?category=" + cat).catch(() => []) : [];
}

async function loadPost(id) {
  const data = await api("/posts/" + encodeURIComponent(id));
  state.post = data.post; state.comments = data.comments;
}

async function loadFriends() {
  const [friends, requests] = await Promise.all([api("/friends"), api("/friends/requests")]);
  state.friends = friends; state.requests = requests;
}

async function refreshMe() {
  if (!state.token) return;
  try { state.me = await api("/auth/me"); }
  catch (e) { if (e.status === 401) { state.token = null; state.me = null; safeSet("token", null); } }
}
async function loadRecent() { try { state.recent = await api("/posts?limit=8"); } catch {} }

// Light refresh of badges every 30s (no full re-render while typing)
setInterval(async () => {
  if (!state.me || document.hidden) return;
  await refreshMe();
  updateBadges();
}, 30000);

function updateBadges() {
  document.querySelectorAll("[data-badge]").forEach((el) => {
    const n = state.me?.[el.dataset.badge] || 0;
    el.textContent = n; el.classList.toggle("hidden", !n);
  });
  const mail = document.getElementById("mail-alert");
  if (mail) mail.outerHTML = mailAlert();
}

// ---------------------------------------------------------------------------
// Page shell: link bar, banner, tabs, marquee, two columns, footer
// ---------------------------------------------------------------------------
function navItems() {
  return [
    { key: "feed", label: "Home", href: "#/feed" },
    { key: "software", label: "Software", href: "#/software" },
    { key: "art", label: "Art", href: "#/art" },
    { key: "music", label: "Music", href: "#/music" },
    { key: "youtube", label: "YouTube", href: "#/youtube" },
    { key: "old", label: "Old Stuff", href: "#/old" },
    { key: "chats", label: "Chats", href: "#/chats", badge: "unread_chats" },
  ];
}
function activeKey() {
  const n = state.route.name;
  if (n === "chat") return "chats";
  if (n === "post" && state.post?.category) return state.post.category;
  if (n === "post") return "feed";
  return n;
}
function countEl(field, red = false) {
  const n = state.me?.[field] || 0;
  return `<span class="count ${red ? "red" : ""} ${n ? "" : "hidden"}" data-badge="${field}">${n}</span>`;
}

function renderLinkBar() {
  const me = state.me;
  const a = activeKey();
  const L = (key, href, label, extra = "") => `<a class="lb ${a === key ? "on" : ""}" href="${href}">${pix(ICON_FOR[key] || key)}${label}${extra}</a>`;
  const right = me
    ? `<span class="lb-hi">Hi, <b>${esc(me.display_name || me.username)}</b>! ${pts(me.points)}</span>
       ${L("u", "#/u/" + encodeURIComponent(me.username), "Profile")}
       ${L("friends", "#/friends", "Friends", countEl("pending_requests"))}
       ${L("settings", "#/settings", "Settings")}
       ${me.is_admin ? L("mod", "#/mod", "Moderation", countEl("mod_open", true)) : ""}
       <a class="lb" href="javascript:void(0)" onclick="doLogout()">${pix("logout")}Log out</a>`
    : `<span class="lb-hi">Welcome, <b>Guest</b>!</span>
       ${L("login", "#/login", "Sign on")}
       ${L("join", "#/join", "Get a screen name")}`;
  return `<div class="linkbar"><a class="lb-home" href="#/feed">${pix("feed")} Josh's Blog</a><span class="lb-links">${right}</span></div>`;
}

function renderBanner() {
  return `<header class="banner">
    <a class="banner-title" href="#/feed">Josh's Blog</a>
    <img class="tw tw1" src="img/sparkle-big.gif" alt=""><img class="tw tw2" src="img/sparkle.gif" alt=""><img class="tw tw3" src="img/sparkle.gif" alt="">
  </header>`;
}

function renderTabs() {
  const a = activeKey();
  return `<nav class="tabs">${navItems().map((n) => `
    <a class="tab ${a === n.key ? "on" : ""}" href="${n.href}">${pix(n.key)}<span>${n.label}</span>${n.badge ? countEl(n.badge) : ""}</a>`).join("")}</nav>`;
}

function renderMarquee() {
  const p = state.recent[0];
  const latest = p ? (p.title || String(p.body || "").replace(/https?:\/\/\S+/g, "").trim().slice(0, 70) || (p.category ? `new ${CATS[p.category] || ""} post` : "a new post")) : "";
  const bits = ["~*~ welcome to josh's blog ~*~"];
  if (latest) bits.push(`latest entry: “${latest}”`);
  bits.push("leave a comment, add some friends, stay a while");
  return `<div class="marquee"><marquee scrollamount="4" behavior="scroll">${bits.map(esc).join(" &nbsp;&nbsp;★&nbsp;&nbsp; ")}</marquee></div>`;
}

function mailAlert() {
  const n = state.me?.unread_chats || 0;
  if (!n) return `<span id="mail-alert"></span>`;
  return `<a id="mail-alert" class="mail-alert" href="#/chats"><img src="img/mail.gif" alt="" width="20" height="14"> You've got ${n === 1 ? "1 new message" : `${n} new messages`}!</a>`;
}

function sideBox(title, body, cls = "") { return `<div class="sbox ${cls}"><div class="sbox-t">${title}</div><div class="sbox-b">${body}</div></div>`; }

function renderSide() {
  const me = state.me;
  const about = state.config.about;
  const aboutBox = sideBox("About Me", `
    <div class="about">${joshPic("lg")}
      <div><b>${esc(about?.display_name || "Josh Hoffman")}</b>
      ${about?.bio ? `<p>${esc(about.bio)}</p>` : ""}</div></div>
    <a class="more" href="#/u/${esc(about?.username || "josh")}" onclick="return !needAccount('see profiles')">View my complete profile »</a>
    ${about?.id && state.me?.id !== about.id ? `<a class="more" href="javascript:void(0)" onclick="messageJosh()">${pix("chats")} Send me a message »</a>` : ""}`);
  const memberBox = me
    ? sideBox("Member Area", `<div class="about">${avatar(me, "md")}<div><b>${esc(me.display_name || me.username)}</b><br>
        <span class="muted">@${esc(me.username)}</span><br>${me.is_admin ? joshBadge() : badgeHtml(ageBadge(me.created_at))}<br>${pts(me.points)}</div></div>
        ${mailAlert()}
        ${me.pending_requests ? `<a class="mail-alert" href="#/friends"><img src="img/i-friends.png" class="sprite-still" alt=""> ${me.pending_requests} friend request${me.pending_requests > 1 ? "s" : ""}!</a>` : ""}`)
    : sideBox("Hello, Guest!", `<p>Get a free screen name to comment, give props, add friends and chat. Members must be 18+.</p>
        <div class="row" style="margin-top:6px"><a class="btn btn-primary btn-sm" href="#/join">Join</a><a class="btn btn-sm" href="#/login">Sign on</a></div>`);
  const recent = state.recent.length ? sideBox("Recent Posts", `<ul class="stars">${state.recent.slice(0, 8).map((p) => {
    const label = p.title || String(p.body || "").replace(/https?:\/\/\S+/g, "").trim().slice(0, 42) || (p.category ? `${CATS[p.category]} post` : "Post");
    return `<li><a href="#/post/${p.id}">${esc(label)}</a></li>`;
  }).join("")}</ul>`) : "";
  const links = sideBox("Josh's Stuff", `
    <div class="b88s">
      <a class="b88" href="https://apps.apple.com/us/app/trunk-gym-workout-tracker/id6758532994" target="_blank" rel="noopener" title="Trunk on the App Store"><img src="img/btn-trunk.gif" alt="Trunk gym app" width="88" height="31"></a>
      <a class="b88" href="https://josh-hoffman.itch.io/paulie" target="_blank" rel="noopener" title="Paulie on itch.io"><img src="img/btn-paulie.gif" alt="Paulie drum MIDI plugin" width="88" height="31"></a>
      <a class="b88" href="${API}/join" target="_blank" rel="noopener" title="Get a Josh Card"><img src="img/btn-card.gif" alt="Josh Card" width="88" height="31"></a>
      <a class="b88" href="#/feed" title="Josh's Blog"><img src="img/btn-blog.gif" alt="Josh's Blog" width="88" height="31"></a>
    </div>
    <ul class="stars">
      <li><a href="https://open.spotify.com/artist/4tohiTZWHRUFTvF8F6hOnk" target="_blank" rel="noopener">Josh Hoffman on Spotify</a></li>
      <li><a href="https://www.youtube.com/channel/${YOUTUBE.channelId}" target="_blank" rel="noopener">${esc(YOUTUBE.handle)} on YouTube</a></li>
    </ul>`);
  const blinkies = `<div class="blinkies">
    <img src="img/blinkie-blog.gif" alt="Josh's Blog" width="150" height="20">
    <img src="img/blinkie-sam.gif" alt="Software, art, music" width="150" height="20">
    <img src="img/blinkie-comments.gif" alt="Say something" width="150" height="20">
    <img src="img/blinkie-noads.gif" alt="No ads, no pop-ups" width="150" height="20">
    <img src="img/blinkie-18.gif" alt="Members 18+, be cool" width="150" height="20"></div>`;
  const counter = sideBox("Hit Counter", `<div class="odo-wrap">you are visitor #<br>${odometer(state.hits)}</div>`);
  const code = `<a href="https://joshsblog.org"><img src="https://joshsblog.org/img/btn-blog.gif" alt="Josh's Blog" width="88" height="31"></a>`;
  const linkMe = sideBox("Link to Me!", `<div class="center"><img src="img/btn-blog.gif" alt="Josh's Blog button" width="88" height="31"></div>
    <textarea class="code" readonly onclick="this.select()" aria-label="HTML for a link button">${esc(code)}</textarea>
    <button class="btn btn-sm btn-block" onclick="copyLinkCode(this)">Copy code</button>`);
  const uc = `<div class="center uc"><img src="img/under-construction.gif" alt="Under construction" width="88" height="31"><div class="muted small">this site is always under construction</div></div>`;
  return `<aside class="side">${aboutBox}${memberBox}${recent}${links}${blinkies}${counter}${linkMe}${uc}</aside>`;
}

function odometer(n) {
  if (n == null) return `<span class="odo"><b>?</b><b>?</b><b>?</b><b>?</b><b>?</b><b>?</b></span>`;
  return `<span class="odo">${String(n).padStart(6, "0").split("").map((d) => `<b>${d}</b>`).join("")}</span>`;
}
function copyLinkCode(btn) {
  const ta = btn.parentElement.querySelector("textarea");
  ta.select();
  (navigator.clipboard?.writeText(ta.value) || Promise.reject()).then(() => toast("Copied! Paste it on your site.", true)).catch(() => document.execCommand?.("copy"));
}

function renderFooter() {
  const on = sparklesOn();
  return `<footer class="foot">
    <img class="scanner" src="img/scanner.gif" alt="" width="120" height="6">
    <div class="foot-badges">${ap("NO", "ADS")} ${ap("NO", "POP-UPS")} ${ap("GIFS", "PG RATED")} ${ap("MEMBERS", "18+ ONLY")}</div>
    <p>© ${new Date().getFullYear()} Josh Hoffman · Josh's Blog · best viewed at 1024x768 in any browser</p>
    <p><a href="#/rules">rules &amp; safety</a> · <a href="${API}/join" target="_blank" rel="noopener">get a josh card</a> ·
      <a href="javascript:void(0)" onclick="toggleSparkles()">cursor trail: ${on ? "on" : "off"}</a> ·
      <a href="javascript:void(0)" onclick="window.scrollTo(0,0)">back to top ↑</a></p>
  </footer>`;
}

function render(override) {
  const app = document.getElementById("app");
  let content = override;
  if (content === undefined) {
    const n = state.route.name;
    const gated = ["chats", "chat", "friends", "settings", "mod", "u"].includes(n) && !state.me;
    if (gated) content = renderGate(n);
    else if (n === "feed" || CATS[n]) content = renderFeed();
    else if (n === "youtube") content = renderYouTube();
    else if (n === "post") content = renderPostPage();
    else if (n === "u") content = renderProfile();
    else if (n === "friends") content = renderFriends();
    else if (n === "chats") content = renderChats();
    else if (n === "chat") content = renderChat();
    else if (n === "settings") content = renderSettings();
    else if (n === "mod") content = renderMod();
    else if (n === "rules") content = renderRules();
    else if (n === "login") content = renderAuth("login");
    else if (n === "join") content = renderAuth("join");
    else content = `<div class="entry"><div class="empty">404 — page not found. <a href="#/feed">Go home</a></div></div>`;
  }
  app.innerHTML = `${renderLinkBar()}<div class="frame">${renderBanner()}${renderTabs()}${renderMarquee()}
    <div class="cols"><main class="main">${content}</main>${renderSide()}</div>${renderFooter()}</div>`;
}

function renderGate(n) {
  const what = { chats: "chat with friends", chat: "chat with friends", friends: "add friends", settings: "change your settings", mod: "moderate", u: "see member profiles" }[n] || "do that";
  return `<div class="win center-win"><div class="win-title"><span>Members only</span></div><div class="win-body">
    <p>Get a free screen name to ${esc(what)}. Members must be <b>18 or older</b>.</p>
    <div class="win-buttons"><a class="btn btn-primary" href="#/join">Get a screen name</a><a class="btn" href="#/login">Sign on</a></div></div></div>`;
}

// ---------------------------------------------------------------------------
// Feed & entries
// ---------------------------------------------------------------------------
function mediaList(p) {
  const m = String(p.media_url || "");
  if (!m) return [];
  if (m.startsWith("[")) { try { return JSON.parse(m).filter(Boolean); } catch { return []; } }
  return [m];
}
const isVideo = (u) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u) || /\/video\/upload\//.test(u);
function embedHtml(url) {
  url = String(url || "");
  let m;
  if (/^https:\/\/open\.spotify\.com\//.test(url)) {
    const e = url.replace("open.spotify.com/", "open.spotify.com/embed/").split("?")[0];
    // Artists, playlists and albums get the tall player with the track list
    const h = /open\.spotify\.com\/(?:intl-[\w-]+\/)?(?:artist|playlist|album|show)\//.test(url) ? 352 : 152;
    return `<div class="embed"><iframe src="${esc(e)}" height="${h}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe></div>`;
  }
  if ((m = url.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/))) {
    return `<div class="embed"><div class="video-embed"><iframe src="https://www.youtube.com/embed/${esc(m[1])}" allowfullscreen loading="lazy"></iframe></div></div>`;
  }
  if (/^https:\/\/(?:www\.|m\.)?soundcloud\.com\//.test(url)) {
    return `<div class="embed"><iframe height="166" scrolling="no" loading="lazy" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%233399ff&auto_play=false&show_comments=false"></iframe></div>`;
  }
  return "";
}
function firstEmbed(p) {
  for (const u of mediaList(p)) if (embedHtml(u)) return embedHtml(u);
  const links = String(p.body || "").match(/https?:\/\/[^\s]+/g) || [];
  for (const l of links) if (embedHtml(l)) return embedHtml(l);
  return "";
}

// Software posts get a Download button for the first non-embed link in the post
function downloadButton(p) {
  if (p.category !== "software") return "";
  const links = String(p.body || "").match(/https?:\/\/[^\s<]+/g) || [];
  const url = links.find((l) => !embedHtml(l));
  if (!url) return "";
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  return `<div class="download-row"><a class="btn btn-primary btn-dl" href="${esc(url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${pix("software")} Download</a><span class="muted">from ${esc(host)}</span></div>`;
}

function moodOptions(sel = "") {
  return `<option value="">(none)</option>` + (state.config.moods || MOOD_FALLBACK).map((m) => `<option value="${m}" ${m === sel ? "selected" : ""}>${m}</option>`).join("");
}
function renderComposer() {
  if (!state.me?.is_admin) return "";
  const cat = currentCategory();
  return `<fieldset class="composer"><legend>✎ Update your blog</legend>
    <div class="field-row"><label for="pc-title">Subject:</label><input class="input" id="pc-title" maxlength="140" placeholder="(optional)"></div>
    <textarea class="input" id="pc-text" placeholder="What's new, Josh?" rows="4"></textarea>
    <div class="thumbs" id="pc-thumbs">${renderThumbs()}</div>
    <div class="composer-grid">
      <label>Filed under:<select class="input" id="pc-cat">
        <option value="">Home page only</option>
        ${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === cat ? "selected" : ""}>${v}</option>`).join("")}
      </select></label>
      <label>Current mood: <img id="pc-mood-img" src="img/mood-happy.gif" alt="" width="15" height="15" style="visibility:hidden">
        <select class="input" id="pc-mood" onchange="moodPreview(this)">${moodOptions()}</select></label>
      <label>Current music:<input class="input" id="pc-music" maxlength="120" placeholder="(optional)"></label>
    </div>
    <div class="composer-bar">
      <label class="btn">${pix("art")} Add photos / videos
        <input type="file" id="pc-files" accept="image/*,video/*" multiple style="display:none" onchange="addPostFiles(this)"></label>
      <label class="btn">${pix("music")} Add music
        <input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.aif,.aiff" multiple style="display:none" onchange="addPostFiles(this)"></label>
      <span style="flex:1"></span>
      <button class="btn btn-primary" id="pc-btn" onclick="submitPost()">Post Entry</button>
    </div></fieldset>`;
}
function moodPreview(sel) {
  const img = document.getElementById("pc-mood-img");
  if (!sel.value) { img.style.visibility = "hidden"; return; }
  img.src = `img/mood-${sel.value}.gif`; img.style.visibility = "visible";
}
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|flac|aif|aiff)$/i;
const isAudioFile = (f) => f.type.startsWith("audio/") || AUDIO_EXT.test(f.name);
function renderThumbs() {
  const files = state.pc.files;
  const pics = files.map((f, i) => f._audio ? "" : `<div class="t">${f.type.startsWith("image/") ? `<img src="${f._url}" alt="">` : "Video"}
    <button onclick="removePostFile(${i})" aria-label="Remove">✕</button></div>`).join("");
  let n = 0;
  const tracks = files.map((f, i) => f._audio ? `<div class="te"><span class="te-n">${++n}.</span>${pix("music")}
    <input class="input" value="${esc(f._title)}" maxlength="120" aria-label="Track title" oninput="state.pc.files[${i}]._title=this.value">
    <span class="muted small">${(f.size / 1048576).toFixed(1)} MB</span>
    <button class="btn btn-sm" onclick="removePostFile(${i})" aria-label="Remove">✕</button></div>` : "").join("");
  const hint = n ? `<div class="te-hint muted small">Music post: tracks play in this order. Add one picture to use as the cover.</div>` : "";
  return pics + tracks + hint;
}
function addPostFiles(input) {
  for (const f of input.files) {
    if (state.pc.files.length >= 11) { toast("That's the most files one post can have"); break; }
    if (f.size > 100 * 1024 * 1024) { toast(`${f.name} is over 100 MB`); continue; }
    f._url = URL.createObjectURL(f);
    f._audio = isAudioFile(f);
    if (f._audio) f._title = f.name.replace(/\.[^.]+$/, "");
    state.pc.files.push(f);
  }
  input.value = "";
  const cat = document.getElementById("pc-cat");
  if (state.pc.files.some((f) => f._audio) && cat && !cat.value) cat.value = "music";
  document.getElementById("pc-thumbs").innerHTML = renderThumbs();
}
function removePostFile(i) { state.pc.files.splice(i, 1); document.getElementById("pc-thumbs").innerHTML = renderThumbs(); }

async function submitPost() {
  const text = document.getElementById("pc-text").value.trim();
  const title = document.getElementById("pc-title").value.trim();
  if (!text && !title && !state.pc.files.length) return toast("Write something or add media");
  const btn = document.getElementById("pc-btn");
  btn.disabled = true; btn.textContent = "Posting...";
  const fd = new FormData();
  fd.append("title", title);
  fd.append("body", text);
  fd.append("category", document.getElementById("pc-cat").value);
  fd.append("mood", document.getElementById("pc-mood").value);
  fd.append("music", document.getElementById("pc-music").value.trim());
  state.pc.files.forEach((f) => fd.append("media", f));
  fd.append("track_titles", JSON.stringify(state.pc.files.filter((f) => f._audio).map((f) => f._title || "")));
  try {
    await apiUpload("/posts", fd, (pct) => { btn.textContent = pct < 100 ? `Uploading ${pct}%...` : "Saving..."; });
    state.pc.files = [];
    toast("Posted!", true);
    await Promise.all([loadPosts(true), loadRecent()]); render();
  } finally { btn.disabled = false; btn.textContent = "Post Entry"; }
}

function renderVideoList(yt, ch) {
  const channel = `https://www.youtube.com/channel/${yt?.channel_id || ch.channelId}`;
  const head = `<div class="entry yt-head"><div class="row">${ch === YOUTUBE ? joshPic("md") : `<span class="av md josh-pic">${pix("youtube")}</span>`}
    <div style="flex:1"><b class="yt-name">${esc(ch.name)}</b><br><span class="muted">${esc(ch.handle)} on YouTube${yt?.videos?.length ? ` · ${yt.videos.length} video${yt.videos.length === 1 ? "" : "s"}` : ""}</span></div>
    <a class="btn btn-primary" href="${channel}" target="_blank" rel="noopener noreferrer">Open channel</a></div></div>`;
  if (!yt) return head + loading("Loading videos");
  if (yt.error || !yt.videos?.length) {
    // Couldn't list the videos: fall back to YouTube's own uploads player
    const uploads = "UU" + (yt.channel_id || ch.channelId).slice(2);
    return `${head}<div class="entry"><div class="embed"><div class="video-embed"><iframe src="https://www.youtube.com/embed/videoseries?list=${uploads}" title="${esc(ch.name)} on YouTube" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div></div></div>`;
  }
  let lastDay = null;
  const videos = yt.videos.map((v) => {
    const day = v.published ? fmtDay(v.published) : "Older uploads";
    const dh = day !== lastDay ? `<h2 class="date-header">${esc(day)}</h2>` : "";
    lastDay = day;
    return `${dh}<div class="entry yt-video">
      <h3 class="entry-title">${esc(v.title || "Untitled video")} ${v.published && isNew(v.published) ? `<img src="img/new.gif" alt="new" class="new">` : ""}</h3>
      <div class="embed"><div class="video-embed"><iframe src="https://www.youtube.com/embed/${esc(v.video_id)}" title="${esc(v.title)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div></div>
      <div class="entry-foot">${v.published ? `posted to YouTube @ ${esc(fmtTime(v.published))} | ` : ""}<a href="https://www.youtube.com/watch?v=${esc(v.video_id)}" target="_blank" rel="noopener">watch on YouTube</a></div>
    </div>`;
  }).join("");
  return head + videos;
}

function renderYouTube() {
  return `<h2 class="page-h">${pix("youtube")} YouTube</h2>${renderVideoList(state.youtube, YOUTUBE)}`;
}

// Extra sections on the Old Stuff tab: the old Spotify artist and old YouTube channel
function renderOldExtras() {
  return `<h2 class="date-header">Old music</h2>
    <div class="entry"><h3 class="entry-title">Calvin Kingston on Spotify</h3>${embedHtml(OLD_SPOTIFY)}
      <div class="entry-foot"><a href="${OLD_SPOTIFY}" target="_blank" rel="noopener">open in Spotify</a></div></div>
    <h2 class="date-header">Old YouTube</h2>
    ${renderVideoList(state.oldYoutube, OLD_YOUTUBE)}`;
}

function renderFeed() {
  const cat = currentCategory();
  const head = cat ? `<h2 class="page-h">${pix(cat)} ${CATS[cat]}</h2>` : "";
  let lastDay = "";
  const posts = state.posts.map((p) => {
    const day = fmtDay(p.created_at);
    const dh = day !== lastDay ? `<h2 class="date-header">${esc(day)}</h2>` : "";
    lastDay = day;
    return dh + renderPost(p);
  }).join("");
  const empty = !state.posts.length && !state.loadingPosts && cat !== "old"
    ? `<div class="entry"><div class="empty">${cat ? `Nothing in ${CATS[cat]} yet. Check back soon!` : "No entries yet."}</div></div>` : "";
  const more = !state.postsDone && state.posts.length ? `<div class="center"><button class="btn load-more" onclick="loadMore()">« Older Entries</button></div>` : "";
  const pinned = cat && state.pinned.length ? `<div class="pinned"><div class="pinned-t">${pix("pin")} Pinned</div>
    <div class="pinned-grid">${state.pinned.map((p) => renderPost(p)).join("")}</div></div>` : "";
  if (cat === "old") return `${head}<p class="page-sub muted">The archive: older music, videos and posts.</p>${pinned}${renderComposer()}${posts}${more}${renderOldExtras()}`;
  return `${head}${pinned}${renderComposer()}${posts}${pinned && !state.posts.length ? "" : empty}${more}`;
}

function renderAlbum(p, media) {
  const multi = media.length > 1;
  const slides = media.map((u) => `<div class="slide">${isVideo(u)
    ? `<video src="${esc(src(u))}" controls playsinline preload="metadata"></video>`
    : `<img src="${esc(src(u))}" alt="" loading="lazy" onclick="event.stopPropagation();openViewer('${esc(src(u))}')" title="Click to enlarge">`}</div>`).join("");
  return `<div class="album ${multi ? "multi" : ""}">
    <div class="album-frame"><div class="carousel" onscroll="carouselScroll(this)">${slides}</div></div>
    ${multi ? `<div class="album-nav"><button class="btn btn-sm" onclick="albumStep(this, -1)">« prev</button>
      <span>picture <b class="slide-count">1</b> of ${media.length}</span>
      <button class="btn btn-sm" onclick="albumStep(this, 1)">next »</button></div>` : ""}
  </div>`;
}

const isAudio = (u) => /\.(mp3|m4a|aac|wav|ogg|oga|flac|aif|aiff)(\?|$)/i.test(u);
function trackTitles(p) { try { const t = JSON.parse(p.tracks || "[]"); return Array.isArray(t) ? t : []; } catch { return []; } }

// "JoshAmp": a little Winamp-style player for music posts
function renderPlayer(p, audio, cover) {
  const titles = trackTitles(p);
  const tracks = audio.map((u, i) => ({ src: src(u), title: titles[i] || (audio.length === 1 && p.title) || `Track ${i + 1}` }));
  return `<div class="amp" data-tracks="${esc(JSON.stringify(tracks))}" data-i="0">
    <div class="amp-bar"><span>JOSHAMP</span></div>
    <div class="amp-body">
      <div class="amp-cover">${cover ? `<img src="${esc(src(cover))}" alt="Cover" onclick="openViewer('${esc(src(cover))}')">` : `<span class="amp-cd"></span>`}</div>
      <div class="amp-main">
        <div class="amp-lcd">
          <div class="amp-row"><span class="amp-state">■</span><span class="amp-time">00:00</span>
            <span class="amp-viz">${"<i></i>".repeat(9)}</span></div>
          <div class="amp-ticker"><span>1. ${esc(tracks[0].title)}</span></div>
        </div>
        <input class="amp-seek" type="range" min="0" max="1000" value="0" aria-label="Seek" oninput="ampSeek(this)">
        <div class="amp-ctrls">
          <button class="amp-btn" onclick="ampStep(this, -1)" aria-label="Previous track">|◀</button>
          <button class="amp-btn" onclick="ampPlay(this)" aria-label="Play">▶</button>
          <button class="amp-btn" onclick="ampPause(this)" aria-label="Pause">❚❚</button>
          <button class="amp-btn" onclick="ampStop(this)" aria-label="Stop">■</button>
          <button class="amp-btn" onclick="ampStep(this, 1)" aria-label="Next track">▶|</button>
          <input class="amp-vol" type="range" min="0" max="100" value="80" aria-label="Volume" oninput="ampVol(this)">
        </div>
      </div>
    </div>
    ${tracks.length > 1 ? `<ol class="amp-list">${tracks.map((t, i) => `<li class="${i ? "" : "on"}" onclick="ampTrack(this, ${i})"><span>${i + 1}. ${esc(t.title)}</span><span class="d"></span></li>`).join("")}</ol>` : ""}
    <audio preload="metadata" src="${esc(tracks[0].src)}"></audio>
  </div>`;
}
const ampOf = (el) => el.closest(".amp");
function ampTracks(root) { try { return JSON.parse(root.dataset.tracks); } catch { return []; } }
function ampLoad(root, i) {
  const tracks = ampTracks(root);
  i = (i + tracks.length) % tracks.length;
  root.dataset.i = i;
  const a = root.querySelector("audio");
  a.src = tracks[i].src;
  root.querySelector(".amp-ticker span").textContent = `${i + 1}. ${tracks[i].title}`;
  root.querySelectorAll(".amp-list li").forEach((li, j) => li.classList.toggle("on", j === i));
  root.querySelector(".amp-seek").value = 0;
  root.querySelector(".amp-time").textContent = "00:00";
}
function ampPlay(btn) {
  const root = ampOf(btn), a = root.querySelector("audio");
  document.querySelectorAll(".amp audio").forEach((o) => { if (o !== a) o.pause(); });
  a.play().catch(() => toast("Couldn't play this track"));
}
function ampPause(btn) { ampOf(btn).querySelector("audio").pause(); }
function ampStop(btn) { const a = ampOf(btn).querySelector("audio"); a.pause(); a.currentTime = 0; }
function ampStep(btn, d) { const root = ampOf(btn); ampLoad(root, Number(root.dataset.i) + d); ampPlay(btn); }
function ampTrack(li, i) { const root = ampOf(li); ampLoad(root, i); ampPlay(li); }
function ampSeek(r) { const a = ampOf(r).querySelector("audio"); if (a.duration) a.currentTime = (r.value / 1000) * a.duration; }
function ampVol(r) { ampOf(r).querySelector("audio").volume = r.value / 100; }
const mmss = (t) => `${pad2(Math.floor(t / 60))}:${pad2(Math.floor(t % 60))}`;
// Media events don't bubble, so listen in the capture phase for every player on the page
document.addEventListener("timeupdate", (e) => {
  const root = e.target.closest?.(".amp"); if (!root) return;
  const a = e.target;
  root.querySelector(".amp-time").textContent = mmss(a.currentTime);
  if (a.duration && document.activeElement !== root.querySelector(".amp-seek")) root.querySelector(".amp-seek").value = Math.round((a.currentTime / a.duration) * 1000);
}, true);
document.addEventListener("play", (e) => { const r = e.target.closest?.(".amp"); if (r) { r.classList.add("playing"); r.querySelector(".amp-state").textContent = "▶"; } }, true);
document.addEventListener("pause", (e) => { const r = e.target.closest?.(".amp"); if (r) { r.classList.remove("playing"); r.querySelector(".amp-state").textContent = e.target.currentTime ? "❚❚" : "■"; } }, true);
document.addEventListener("loadedmetadata", (e) => {
  const r = e.target.closest?.(".amp"); if (!r) return;
  const d = r.querySelectorAll(".amp-list li .d")[Number(r.dataset.i)];
  if (d && isFinite(e.target.duration)) d.textContent = mmss(e.target.duration);
}, true);
document.addEventListener("ended", (e) => {
  const r = e.target.closest?.(".amp"); if (!r) return;
  const i = Number(r.dataset.i), n = ampTracks(r).length;
  if (i + 1 < n) { ampLoad(r, i + 1); ampPlay(r.querySelector(".amp-btn")); }
  else { ampLoad(r, 0); r.querySelector(".amp-state").textContent = "■"; }
}, true);

function renderPost(p, full = false) {
  const media = mediaList(p).filter((u) => !embedHtml(u));
  const audio = media.filter(isAudio);
  const pics = media.filter((u) => !isAudio(u));
  const embed = firstEmbed(p);
  const cat = p.category ? `<a class="cat-tag cat-${p.category}" href="#/${p.category}">${pix(p.category)}${CATS[p.category]}</a>` : "";
  const title = p.title ? `<h3 class="entry-title"><a href="#/post/${p.id}">${esc(p.title)}</a></h3>` : "";
  const mood = p.mood ? `<div class="meta-line"><b>current mood:</b> <img src="img/mood-${esc(p.mood)}.gif" alt="" width="15" height="15"> ${esc(p.mood)}</div>` : "";
  const music = p.music ? `<div class="meta-line"><b>current music:</b> ♫ ${esc(p.music)}</div>` : "";
  const comments = p.comment_count ? `${p.comment_count} comment${p.comment_count === 1 ? "" : "s"}` : "post a comment";
  return `<article class="entry post" id="p${p.id}">
    <div class="entry-head">${joshPic("sm")}<div class="who">${uicon}<b>${esc(state.config.about?.username || "josh")}</b>
      ${isNew(p.created_at) ? `<img src="img/new.gif" alt="new" class="new">` : ""}${p.pinned ? ap("PINNED", "POST", "ap-pin") : ""}</div>
      ${cat}<button class="link-btn" onclick="postMenu(${p.id})" aria-label="Post options">[options]</button></div>
    ${title}
    ${p.body && !(/^https?:\/\/\S+$/.test(p.body.trim()) && embedHtml(p.body.trim())) ? `<div class="entry-body">${linkify(p.body)}</div>` : ""}
    ${audio.length ? renderPlayer(p, audio, pics[0]) : media.length ? renderAlbum(p, media) : ""}
    ${downloadButton(p)}${embed}
    ${mood || music ? `<div class="meta">${mood}${music}</div>` : ""}
    <div class="entry-foot">posted by <b>Josh</b> @ <a href="#/post/${p.id}">${esc(fmtTime(p.created_at))}</a>
      | <button class="like-btn ${p.liked ? "liked" : ""}" onclick="likePost(${p.id}, this)" aria-label="Like">${heart}<span class="n">${p.like_count || 0}</span></button>
      | ${full ? `<a href="#comments">${comments}</a>` : `<a href="#/post/${p.id}">${comments}</a>`}
      | <button class="link-btn" onclick="sharePost(${p.id})">share</button></div>
  </article>`;
}

function carouselScroll(el) {
  const i = Math.round(el.scrollLeft / el.clientWidth);
  const count = el.closest(".album")?.querySelector(".slide-count");
  if (count) count.textContent = i + 1;
}
function albumStep(btn, dir) {
  const c = btn.closest(".album").querySelector(".carousel");
  const i = Math.round(c.scrollLeft / c.clientWidth) + dir;
  const n = c.children.length;
  c.scrollTo({ left: ((i + n) % n) * c.clientWidth, behavior: "smooth" });
}
function openViewer(url) {
  const name = decodeURIComponent(url.split("/").pop().split("?")[0] || "picture");
  modal(`<h3>${esc(name)} - Picture Viewer</h3>
    <div class="viewer"><img src="${esc(url)}" alt=""></div>
    <div class="win-buttons"><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Open full size</a><button class="btn btn-primary" onclick="closeModal()">Close</button></div>`, "viewer-win");
}

function findPost(id) { return state.post?.id === id ? state.post : state.posts.find((p) => p.id === id) || state.pinned.find((p) => p.id === id); }

async function likePost(id, btn) {
  if (needAccount("give props to posts")) return;
  const r = await api(`/posts/${id}/like`, { method: "POST" });
  [state.post, ...state.posts, ...state.pinned].filter((p) => p?.id === id).forEach((p) => { p.liked = r.liked; p.like_count = r.like_count; });
  btn.classList.toggle("liked", r.liked);
  btn.classList.remove("pop"); void btn.offsetWidth; if (r.liked) btn.classList.add("pop");
  btn.querySelector(".n").textContent = r.like_count || 0;
}

async function sharePost(id) {
  const url = location.origin + location.pathname + "#/post/" + id;
  if (navigator.share) { try { await navigator.share({ url }); return; } catch { return; } }
  try { await navigator.clipboard.writeText(url); toast("Link copied!", true); } catch { prompt("Copy this link:", url); }
}

function postMenu(id) {
  const admin = state.me?.is_admin;
  const p = findPost(id);
  modal(`<h3>Post options</h3>
    <button class="menu-item" onclick="closeModal();sharePost(${id})">${pix("card")} Share link</button>
    <button class="menu-item" onclick="nav('#/post/${id}')">${pix("chats")} Open post &amp; comments</button>
    ${admin && p?.category ? `<button class="menu-item" onclick="pinPost(${id}, ${!p.pinned})">${pix("pin")} ${p.pinned ? "Unpin" : `Pin to the top of ${CATS[p.category]}`}</button>` : ""}
    ${admin ? `<button class="menu-item danger" onclick="deletePost(${id})">${pix("logout")} Delete post</button>` : ""}
    <div class="win-buttons"><button class="btn" onclick="closeModal()">Cancel</button></div>`);
}
async function pinPost(id, pinned) {
  await api(`/posts/${id}/pin`, { method: "POST", body: { pinned } });
  closeModal(); toast(pinned ? "Pinned to the top" : "Unpinned", true);
  if (state.route.name === "post") { await loadPost(id); render(); } else { await Promise.all([loadPosts(true), loadPinned()]); render(); }
}
async function deletePost(id) {
  if (!confirm("Delete this post?")) return;
  await api("/posts/" + id, { method: "DELETE" });
  closeModal(); toast("Post deleted", true);
  await loadRecent();
  if (state.route.name === "post") nav("#/feed"); else { await Promise.all([loadPosts(true), loadPinned()]); render(); }
}

// ---------------------------------------------------------------------------
// Post page + comments (Blogger-style "said...")
// ---------------------------------------------------------------------------
function renderPostPage() {
  if (!state.post) return loading();
  const n = state.comments.length;
  return `<h2 class="date-header">${esc(fmtDay(state.post.created_at))}</h2>
    ${renderPost(state.post, true)}
    <div class="entry comments" id="comments">
      <h4 class="comments-title">${n} Comment${n === 1 ? "" : "s"}:</h4>
      ${renderCommentList()}
    </div>
    ${renderCommentBox()}
    <div class="center"><a href="#/feed">« Back to the front page</a></div>`;
}

function renderCommentList() {
  const list = state.comments;
  if (!list.length) return `<div class="empty">No comments yet${state.me ? " — be the first!" : "."}</div>`;
  const ids = new Set(list.map((c) => c.id));
  const top = list.filter((c) => !c.parent_id || !ids.has(c.parent_id));
  const kids = (id) => list.filter((c) => c.parent_id === id);
  return top.map((c) => `${renderComment(c)}${kids(c.id).length ? `<div class="replies">${kids(c.id).map((k) => renderComment(k)).join("")}</div>` : ""}`).join("");
}

function renderComment(c) {
  const pending = c.image_url && c.image_status === "pending";
  const user = { username: c.username, display_name: c.display_name, avatar_url: c.avatar_url };
  const isJosh = c.username?.toLowerCase() === "josh";
  return `<div class="comment" id="c${c.id}">
    <a href="#/u/${esc(c.username)}" onclick="return !needAccount('see member profiles')">${avatar(user, "md")}</a>
    <div class="body">
      <div class="c-head">${uicon}<a class="c-name" href="#/u/${esc(c.username)}" onclick="return !needAccount('see member profiles')">${esc(c.display_name || c.username)}</a> said...
        ${isJosh ? joshBadge() : badgeHtml(ageBadge(c.user_created_at))} ${pts(c.user_points)}</div>
      ${c.body ? `<div class="c-text">${esc(c.body)}</div>` : ""}
      ${c.gif_url ? `<div class="c-media"><img src="${esc(src(c.gif_url))}" alt="GIF" loading="lazy"></div>` : ""}
      ${c.image_url ? `<div class="c-media"><img src="${esc(src(c.image_url))}" alt="" loading="lazy" onclick="openViewer('${esc(src(c.image_url))}')"></div>` : ""}
      ${pending ? `<div class="pending-note">⏳ Your picture is waiting for Josh's OK — only you can see it for now</div>` : ""}
      <div class="c-actions">${esc(fmtStamp(c.created_at))}
        · <button class="like-btn ${c.liked ? "liked" : ""}" onclick="likeComment(${c.id}, this)" aria-label="Like">${heart}<span class="n">${c.like_count || 0}</span></button>
        · <button class="link-btn" onclick="replyTo(${c.id})">reply</button>
        · <button class="link-btn" onclick="commentMenu(${c.id})">options</button>
      </div>
    </div></div>`;
}

function renderCommentBox() {
  if (!state.me) {
    return `<fieldset class="comment-box"><legend>Post a Comment</legend>
      <p>Get a free screen name to comment, give props and chat with other fans. Members must be 18+.</p>
      <div class="row" style="margin-top:6px"><a class="btn btn-primary" href="#/join">Get a screen name</a><a class="btn" href="#/login">Sign on</a></div></fieldset>`;
  }
  if (state.me.status !== "active") return `<div class="notice warn">Your account is suspended pending review, so you can't comment right now.</div>`;
  const cc = state.cc;
  const replying = cc.replyTo ? state.comments.find((c) => c.id === cc.replyTo) : null;
  return `<fieldset class="comment-box" id="cbox"><legend>${replying ? "Reply" : "Post a Comment"}</legend>
    ${replying ? `<div class="reply-to">Replying to <b>${esc(replying.display_name || replying.username)}</b> <button class="link-btn" onclick="replyTo(null)">[cancel]</button></div>` : ""}
    <div class="muted small">Commenting as ${uicon} <b>${esc(state.me.display_name || state.me.username)}</b></div>
    <textarea class="input" id="cc-text" placeholder="Leave your comment..." maxlength="2000" rows="4"></textarea>
    <div id="cc-attach">${renderAttach()}</div>
    <div class="bar">
      ${state.config.gif_search ? `<button class="btn btn-sm" onclick="toggleGifs('cc')">${pix("youtube")} Add GIF</button>` : ""}
      <label class="btn btn-sm">${pix("art")} Add picture<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none" onchange="attachImage(this)"></label>
      <span style="flex:1"></span>
      <button class="btn btn-primary" id="cc-btn" onclick="submitComment()">Publish Your Comment</button>
    </div>
    <div id="cc-gifs">${cc.gifOpen ? renderGifPanel("cc") : ""}</div>
    <div class="muted small" style="margin-top:6px">Pictures are checked by Josh before anyone else can see them.</div>
  </fieldset>`;
}

function renderAttach() {
  const cc = state.cc;
  if (cc.gif) return `<div class="attach-preview"><img src="${esc(cc.gif.preview || cc.gif.url)}" alt=""><button onclick="clearAttach()" aria-label="Remove">✕</button></div>`;
  if (cc.file) return `<div class="attach-preview"><img src="${cc.file._url}" alt=""><button onclick="clearAttach()" aria-label="Remove">✕</button></div>`;
  return "";
}
function clearAttach() { state.cc.gif = null; state.cc.file = null; document.getElementById("cc-attach").innerHTML = ""; }
function attachImage(input) {
  const f = input.files[0]; input.value = "";
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) return toast("Pictures must be under 8 MB");
  f._url = URL.createObjectURL(f);
  state.cc.file = f; state.cc.gif = null;
  document.getElementById("cc-attach").innerHTML = renderAttach();
}

function replyTo(id) {
  if (id && needAccount("reply")) return;
  const text = document.getElementById("cc-text")?.value || "";
  state.cc.replyTo = id;
  const box = document.getElementById("cbox");
  if (box) {
    const tmp = document.createElement("div"); tmp.innerHTML = renderCommentBox();
    box.replaceWith(tmp.firstElementChild);
    const ta = document.getElementById("cc-text"); ta.value = text;
    if (id) { ta.focus(); ta.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }
}

async function submitComment() {
  const text = document.getElementById("cc-text").value.trim();
  const cc = state.cc;
  if (!text && !cc.gif && !cc.file) return toast("Write something first");
  const btn = document.getElementById("cc-btn"); btn.disabled = true; btn.textContent = "Publishing...";
  const fd = new FormData();
  fd.append("body", text);
  if (cc.replyTo) fd.append("parent_id", cc.replyTo);
  if (cc.gif) fd.append("gif_id", cc.gif.id);
  if (cc.file) fd.append("image", cc.file);
  try {
    const c = await api(`/posts/${state.post.id}/comments`, { method: "POST", form: fd });
    state.cc = { replyTo: null, gif: null, file: null, gifOpen: false };
    if (c.pending_image) toast("Comment posted! Your picture will show up once Josh OKs it.", true);
    await loadPost(state.post.id); await refreshMe();
    render();
    document.getElementById("c" + c.id)?.scrollIntoView({ block: "center" });
  } finally { btn.disabled = false; btn.textContent = "Publish Your Comment"; }
}

async function likeComment(id, btn) {
  if (needAccount("give props to comments")) return;
  const r = await api(`/comments/${id}/like`, { method: "POST" });
  const c = state.comments.find((x) => x.id === id); if (c) { c.liked = r.liked; c.like_count = r.like_count; }
  btn.classList.toggle("liked", r.liked);
  btn.classList.remove("pop"); void btn.offsetWidth; if (r.liked) btn.classList.add("pop");
  btn.querySelector(".n").textContent = r.like_count || 0;
}

function commentMenu(id) {
  const c = state.comments.find((x) => x.id === id) || state.profile?.history?.find((x) => x.id === id);
  const canDelete = state.me && (state.me.is_admin || c?.user_id === state.me.id);
  modal(`<h3>Comment options</h3>
    ${state.me && c?.user_id !== state.me.id ? `<button class="menu-item" onclick="openReport('comment', ${id})">${pix("mod")} Report comment</button>` : ""}
    ${canDelete ? `<button class="menu-item danger" onclick="deleteComment(${id})">${pix("logout")} Delete comment</button>` : ""}
    ${!state.me ? `<button class="menu-item" onclick="needAccount('report comments')">${pix("mod")} Report comment</button>` : ""}
    <div class="win-buttons"><button class="btn" onclick="closeModal()">Cancel</button></div>`);
}
async function deleteComment(id) {
  if (!confirm("Delete this comment?")) return;
  await api("/comments/" + id, { method: "DELETE" });
  closeModal(); toast("Comment deleted", true);
  if (state.route.name === "post") { await loadPost(state.post.id); render(); } else go();
}

// ---------------------------------------------------------------------------
// GIF picker (GIPHY, PG-rated, via the server)
// ---------------------------------------------------------------------------
let gifSearchTimer = null;
function renderGifPanel(target) {
  return `<div class="gif-panel">
    <input class="input" placeholder="Search GIFs..." oninput="searchGifs(this.value, '${target}')" id="gif-q-${target}">
    <div class="gif-grid" id="gif-grid-${target}">${loading()}</div>
    <div class="giphy-attr">Powered by GIPHY</div></div>`;
}
function toggleGifs(target) {
  const holder = document.getElementById(target === "cc" ? "cc-gifs" : "mc-gifs");
  const st = target === "cc" ? state.cc : state.mc;
  st.gifOpen = !st.gifOpen;
  holder.innerHTML = st.gifOpen ? renderGifPanel(target) : "";
  if (st.gifOpen) searchGifs("", target);
}
function searchGifs(q, target) {
  clearTimeout(gifSearchTimer);
  gifSearchTimer = setTimeout(async () => {
    const grid = document.getElementById("gif-grid-" + target);
    if (!grid) return;
    try {
      const gifs = await api("/gifs?q=" + encodeURIComponent(q));
      window._gifs = gifs;
      grid.innerHTML = gifs.map((g, i) => `<img src="${esc(g.preview)}" alt="" loading="lazy" onclick="pickGif(${i}, '${target}')">`).join("")
        || `<div class="muted small">No GIFs found</div>`;
    } catch (e) { grid.innerHTML = `<div class="muted small">${esc(e.message)}</div>`; }
  }, q ? 350 : 0);
}
function pickGif(i, target) {
  const g = window._gifs?.[i]; if (!g) return;
  if (target === "cc") {
    state.cc.gif = g; state.cc.file = null; state.cc.gifOpen = false;
    document.getElementById("cc-attach").innerHTML = renderAttach();
    document.getElementById("cc-gifs").innerHTML = "";
  } else {
    state.mc.gifOpen = false;
    document.getElementById("mc-gifs").innerHTML = "";
    sendMessage(g.id);
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
function openReport(type, id) {
  if (needAccount("report things")) return;
  const reasons = state.config.report_reasons || {};
  modal(`<h3>Report ${type === "user" ? "account" : type}</h3>
    <p class="small" style="margin-bottom:8px">Reports go to Josh. If someone is in immediate danger, contact local emergency services.</p>
    <fieldset><legend>Why are you reporting this?</legend>
    ${Object.entries(reasons).map(([k, v]) => `<label class="pick"><input type="radio" name="rr" value="${k}"> ${esc(v)}</label>`).join("")}</fieldset>
    <textarea class="input" id="rr-details" placeholder="Anything else Josh should know? (optional)" style="margin-top:8px" maxlength="1000"></textarea>
    <div class="form-error" id="rr-err"></div>
    <div class="win-buttons"><button class="btn btn-primary" onclick="sendReport('${type}', ${id})">Send report</button>
    <button class="btn" onclick="closeModal()">Cancel</button></div>`);
}
async function sendReport(type, id) {
  const reason = document.querySelector('input[name="rr"]:checked')?.value;
  if (!reason) { document.getElementById("rr-err").textContent = "Pick a reason"; return; }
  try {
    await api("/reports", { method: "POST", body: { target_type: type, target_id: id, reason, details: document.getElementById("rr-details").value } });
    closeModal(); toast("Thanks — Josh will review it.", true);
  } catch (e) { document.getElementById("rr-err").textContent = e.message; }
}

// ---------------------------------------------------------------------------
// Profiles (a little MySpace)
// ---------------------------------------------------------------------------
function renderProfile() {
  const p = state.profile;
  if (!p) return loading();
  const isMe = p.friend_status === "self";
  const name = esc(p.display_name || p.username);
  let actions = [];
  if (isMe) actions.push(`<a class="act" href="#/settings">${pix("settings")} Edit my profile</a>`);
  else if (p.friend_status === "friends") actions.push(`<button class="act" onclick="openDM(${p.id})">${pix("chats")} Send Message</button>`,
    `<button class="act" onclick="unfriend(${p.id})">${pix("logout")} Remove from Friends</button>`);
  if (p.can_message && p.friend_status !== "friends") actions.unshift(`<button class="act" onclick="openDM(${p.id})">${pix("chats")} Send Message</button>`);
  else if (p.friend_status === "sent") actions.push(`<span class="act muted">${pix("friends")} Friend request sent</span>`);
  else if (p.friend_status === "pending" && p.request_id) actions.push(`<button class="act" onclick="acceptFriend(${p.request_id})">${pix("friends")} Accept friend request</button>`,
    `<button class="act" onclick="rejectFriend(${p.request_id})">${pix("logout")} Decline request</button>`);
  else if (p.friend_status !== "pending") actions.push(`<button class="act" onclick="addFriend(${p.id}, this)">${pix("friends")} Add to Friends</button>`);
  if (!isMe) actions.push(`<button class="act" onclick="openReport('user', ${p.id})">${pix("mod")} Report User</button>`);
  if (state.me?.is_admin && !isMe && !p.is_admin) actions.push(p.status === "active"
    ? `<button class="act danger" onclick="setStatus(${p.id}, 'banned')">${pix("mod")} Ban account</button>`
    : `<button class="act" onclick="setStatus(${p.id}, 'active')">${pix("mod")} Reinstate account</button>`);
  const history = (p.history || []).map((c) => `
    <div class="history-item" onclick="nav('#/post/${c.post_id}')">
      <div class="on">commented on ${c.post_category ? `<span class="cat-${c.post_category}">${CATS[c.post_category]}</span> · ` : ""}“${esc(String(c.post_snippet || "").replace(/https?:\/\/\S*/g, "").trim() || "a post")}” · ${esc(fmtStamp(c.created_at))}</div>
      ${c.body ? `<div class="txt">${esc(c.body)}</div>` : ""}
      ${c.gif_url ? `<img src="${esc(src(c.gif_url))}" alt="GIF" class="h-img">` : ""}
      ${c.image_url ? `<img src="${esc(src(c.image_url))}" alt="" class="h-img">` : ""}
      <div class="muted small">${c.like_count || 0} props</div>
    </div>`).join("");
  return `<h2 class="page-h">${pix("profile")} ${name}'s Profile</h2>
    <div class="profile">
      <div class="p-left">
        <div class="entry p-card">
          <div class="p-name">${name}</div>
          <div class="p-top">${p.is_admin ? joshPic("xl") : avatar(p, "xl")}
            <div class="p-facts">
              <div>@${esc(p.username)}</div>
              <div>${p.is_admin ? joshBadge() : badgeHtml(p.badge)}</div>
              <div>${pts(p.points)}</div>
              <div class="muted">Member since<br>${esc(joined(p.created_at))}</div>
            </div></div>
          ${p.status !== "active" ? `<div class="notice warn">This account is ${esc(p.status)}.</div>` : ""}
          ${isMe && state.me?.avatar_pending ? `<div class="pending-note">⏳ Your new photo is waiting for Josh's OK</div>` : ""}
        </div>
        <div class="contact"><div class="contact-t">Contacting ${name}</div><div class="contact-b">${actions.join("")}</div></div>
        <table class="p-stats"><tr><th>Points</th><td>${p.points || 0}</td></tr><tr><th>Comments</th><td>${p.comment_count || 0}</td></tr><tr><th>Friends</th><td>${p.friends_count || 0}</td></tr></table>
      </div>
      <div class="p-right">
        <div class="p-section"><div class="p-section-t">About ${name}</div><div class="p-section-b">${p.bio ? `<div class="bio">${esc(p.bio)}</div>` : `<span class="muted">${isMe ? "You haven't written anything yet. <a href='#/settings'>Add a bio</a>" : "Nothing here yet."}</span>`}</div></div>
        <div class="p-section"><div class="p-section-t">${name}'s Latest Comments</div><div class="p-section-b">${history || `<span class="muted">No comments yet.</span>`}</div></div>
      </div>
    </div>`;
}

async function reloadProfile() { if (state.profile) { state.profile = await api("/users/" + encodeURIComponent(state.profile.username)); render(); } }
async function addFriend(id, btn) {
  await api(`/friends/request/${id}`, { method: "POST" });
  if (btn) { btn.textContent = "Request sent"; btn.disabled = true; }
  if (state.route.name === "u") await reloadProfile();
}
async function acceptFriend(reqId) {
  await api(`/friends/accept/${reqId}`, { method: "POST" });
  await refreshMe(); toast("Friend added!", true);
  if (state.route.name === "u") await reloadProfile(); else { await loadFriends(); render(); }
}
async function rejectFriend(reqId) {
  await api(`/friends/reject/${reqId}`, { method: "POST" });
  await refreshMe();
  if (state.route.name === "u") await reloadProfile(); else { await loadFriends(); render(); }
}
async function unfriend(id) {
  if (!confirm("Remove this friend?")) return;
  await api(`/friends/${id}`, { method: "DELETE" });
  await reloadProfile();
}
function messageJosh() {
  if (needAccount("message Josh")) return;
  openDM(state.config.about.id);
}
async function openDM(userId) {
  const r = await api(`/chats/direct/${userId}`, { method: "POST" });
  nav("#/chat/" + r.id);
}

// ---------------------------------------------------------------------------
// Friends ("Friend Space")
// ---------------------------------------------------------------------------
function renderFriends() {
  const req = state.requests.received || [];
  const sent = state.requests.sent || [];
  return `<h2 class="page-h">${pix("friends")} Friends</h2>
    <fieldset><legend>Find a friend</legend><input class="input" placeholder="Search people by screen name..." oninput="friendSearch(this.value)">
      <div id="fs-results"></div></fieldset>
    ${req.length ? `<fieldset class="hl"><legend>${pix("friends")} Friend requests (${req.length})</legend>${req.map((r) => `
      <div class="list-item">${avatar(r, "sm")}<div class="grow clickable" onclick="nav('#/u/${esc(r.username)}')"><b>${esc(r.display_name || r.username)}</b> <span class="muted small">@${esc(r.username)}</span></div>
        <button class="btn btn-primary btn-sm" onclick="acceptFriend(${r.request_id})">Accept</button>
        <button class="btn btn-sm" onclick="rejectFriend(${r.request_id})">Decline</button></div>`).join("")}</fieldset>` : ""}
    <div class="entry"><div class="fs-title">${esc(state.me.display_name || state.me.username)}'s Friend Space</div>
      <div class="muted small">${esc(state.me.display_name || state.me.username)} has <b>${state.friends.length}</b> friend${state.friends.length === 1 ? "" : "s"}.</div>
      ${state.friends.length ? `<div class="fs-grid">${state.friends.map((f) => `<div class="fs-cell">
        <a href="#/u/${esc(f.username)}">${esc(f.display_name || f.username)}</a>
        <a href="#/u/${esc(f.username)}">${avatar(f, "lg")}</a>
        <button class="link-btn" onclick="openDM(${f.id})">send IM</button></div>`).join("")}</div>`
      : `<div class="empty">No friends yet. Search above to find people!</div>`}
    </div>
    ${sent.length ? `<fieldset><legend>Sent requests</legend>${sent.map((s) => `<div class="list-item">${avatar(s, "sm")}<div class="grow">@${esc(s.username)}</div><span class="muted small">waiting...</span></div>`).join("")}</fieldset>` : ""}`;
}
let fsTimer = null;
function friendSearch(q) {
  clearTimeout(fsTimer);
  fsTimer = setTimeout(async () => {
    const box = document.getElementById("fs-results"); if (!box) return;
    if (!q.trim()) { box.innerHTML = ""; return; }
    const users = (await api("/users/search?q=" + encodeURIComponent(q))).filter((u) => u.id !== state.me.id);
    const friendIds = new Set(state.friends.map((f) => f.id));
    box.innerHTML = users.map((u) => `<div class="list-item">${avatar(u, "sm")}
      <div class="grow clickable" onclick="nav('#/u/${esc(u.username)}')"><b>${esc(u.display_name || u.username)}</b> <span class="muted small">@${esc(u.username)}</span></div>
      ${friendIds.has(u.id) ? `<span class="muted small">Friends</span>` : `<button class="btn btn-primary btn-sm" onclick="addFriend(${u.id}, this)">Add</button>`}</div>`).join("")
      || `<div class="muted small" style="padding:6px 0">No one found</div>`;
  }, 250);
}

// ---------------------------------------------------------------------------
// Chats: a buddy list and IM windows
// ---------------------------------------------------------------------------
function chatTitle(c) {
  if (c.name) return c.name;
  const others = (c.members || []).filter((m) => m.id !== state.me?.id);
  if (!others.length) return "Just you";
  return others.map((m) => m.display_name || m.username).join(", ");
}
function chatAvatar(c) {
  const others = (c.members || []).filter((m) => m.id !== state.me?.id);
  if (c.is_group && others.length > 1) return `<span class="group-av">${avatar(others[0], "xs")}${avatar(others[1], "xs")}</span>`;
  return avatar(others[0] || {}, "sm");
}
function lastPreview(c) {
  const m = c.last_message; if (!m) return "No messages yet";
  if (m.kind === "system") return m.body;
  const who = m.sender_id === state.me?.id ? "You: " : "";
  return who + (m.body || (m.gif_url ? "[GIF]" : ""));
}

function renderChats() {
  const unread = state.chats.filter((c) => c.unread).length;
  return `<div class="win buddy">
    <div class="win-title"><span>${pix("chats")} Buddy List — ${esc(state.me.username)}</span></div>
    <div class="win-body">
      <div class="buddy-banner">${pix("chats")} <b>Josh's Blog Messenger</b></div>
      <div class="buddy-me">${avatar(state.me, "sm")} <div><b>${esc(state.me.display_name || state.me.username)}</b><br><span class="muted small">${unread ? `${unread} chat${unread > 1 ? "s" : ""} with new messages` : "No new messages"}</span></div></div>
      <div class="buddy-list">
        <div class="buddy-group">▼ Chats (${state.chats.length})</div>
        ${state.chats.map((c) => `<a class="bud ${c.unread ? "unread" : ""}" href="#/chat/${c.id}">${chatAvatar(c)}
          <span class="grow"><span class="t">${esc(chatTitle(c))}${c.is_group ? ` <span class="muted small">(group)</span>` : ""}</span><span class="p">${esc(lastPreview(c))}</span></span>
          <span class="right"><span class="muted small">${c.last_message ? esc(fmtChat(c.last_message.created_at)) : ""}</span>
          ${c.unread ? `<span class="count">${c.unread}</span>` : ""}</span></a>`).join("") || `<div class="empty small">No chats yet. Add friends, then send them an IM!</div>`}
      </div>
      <div class="win-buttons"><button class="btn btn-primary" onclick="newChat()">${pix("chats")} New IM</button><a class="btn" href="#/friends">${pix("friends")} Friends</a></div>
      <div class="notice small">Chats are with friends (and anyone can message Josh). Messages are scanned automatically for rule-breaking content and may be reviewed by Josh. <a href="#/rules">Rules</a></div>
    </div></div>`;
}

async function newChat() {
  const friends = await api("/friends");
  const josh = state.config.about;
  if (josh?.id && josh.id !== state.me.id && !friends.some((f) => f.id === josh.id)) friends.unshift({ ...josh, display_name: (josh.display_name || josh.username) + " (Josh)" });
  if (!friends.length) { toast("Add some friends first"); nav("#/friends"); return; }
  modal(`<h3>New Instant Message</h3><p class="small" style="margin-bottom:6px">Pick one friend for a 1-on-1 IM, or a few for a group chat.</p>
    <fieldset><legend>Friends</legend>
    ${friends.map((f) => `<label class="pick"><input type="checkbox" value="${f.id}" name="nc">${avatar(f, "xs")} ${esc(f.display_name || f.username)}</label>`).join("")}</fieldset>
    <div class="win-buttons"><button class="btn btn-primary" onclick="startChat()">Send IM</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
}
async function startChat() {
  const ids = [...document.querySelectorAll('input[name="nc"]:checked')].map((i) => Number(i.value));
  if (!ids.length) return toast("Pick at least one friend");
  const dm = await api(`/chats/direct/${ids[0]}`, { method: "POST" });
  let id = dm.id;
  if (ids.length > 1) id = (await api(`/chats/${dm.id}/members`, { method: "POST", body: { user_ids: ids.slice(1) } })).id;
  closeModal(); nav("#/chat/" + id);
}

async function loadChat(id) { state.chat = await api("/chats/" + encodeURIComponent(id)); }

function renderChat() {
  const c = state.chat;
  if (!c) return loading();
  const others = c.members.filter((m) => m.id !== state.me.id);
  const sub = c.is_group ? `${c.members.length} people in this chat` : others[0] ? `talking with @${others[0].username}` : "";
  return `<div class="win im">
    <div class="win-title"><span>${esc(chatTitle(c))} - Instant Message</span><button class="win-x" onclick="nav('#/chats')" aria-label="Close">✕</button></div>
    <div class="im-bar">
      <span class="im-who clickable" onclick="${!c.is_group && others[0] ? `nav('#/u/${esc(others[0].username)}')` : "chatInfo()"}">${chatAvatar(c)} <span>${esc(sub)}</span></span>
      <button class="btn btn-sm" onclick="chatInfo()">${pix("friends")} People</button>
    </div>
    <div class="chat-msgs" id="chat-msgs">${renderMessages(c.messages)}</div>
    ${c.can_send && state.me.status === "active" ? `
      <div id="mc-gifs"></div>
      <div class="im-tools">${state.config.gif_search ? `<button class="btn btn-sm" onclick="toggleGifs('mc')">${pix("youtube")} GIF</button>` : ""}<span class="muted small">Enter sends · Shift+Enter for a new line</span></div>
      <div class="chat-input">
        <textarea id="mc-text" placeholder="Type your message here..." maxlength="2000" rows="2" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage()}"></textarea>
        <button class="btn btn-primary send-btn" onclick="sendMessage()">${pix("chats")}<br>Send</button>
      </div>` : `<div class="readonly-note">${esc(c.read_only_reason || "You can't send messages right now.")}</div>`}
  </div>`;
}

function renderMessages(msgs) {
  return msgs.map((m) => {
    if (m.kind === "system") return `<div class="sys">*** ${esc(m.body)} ***</div>`;
    const mine = m.sender_id === state.me.id;
    const who = mine ? (state.me.display_name || state.me.username) : (m.display_name || m.username || "");
    return `<div class="msg ${mine ? "mine" : "theirs"}" data-id="${m.id}">
      <span class="who">${esc(who)}</span> <span class="ts">(${esc(fmtChat(m.created_at))})</span>:
      ${m.body ? `<span class="bubble">${esc(m.body)}</span>` : ""}
      ${m.gif_url ? `<br><img class="gif" src="${esc(src(m.gif_url))}" alt="GIF" loading="lazy">` : ""}
      ${!mine ? ` <button class="report-link" onclick="openReport('message', ${m.id})">[report]</button>` : ""}
    </div>`;
  }).join("") || `<div class="empty">No messages yet. Say hi! :)</div>`;
}

function scrollChatToBottom() { const el = document.getElementById("chat-msgs"); if (el) el.scrollTop = el.scrollHeight; }

async function sendMessage(gifId) {
  const input = document.getElementById("mc-text");
  const body = gifId ? "" : (input?.value || "").trim();
  if (!body && !gifId) return;
  if (input && !gifId) input.value = "";
  try {
    await api(`/chats/${state.chat.id}/messages`, { method: "POST", body: { body, gif_id: gifId || "" } });
  } catch (e) { if (input && !gifId) input.value = body; throw e; }
  await pollChat(true);
}

async function pollChat(forceScroll = false) {
  if (state.route.name !== "chat" || !state.chat) return;
  const el = document.getElementById("chat-msgs");
  const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  const fresh = await api("/chats/" + state.chat.id);
  const changed = fresh.messages.length !== state.chat.messages.length
    || fresh.messages[fresh.messages.length - 1]?.id !== state.chat.messages[state.chat.messages.length - 1]?.id
    || fresh.members.length !== state.chat.members.length || fresh.name !== state.chat.name;
  state.chat = fresh;
  if (changed && el) {
    el.innerHTML = renderMessages(fresh.messages);
    if (atBottom || forceScroll) scrollChatToBottom();
  }
}
function startChatPoll() {
  stopChatPoll();
  state.chatTimer = setInterval(() => { if (!document.hidden) pollChat().catch(() => {}); }, 4000);
}
function stopChatPoll() { if (state.chatTimer) clearInterval(state.chatTimer); state.chatTimer = null; }

function chatInfo() {
  const c = state.chat;
  modal(`<h3>${esc(chatTitle(c))}</h3>
    <fieldset><legend>${c.members.length} ${c.members.length === 1 ? "person" : "people"} in this chat</legend>
    ${c.members.map((m) => `<div class="list-item clickable" onclick="nav('#/u/${esc(m.username)}')">${avatar(m, "sm")}<div class="grow">${esc(m.display_name || m.username)} <span class="muted small">@${esc(m.username)}</span></div></div>`).join("")}</fieldset>
    <div style="margin-top:8px">
      ${c.can_send ? `<button class="menu-item" onclick="addPeople()">${pix("friends")} ${c.is_group ? "Add people" : "Add people (starts a new group chat)"}</button>` : ""}
      ${c.is_group ? `<button class="menu-item" onclick="renameChat()">${pix("settings")} Rename group</button>
        <button class="menu-item danger" onclick="leaveChat()">${pix("logout")} Leave group</button>` : ""}
    </div>
    <div class="win-buttons"><button class="btn" onclick="closeModal()">Close</button></div>`);
}
async function addPeople() {
  const friends = await api("/friends");
  const inChat = new Set(state.chat.members.map((m) => m.id));
  const options = friends.filter((f) => !inChat.has(f.id));
  if (!options.length) { toast("All your friends are already here"); return; }
  modal(`<h3>Add people</h3>
    ${!state.chat.is_group ? `<p class="small" style="margin-bottom:6px">This starts a new group chat. Your 1-on-1 messages stay private.</p>` : ""}
    <fieldset><legend>Friends</legend>
    ${options.map((f) => `<label class="pick"><input type="checkbox" value="${f.id}" name="ap">${avatar(f, "xs")} ${esc(f.display_name || f.username)}</label>`).join("")}</fieldset>
    <div class="win-buttons"><button class="btn btn-primary" onclick="confirmAddPeople()">Add</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
}
async function confirmAddPeople() {
  const ids = [...document.querySelectorAll('input[name="ap"]:checked')].map((i) => Number(i.value));
  if (!ids.length) return toast("Pick at least one friend");
  const r = await api(`/chats/${state.chat.id}/members`, { method: "POST", body: { user_ids: ids } });
  closeModal();
  if (r.id !== state.chat.id) nav("#/chat/" + r.id); else { await pollChat(true); }
}
async function renameChat() {
  const name = prompt("Group name", state.chat.name || "");
  if (name === null) return;
  await api(`/chats/${state.chat.id}`, { method: "PUT", body: { name } });
  closeModal(); await pollChat(true); render(); scrollChatToBottom();
}
async function leaveChat() {
  if (!confirm("Leave this group?")) return;
  await api(`/chats/${state.chat.id}/leave`, { method: "POST" });
  closeModal(); nav("#/chats");
}

// ---------------------------------------------------------------------------
// Settings, rules, sign on
// ---------------------------------------------------------------------------
function renderSettings() {
  const me = state.me;
  const p = state.config.points || {};
  return `<h2 class="page-h">${pix("settings")} Settings</h2>
    <form onsubmit="saveProfile(event)"><fieldset><legend>My profile</legend>
        <div class="field"><label>Display name</label><input class="input" name="display_name" value="${esc(me.display_name || "")}" maxlength="50"></div>
        <div class="field"><label>About me</label><textarea class="input" name="bio" maxlength="300" rows="3">${esc(me.bio || "")}</textarea></div>
        <div class="field"><label>Profile picture</label>
          <div class="row">${avatar(me, "lg")}<input type="file" name="avatar" accept="image/jpeg,image/png,image/webp"></div>
          <div class="muted small" style="margin-top:4px">${me.avatar_pending ? "⏳ Your new picture is waiting for Josh's OK." : "New pictures are checked by Josh before they show up."}</div></div>
        <button class="btn btn-primary" type="submit" id="sp-btn">Save Changes</button>
    </fieldset></form>
    <fieldset><legend>★ My points: ${me.points || 0}</legend>
      <p class="small">You earn points for being part of the community (daily limits apply):</p>
      <ul class="stars small">
        <li>Visiting: ${p.visit?.amount ?? 1} per day</li>
        <li>Commenting: ${p.comment?.amount ?? 2} each (first ${p.comment?.dailyCap ?? 10} a day)</li>
        <li>Giving props to posts and comments: ${p.like_given?.amount ?? 1} each (first ${p.like_given?.dailyCap ?? 10} a day)</li>
        <li>Getting props on your comments: ${p.like_received?.amount ?? 1} each</li>
        <li>Getting replies: ${p.reply_received?.amount ?? 1} each</li>
      </ul></fieldset>
    <fieldset><legend>Other stuff</legend><a href="#/rules">Community rules &amp; safety</a></fieldset>
    <button class="btn btn-danger" onclick="doLogout()">${pix("logout")} Log out</button>`;
}
async function saveProfile(e) {
  e.preventDefault();
  const f = e.target; const btn = document.getElementById("sp-btn");
  const fd = new FormData();
  fd.append("display_name", f.display_name.value); fd.append("bio", f.bio.value);
  if (f.avatar.files[0]) fd.append("avatar", f.avatar.files[0]);
  btn.disabled = true; btn.textContent = "Saving...";
  try {
    const r = await api("/profile", { method: "PUT", form: fd });
    state.me = await api("/auth/me");
    toast(r.avatar_pending ? "Saved! Your new picture will show up once Josh OKs it." : "Saved!", true);
    render();
  } finally { btn.disabled = false; btn.textContent = "Save Changes"; }
}

function renderRules() {
  return `<h2 class="page-h">${pix("rules")} Community Rules</h2>
  <div class="entry rules">
    <p>Josh's Blog is a place for fans to talk about Josh's software, art and music. Keep it kind and keep it legal.</p>
    <h2>Who can join</h2>
    <ul class="stars"><li>You must be 18 or older. Accounts that appear to belong to minors are removed.</li><li>One account per person. No impersonation.</li></ul>
    <h2>Not allowed</h2>
    <ul class="stars">
      <li>Anything illegal: drugs, weapons, scams, stolen goods, or any other illegal activity.</li>
      <li>Anything sexual involving minors — ever. This is reported to the National Center for Missing &amp; Exploited Children (NCMEC) as required by US law.</li>
      <li>Nudity or sexual content.</li>
      <li>Harassment, threats, hate speech or slurs.</li>
      <li>Spam, or pushing people to other apps or payment apps.</li>
      <li>Sharing someone's private information.</li>
    </ul>
    <h2>How the site is monitored</h2>
    <ul class="stars">
      <li>Comments, chat messages, names and bios are checked automatically when sent. Slurs are blocked.</li>
      <li>Messages that look like moving people off the site, exchanging money, or involving minors are flagged for review. Josh can read flagged and reported chats.</li>
      <li>Images and uploaded GIFs are hidden until Josh approves them. GIF search only shows PG-rated GIPHY results.</li>
      <li>Breaking the rules can get content removed and accounts suspended or banned.</li>
    </ul>
    <h2>Reporting</h2>
    <p>Use the Report option on any comment, message or profile. If someone is in danger, contact local emergency services. To report child sexual exploitation directly, use NCMEC's CyberTipline at <a href="https://report.cybertip.org" target="_blank" rel="noopener">report.cybertip.org</a>.</p>
  </div>`;
}

function renderAuth(mode) {
  if (state.me) return `<div class="entry"><div class="empty">You're signed on as <b>@${esc(state.me.username)}</b>. <a href="#/feed">Go to the front page</a></div></div>`;
  if (mode === "join") return `<div class="win signon">
    <div class="win-title"><span>${pix("login")} Get a Screen Name</span></div>
    <div class="win-body">
      <div class="signon-art"><span>Josh's Blog</span></div>
      <p class="small">Comment, give props, add friends and chat. Only Josh posts; everyone can talk.</p>
      <form onsubmit="doJoin(event)">
        <div class="field"><label>Screen name (letters, numbers, _)</label><input class="input" name="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" autocomplete="username"></div>
        <div class="field"><label>Password (8+ characters)</label><input class="input" name="password" type="password" required minlength="8" autocomplete="new-password"></div>
        <label class="check"><input type="checkbox" name="age" required> I confirm I am 18 years of age or older.</label>
        <label class="check"><input type="checkbox" name="terms" required> I agree to the <a href="#/rules" target="_blank">community rules</a>, including that messages are automatically scanned and may be reviewed.</label>
        <div class="win-buttons"><button class="btn btn-primary" type="submit">Create my account</button></div>
        <div class="form-error"></div>
      </form>
      <p class="small center">Already have one? <a href="#/login">Sign on</a></p>
    </div></div>`;
  return `<div class="win signon">
    <div class="win-title"><span>${pix("login")} Sign On</span></div>
    <div class="win-body">
      <div class="signon-art"><span>Josh's Blog</span></div>
      <form onsubmit="doLogin(event)">
        <div class="field"><label>Screen name</label><input class="input" name="username" required autocomplete="username"></div>
        <div class="field"><label>Password</label><input class="input" name="password" type="password" required autocomplete="current-password"></div>
        <div class="win-buttons"><button class="btn btn-primary" type="submit">Sign On</button></div>
        <div class="form-error"></div>
      </form>
      <p class="small center"><a href="#/join">Get a screen name</a> · or just <a href="#/feed">look around as a guest</a></p>
    </div></div>`;
}

function openConfirm() {
  modal(`<h3>Quick check</h3>
    <p class="small" style="margin-bottom:8px">Josh's Blog is now 18+ with community rules. Please confirm to keep commenting and chatting.</p>
    <label class="check"><input type="checkbox" id="cf-age"> I confirm I am 18 years of age or older.</label>
    <label class="check"><input type="checkbox" id="cf-terms"> I agree to the <a href="#/rules" onclick="closeModal()">community rules</a>, including that messages are automatically scanned and may be reviewed.</label>
    <div class="form-error" id="cf-err"></div>
    <div class="win-buttons"><button class="btn btn-primary" onclick="sendConfirm()">Continue</button></div>`);
}
async function sendConfirm() {
  const age = document.getElementById("cf-age").checked, terms = document.getElementById("cf-terms").checked;
  if (!age || !terms) { document.getElementById("cf-err").textContent = "Please check both boxes"; return; }
  state.me = await api("/auth/confirm", { method: "POST", body: { age_confirmed: true, terms_accepted: true } });
  closeModal(); toast("Thanks!", true); render();
}

async function afterAuth(data) {
  state.token = data.token; safeSet("token", data.token);
  state.me = data.user;
  nav("#/feed");
}
async function doJoin(e) {
  e.preventDefault();
  const f = e.target; const err = f.querySelector(".form-error");
  try {
    await afterAuth(await api("/auth/register", { method: "POST", body: {
      username: f.username.value.trim(), password: f.password.value,
      age_confirmed: f.age.checked, terms_accepted: f.terms.checked } }));
  } catch (x) { err.textContent = x.message; }
}
async function doLogin(e) {
  e.preventDefault();
  const f = e.target; const err = f.querySelector(".form-error");
  try {
    await afterAuth(await api("/auth/login", { method: "POST", body: { username: f.username.value.trim(), password: f.password.value } }));
  } catch (x) { err.textContent = x.message; }
}
function doLogout() {
  api("/auth/logout", { method: "POST" }).catch(() => {});
  closeModal(); logoutLocal(); nav("#/feed");
}

// ---------------------------------------------------------------------------
// Moderation (Josh only)
// ---------------------------------------------------------------------------
function flagsHtml(cats, severe) {
  return String(cats || "").split(",").filter(Boolean).map((c) => `<span class="flag ${severe ? "severe" : ""}">${esc(c)}</span>`).join("");
}
function renderMod() {
  const q = state.mod;
  if (!q) return loading();
  const severe = q.events.filter((e) => e.severe);
  const mode = state.me.moderation_mode === "ai+rules" ? "AI + rules" : "rules only (free)";
  const section = (title, n, body) => `<fieldset><legend>${title} (${n})</legend>${n ? body : `<div class="muted small">Nothing here.</div>`}</fieldset>`;
  return `<h2 class="page-h">${pix("mod")} Moderation</h2>
    <div class="notice">Automatic checks: <b>${mode}</b>. Images and uploaded GIFs wait for your approval.</div>
    ${severe.length ? `<div class="notice danger"><b>${severe.length} child-safety alert${severe.length > 1 ? "s" : ""}.</b> The account was suspended automatically. If it's apparent child sexual abuse material, US law requires reporting it to NCMEC's CyberTipline (report.cybertip.org).</div>` : ""}

    ${section("Reports", q.reports.length, q.reports.map((r) => `<div class="mod-item">
      <div><span class="flag ${r.reason === "child-safety" ? "severe" : ""}">${esc(r.reason_label)}</span>
        <span class="muted small">${esc(r.target_type)} · reported by @${esc(r.reporter)} · ${timeAgo(r.created_at)}</span></div>
      ${r.target ? `<div class="small" style="margin-top:4px">By <a href="#/u/${esc(r.target.author)}">@${esc(r.target.author || "?")}</a>${r.target.removed ? " · <span class='muted'>already removed</span>" : ""}</div>
        ${r.target.text ? `<div class="quote">${esc(r.target.text)}</div>` : ""}
        ${r.target.gif_url || r.target.image_url ? `<img class="mod-img" src="${esc(src(r.target.image_url || r.target.gif_url))}" alt="">` : ""}` : `<div class="muted small">Content no longer exists.</div>`}
      ${r.details ? `<div class="muted small">Note: ${esc(r.details)}</div>` : ""}
      <div class="actions">
        ${r.target?.post_id ? `<a class="btn btn-sm" href="#/post/${r.target.post_id}">Open post</a>` : ""}
        ${r.target?.chat_id ? `<button class="btn btn-sm" onclick="modViewChat(${r.target.chat_id})">Read chat</button>` : ""}
        ${r.target_type !== "user" ? `<button class="btn btn-sm" onclick="modResolve(${r.id}, true, false)">Remove</button>` : ""}
        <button class="btn btn-danger btn-sm" onclick="modResolve(${r.id}, ${r.target_type !== "user"}, true)">${r.target_type !== "user" ? "Remove + ban" : "Ban"}</button>
        <button class="btn btn-sm" onclick="modResolve(${r.id}, false, false)">Dismiss</button>
      </div></div>`).join(""))}

    ${section("Pictures waiting for approval", q.images.comments.length + q.images.avatars.length,
      q.images.comments.map((c) => `<div class="mod-item"><div class="small">Comment by <a href="#/u/${esc(c.username)}">@${esc(c.username)}</a> · ${timeAgo(c.created_at)}</div>
        <img class="mod-img" src="${esc(src(c.image_url))}" alt="">${c.body ? `<div class="quote">${esc(c.body)}</div>` : ""}
        <div class="actions"><button class="btn btn-primary btn-sm" onclick="modImage('comment', ${c.id}, true)">Approve</button>
        <button class="btn btn-danger btn-sm" onclick="modImage('comment', ${c.id}, false)">Reject</button>
        <a class="btn btn-sm" href="#/post/${c.post_id}">Open post</a></div></div>`).join("")
      + q.images.avatars.map((a) => `<div class="mod-item"><div class="small">Profile picture for <a href="#/u/${esc(a.username)}">@${esc(a.username)}</a></div>
        <img class="mod-img" src="${esc(src(a.image_url))}" alt="" style="width:120px;height:120px;object-fit:cover">
        <div class="actions"><button class="btn btn-primary btn-sm" onclick="modImage('avatar', ${a.user_id}, true)">Approve</button>
        <button class="btn btn-danger btn-sm" onclick="modImage('avatar', ${a.user_id}, false)">Reject</button></div></div>`).join(""))}

    ${section("Flagged chats", q.chats.length, q.chats.map((c) => `<div class="mod-item">
      <div class="small"><b>${esc(c.name || (c.is_group ? "Group chat" : "DM"))}</b> · ${esc(c.members.map((m) => "@" + m).join(", "))} · ${c.flagged_messages} flagged message${c.flagged_messages === 1 ? "" : "s"}</div>
      <div class="actions"><button class="btn btn-sm" onclick="modViewChat(${c.id})">Read chat</button>
      <button class="btn btn-sm" onclick="modClearChat(${c.id})">Looks fine — clear</button></div></div>`).join(""))}

    ${section("Automatic flags &amp; blocks", q.events.length, q.events.map((e) => `<div class="mod-item">
      <div>${flagsHtml(e.categories, e.severe)} <span class="muted small">${esc(e.action)} · ${esc(e.content_type)} · ${timeAgo(e.created_at)}</span></div>
      <div class="small">By ${e.username ? `<a href="#/u/${esc(e.username)}">@${esc(e.username)}</a>` : "unknown"}${e.user_status && e.user_status !== "active" ? ` · <span class="muted">${esc(e.user_status)}</span>` : ""}</div>
      ${e.text ? `<div class="quote">${esc(e.text)}</div>` : ""}
      <div class="actions">
        ${/^chat:(\d+)/.test(e.context) ? `<button class="btn btn-sm" onclick="modViewChat(${e.context.match(/^chat:(\d+)/)[1]})">Read chat</button>` : ""}
        ${/^post:(\d+)/.test(e.context) ? `<a class="btn btn-sm" href="#/post/${e.context.match(/^post:(\d+)/)[1]}">Open post</a>` : ""}
        ${e.user_id && e.user_status === "active" ? `<button class="btn btn-danger btn-sm" onclick="setStatus(${e.user_id}, 'banned')">Ban user</button>` : ""}
        ${e.user_id && e.user_status === "suspended" ? `<button class="btn btn-sm" onclick="setStatus(${e.user_id}, 'active')">Reinstate</button><button class="btn btn-danger btn-sm" onclick="setStatus(${e.user_id}, 'banned')">Ban</button>` : ""}
        <button class="btn btn-sm" onclick="modEvent(${e.id})">Mark reviewed</button>
      </div></div>`).join(""))}

    ${section("Suspended &amp; banned accounts", q.accounts.length, q.accounts.map((a) => `<div class="mod-item row between">
      <div class="small"><a href="#/u/${esc(a.username)}">@${esc(a.username)}</a> · ${esc(a.status)}${a.status_reason ? ` · <span class="muted">${esc(a.status_reason)}</span>` : ""}</div>
      <div class="actions" style="margin:0">${a.status !== "banned" ? `<button class="btn btn-danger btn-sm" onclick="setStatus(${a.id}, 'banned')">Ban</button>` : ""}
      <button class="btn btn-sm" onclick="setStatus(${a.id}, 'active')">Reinstate</button></div></div>`).join(""))}`;
}
async function reloadMod() { state.mod = await api("/mod/queue"); await refreshMe(); render(); }
async function modResolve(id, remove, ban) {
  if (ban && !confirm("Ban this user? They'll be logged out and can't log back in.")) return;
  await api(`/mod/reports/${id}/resolve`, { method: "POST", body: { remove_content: remove, ban_user: ban } });
  toast("Done", true); await reloadMod();
}
async function modImage(kind, id, approve) {
  await api(`/mod/images/${kind}/${id}`, { method: "POST", body: { approve } });
  await reloadMod();
}
async function modEvent(id) { await api(`/mod/events/${id}/resolve`, { method: "POST" }); await reloadMod(); }
async function modClearChat(id) { await api(`/mod/chats/${id}/clear`, { method: "POST" }); closeModal(); await reloadMod(); }
async function setStatus(userId, status) {
  if (status === "banned" && !confirm("Ban this account?")) return;
  await api(`/mod/users/${userId}/status`, { method: "POST", body: { status } });
  toast(status === "banned" ? "Banned" : "Reinstated", true);
  if (state.route.name === "mod") await reloadMod(); else await reloadProfile();
}
async function modViewChat(id) {
  const c = await api("/mod/chats/" + id);
  modal(`<h3>${esc(c.name || (c.is_group ? "Group chat" : "DM"))}</h3>
    <div class="muted small" style="margin-bottom:8px">${c.members.map((m) => `@${esc(m.username)}${m.left_at ? " (left)" : ""}`).join(", ")}</div>
    <div class="mod-log">${c.messages.map((m) => m.kind === "system"
      ? `<div class="sys">*** ${esc(m.body)} ***</div>`
      : `<div class="mod-item"><div class="small"><b>@${esc(m.username || "?")}</b> <span class="muted">${timeAgo(m.created_at)}</span> ${flagsHtml(m.flags)} ${m.status !== "visible" ? "<span class='muted'>(removed)</span>" : ""}</div>
        ${m.body ? `<div class="small" style="white-space:pre-wrap">${esc(m.body)}</div>` : ""}${m.gif_url ? `<img src="${esc(src(m.gif_url))}" style="max-width:120px">` : ""}
        ${m.status === "visible" ? `<button class="link-btn small" onclick="modRemoveMsg(${m.id}, ${c.id})">[remove]</button>` : ""}</div>`).join("")}</div>
    <div class="win-buttons">${c.flagged ? `<button class="btn btn-sm" onclick="modClearChat(${c.id})">Clear flag</button>` : ""}
    <button class="btn btn-sm" onclick="closeModal()">Close</button></div>`);
}
async function modRemoveMsg(id, chatId) { await api(`/mod/messages/${id}/remove`, { method: "POST" }); await modViewChat(chatId); }

// ---------------------------------------------------------------------------
// Cursor sparkle trail (desktop mouse only, can be switched off in the footer)
// ---------------------------------------------------------------------------
function sparklesOn() { return safeGet("sparkles") === "on"; }
function toggleSparkles() { safeSet("sparkles", sparklesOn() ? "off" : "on"); render(); }
(function sparkleTrail() {
  if (!window.matchMedia?.("(pointer: fine)").matches) return;
  let last = 0, alive = 0;
  document.addEventListener("mousemove", (e) => {
    if (!sparklesOn() || alive > 14) return;
    const now = performance.now();
    if (now - last < 45) return;
    last = now; alive++;
    const s = document.createElement("img");
    s.src = Math.random() < 0.3 ? "img/sparkle-big.gif" : "img/sparkle.gif";
    s.className = "trail"; s.alt = "";
    s.style.left = e.pageX + (Math.random() * 10 - 5) + "px";
    s.style.top = e.pageY + (Math.random() * 10 - 2) + "px";
    document.body.appendChild(s);
    setTimeout(() => { s.remove(); alive--; }, 800);
  });
})();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  try { state.config = { ...state.config, ...(await api("/config")) }; } catch {}
  await Promise.all([refreshMe(), loadRecent()]);
  await go();
  if (state.me && !state.me.confirmed) openConfirm();
  // Hit counter (the server counts each visitor once a day)
  api("/hits", { method: "POST" }).then((r) => {
    state.hits = r.count;
    document.querySelectorAll(".odo-wrap").forEach((el) => { el.innerHTML = `you are visitor #<br>${odometer(state.hits)}`; });
  }).catch(() => {});
})();
