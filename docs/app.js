// =========================================================================
// Josh's Blog — single-page app (no build step)
// =========================================================================
const API = window.JOSH_API || "https://josh-card-production.up.railway.app";
const CATS = { software: "Software", art: "Art", music: "Music" };
const PAGE = 20;

const state = {
  token: safeGet("token"),
  me: null,
  config: { categories: Object.keys(CATS), gif_search: false, report_reasons: {}, points: {} },
  route: { name: "feed", params: [] },
  posts: [], postsKey: "", postsDone: false, loadingPosts: false,
  post: null, comments: [],
  profile: null,
  friends: [], requests: { received: [], sent: [] },
  chats: [], chat: null, chatTimer: null,
  mod: null,
  cc: { replyTo: null, gif: null, file: null, gifOpen: false },   // comment composer
  pc: { files: [] },                                               // admin post composer
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
function timeAgo(d) {
  const t = parseDate(d); if (!t) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  if (s < 604800) return Math.floor(s / 86400) + "d";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
function joined(d) {
  const t = parseDate(d);
  return t ? new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";
}
function ageBadge(createdAt) {
  const t = parseDate(createdAt); const days = t ? Math.floor((Date.now() - t) / 86400000) : 0;
  if (days < 7) return "New";
  if (days < 30) return "1 week"; if (days < 90) return "1 month"; if (days < 180) return "3 months"; if (days < 365) return "6 months";
  const y = Math.floor(days / 365); return y === 1 ? "1 year" : `${y} years`;
}
function badgeHtml(label) { return `<span class="badge ${label === "New" ? "new" : "age"}" title="Account age">${esc(label)}</span>`; }
function initial(n) { return (String(n || "?").trim()[0] || "?").toUpperCase(); }
function avatar(u, cls = "") {
  const url = src(u?.avatar_url);
  if (url) return `<div class="avatar ${cls}"><img src="${esc(url)}" alt="" loading="lazy"></div>`;
  return `<div class="avatar ${cls}">${esc(initial(u?.display_name || u?.username))}</div>`;
}
function joshAvatar(cls = "") { return `<div class="avatar josh ${cls}">J</div>`; }

const ICON = {
  home: '<path d="M3 10l9-7 9 7v10a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  art: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 000 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0022 9.8C22 5.5 17.5 2 12 2z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  chat: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 000-7.8z"/>',
  comment: '<path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.6 8.6 0 01-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 1121 11.5z"/>',
  share: '<path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  back: '<polyline points="15 18 9 12 15 6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5z"/><path d="M4 19.5V21h16"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
};
const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24">${ICON[name] || ""}</svg>`;
const gifIcon = '<span style="font-weight:800;font-size:0.72rem;border:1.6px solid currentColor;border-radius:4px;padding:0 3px;line-height:1.3">GIF</span>';

function toast(msg, ok = false) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast" + (ok ? " ok" : "");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
window.addEventListener("unhandledrejection", (e) => {
  const err = e.reason;
  if (err?.status === 401 && state.token) { logoutLocal(); toast("Please log in again"); return; }
  if (err?.code === "confirm_required") { openConfirm(); return; }
  toast(err?.message || "Something went wrong");
});

function modal(html) {
  closeModal();
  const back = document.createElement("div");
  back.className = "modal-back";
  back.id = "modal";
  back.innerHTML = `<div class="modal" role="dialog">${html}</div>`;
  back.addEventListener("click", (e) => { if (e.target === back) closeModal(); });
  document.body.appendChild(back);
}
function closeModal() { document.getElementById("modal")?.remove(); }

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

function logoutLocal() {
  state.token = null; state.me = null; safeSet("token", null);
  stopChatPoll();
  render();
}

function needAccount(what = "do that") {
  if (state.me) return false;
  modal(`<h3>Join Josh's Blog</h3>
    <p class="muted" style="margin-bottom:1rem">You need an account to ${esc(what)}. It's free, and members must be 18 or older.</p>
    <div class="row"><a class="btn btn-primary" style="flex:1" href="#/join" onclick="closeModal()">Join</a>
    <a class="btn btn-ghost" style="flex:1" href="#/login" onclick="closeModal()">Log in</a></div>`);
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
    if (["feed", ...Object.keys(CATS)].includes(name)) await loadPosts(true);
    if (name === "post") await loadPost(params[0]);
    if (name === "u") { state.profile = null; render(); state.profile = await api("/users/" + encodeURIComponent(params[0])); }
    if (name === "friends") await loadFriends();
    if (name === "chats") state.chats = await api("/chats");
    if (name === "chat") { state.chat = null; render(); await loadChat(params[0]); startChatPoll(); }
    if (name === "mod") state.mod = await api("/mod/queue");
  } catch (e) {
    if (e.status === 404) { render(`<div class="empty">That page doesn't exist anymore.</div>`); return; }
    toast(e.message);
  }
  render();
  window.scrollTo(0, 0);
  if (name === "chat") scrollChatToBottom();
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
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
function navItems() {
  return [
    { key: "feed", label: "Feed", icon: "home", href: "#/feed" },
    { key: "software", label: "Software", icon: "code", href: "#/software" },
    { key: "art", label: "Art", icon: "art", href: "#/art" },
    { key: "music", label: "Music", icon: "music", href: "#/music" },
    { key: "chats", label: "Chats", icon: "chat", href: "#/chats", badge: "unread_chats" },
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

function renderSidebar() {
  const a = activeKey();
  const me = state.me;
  const main = navItems().map((n) => `
    <a class="nav-item ${a === n.key ? "active" : ""}" href="${n.href}">${icon(n.icon)} ${n.label} ${n.badge ? countEl(n.badge) : ""}</a>`).join("");
  const account = me ? `
    <div class="nav-sep"></div>
    <a class="nav-item ${a === "friends" ? "active" : ""}" href="#/friends">${icon("users")} Friends ${countEl("pending_requests")}</a>
    <a class="nav-item ${a === "u" && state.route.params[0]?.toLowerCase() === me.username.toLowerCase() ? "active" : ""}" href="#/u/${esc(me.username)}">${icon("user")} Profile</a>
    <a class="nav-item ${a === "settings" ? "active" : ""}" href="#/settings">${icon("gear")} Settings</a>
    ${me.is_admin ? `<a class="nav-item ${a === "mod" ? "active" : ""}" href="#/mod">${icon("shield")} Moderation ${countEl("mod_open", true)}</a>` : ""}` : "";
  const foot = me ? `
    <div class="user-chip" onclick="nav('#/u/${esc(me.username)}')">${avatar(me, "sm")}
      <div style="min-width:0"><div style="font-size:0.85rem;font-weight:650;color:var(--white)">${esc(me.display_name || me.username)}</div>
      <div class="pts">${me.points || 0} pts</div></div></div>` : `
    <a class="btn btn-primary btn-block" href="#/join">Join</a>
    <a class="btn btn-ghost btn-block" style="margin-top:0.5rem" href="#/login">Log in</a>`;
  return `<aside class="sidebar">
    ${main}${account}
    <div class="nav-sep"></div>
    <a class="nav-item" href="${API}/join" target="_blank" rel="noopener">${icon("card")} Get Josh Card</a>
    <a class="nav-item ${a === "rules" ? "active" : ""}" href="#/rules">${icon("book")} Rules</a>
    <div class="sidebar-foot">${foot}</div>
  </aside>`;
}

function topTitle() {
  const n = state.route.name;
  const titles = { feed: "Feed", software: "Software", art: "Art", music: "Music", chats: "Chats", friends: "Friends",
    settings: "Settings", mod: "Moderation", rules: "Rules", login: "Log in", join: "Join", post: "Post", chat: "Chat", u: "Profile" };
  return titles[n] || "Josh's Blog";
}

function renderTopbar() {
  const back = ["post", "chat", "u", "friends", "settings", "mod", "rules"].includes(state.route.name)
    ? `<button class="icon-btn" onclick="history.length > 1 ? history.back() : nav('#/feed')" aria-label="Back">${icon("back")}</button>` : "";
  const right = state.me
    ? `<button class="icon-btn" onclick="openAccountMenu()" aria-label="Account" style="position:relative">${avatar(state.me, "sm")}
        <span class="count red ${(state.me.pending_requests || 0) + (state.me.mod_open || 0) ? "" : "hidden"}" style="position:absolute;top:0;right:0;margin:0;">${(state.me.pending_requests || 0) + (state.me.mod_open || 0)}</span></button>`
    : `<a class="btn btn-primary btn-sm" href="#/join">Join</a>`;
  return `<header class="topbar"><div class="topbar-title">${back}${esc(topTitle())}</div>${right}</header>`;
}

function renderTabbar() {
  const a = activeKey();
  return `<nav class="tabbar">${navItems().map((n) => `
    <button class="tab ${a === n.key ? "active" : ""}" onclick="nav('${n.href}')">${icon(n.icon)}<span>${n.label}</span>${n.badge ? countEl(n.badge) : ""}</button>`).join("")}</nav>`;
}

function openAccountMenu() {
  const me = state.me;
  modal(`
    <div class="row" style="margin-bottom:0.6rem">${avatar(me)}<div><div style="font-weight:700;color:var(--white)">${esc(me.display_name || me.username)}</div>
      <div class="muted small">@${esc(me.username)} · <span class="pts">${me.points || 0} pts</span></div></div></div>
    <button class="menu-item" onclick="nav('#/u/${esc(me.username)}')">${icon("user")} Profile</button>
    <button class="menu-item" onclick="nav('#/friends')">${icon("users")} Friends ${countEl("pending_requests")}</button>
    <button class="menu-item" onclick="nav('#/settings')">${icon("gear")} Settings</button>
    ${me.is_admin ? `<button class="menu-item" onclick="nav('#/mod')">${icon("shield")} Moderation ${countEl("mod_open", true)}</button>` : ""}
    <a class="menu-item" href="${API}/join" target="_blank" rel="noopener">${icon("card")} Get Josh Card</a>
    <button class="menu-item" onclick="nav('#/rules')">${icon("book")} Community rules</button>
    <button class="menu-item danger" onclick="doLogout()">${icon("logout")} Log out</button>`);
}

function render(override) {
  const app = document.getElementById("app");
  let content = override;
  if (content === undefined) {
    const n = state.route.name;
    const gated = ["chats", "chat", "friends", "settings", "mod", "u"].includes(n) && !state.me;
    if (gated) content = renderGate(n);
    else if (n === "feed" || CATS[n]) content = renderFeed();
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
    else content = `<div class="empty">Page not found. <a href="#/feed">Go to the feed</a></div>`;
  }
  app.innerHTML = `<div class="app">${renderSidebar()}${renderTopbar()}<main class="main">${content}</main>${renderTabbar()}</div>`;
}

function renderGate(n) {
  const what = { chats: "chat with friends", chat: "chat with friends", friends: "add friends", settings: "change settings", mod: "moderate", u: "see member profiles" }[n] || "do that";
  return `<div class="card join-cta" style="margin-top:2rem"><p>Join Josh's Blog to ${esc(what)}. Members must be 18 or older.</p>
    <div class="row" style="justify-content:center"><a class="btn btn-primary" href="#/join">Join</a><a class="btn btn-ghost" href="#/login">Log in</a></div></div>`;
}

// ---------------------------------------------------------------------------
// Feed & posts
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
    return `<div class="embed"><iframe height="166" scrolling="no" loading="lazy" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%234a9eff&auto_play=false&show_comments=false"></iframe></div>`;
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
  return `<div class="download-row"><a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Download</a><span class="muted">${esc(host)}</span></div>`;
}

function renderComposer() {
  if (!state.me?.is_admin) return "";
  const cat = currentCategory();
  return `<div class="card composer">
    <textarea id="pc-text" placeholder="Post something…" rows="3"></textarea>
    <div class="thumbs" id="pc-thumbs">${renderThumbs()}</div>
    <div class="composer-bar">
      <label class="icon-btn" title="Photos / videos">${icon("image")} Media
        <input type="file" id="pc-files" accept="image/*,video/*" multiple style="display:none" onchange="addPostFiles(this)"></label>
      <select id="pc-cat" aria-label="Category">
        <option value="">Feed only</option>
        ${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === cat ? "selected" : ""}>${v}</option>`).join("")}
      </select>
      <span style="flex:1"></span>
      <button class="btn btn-primary btn-sm" id="pc-btn" onclick="submitPost()">Post</button>
    </div></div>`;
}
function renderThumbs() {
  return state.pc.files.map((f, i) => `<div class="t">${f.type.startsWith("image/") ? `<img src="${f._url}" alt="">` : "Video"}
    <button onclick="removePostFile(${i})" aria-label="Remove">×</button></div>`).join("");
}
function addPostFiles(input) {
  for (const f of input.files) {
    if (state.pc.files.length >= 10) { toast("Up to 10 files per post"); break; }
    f._url = URL.createObjectURL(f);
    state.pc.files.push(f);
  }
  input.value = "";
  document.getElementById("pc-thumbs").innerHTML = renderThumbs();
}
function removePostFile(i) { state.pc.files.splice(i, 1); document.getElementById("pc-thumbs").innerHTML = renderThumbs(); }

async function submitPost() {
  const text = document.getElementById("pc-text").value.trim();
  if (!text && !state.pc.files.length) return toast("Write something or add media");
  const btn = document.getElementById("pc-btn");
  btn.disabled = true; btn.textContent = "Posting…";
  const fd = new FormData();
  fd.append("body", text);
  fd.append("category", document.getElementById("pc-cat").value);
  state.pc.files.forEach((f) => fd.append("media", f));
  try {
    await api("/posts", { method: "POST", form: fd });
    state.pc.files = [];
    toast("Posted", true);
    await loadPosts(true); render();
  } finally { btn.disabled = false; btn.textContent = "Post"; }
}

function renderFeed() {
  const cat = currentCategory();
  const head = cat ? `<div class="section-title page-title"><span class="cat-chip cat-${cat}">${CATS[cat]}</span></div>` : "";
  const posts = state.posts.map((p) => renderPost(p)).join("");
  const empty = !state.posts.length && !state.loadingPosts
    ? `<div class="empty">${cat ? `Nothing in ${CATS[cat]} yet.` : "No posts yet."}</div>` : "";
  const more = !state.postsDone && state.posts.length ? `<button class="btn btn-ghost load-more" onclick="loadMore()">Load more</button>` : "";
  return `${head}${renderComposer()}${posts}${empty}${more}`;
}

function postHeader(p) {
  return `<div class="post-head">${joshAvatar()}
    <div class="who"><div class="name">Josh Hoffman <span class="badge josh">JOSH</span></div>
    <div class="meta"><a class="muted" href="#/post/${p.id}">${timeAgo(p.created_at)}</a></div></div>
    ${p.category ? `<a class="cat-chip cat-${p.category}" href="#/${p.category}">${CATS[p.category]}</a>` : ""}
    <button class="icon-btn" onclick="postMenu(${p.id})" aria-label="More">${icon("more", "sm")}</button></div>`;
}
function postActions(p) {
  return `<div class="post-actions">
    <button class="icon-btn like-btn ${p.liked ? "liked" : ""}" onclick="likePost(${p.id}, this)" aria-label="Like">${icon("heart")}<span>${p.like_count || ""}</span></button>
    <button class="icon-btn" onclick="nav('#/post/${p.id}')" aria-label="Comments">${icon("comment")}<span>${p.comment_count || ""}</span></button>
    <span class="spacer"></span>
    <button class="icon-btn" onclick="sharePost(${p.id})" aria-label="Share">${icon("share")}</button></div>`;
}

function renderPost(p, full = false) {
  const media = mediaList(p).filter((u) => !embedHtml(u));
  const embed = firstEmbed(p);
  const title = p.title ? `<span class="title">${esc(p.title)}</span>` : "";
  const link = full ? "" : ` onclick="nav('#/post/${p.id}')" style="cursor:pointer"`;
  if (media.length) {
    const slides = media.map((u) => `<div class="slide">${isVideo(u)
      ? `<video src="${esc(src(u))}" controls playsinline preload="metadata"></video>`
      : `<img src="${esc(src(u))}" alt="" loading="lazy">`}</div>`).join("");
    const multi = media.length > 1;
    const caption = (p.title || p.body) ? `<div class="caption ${full ? "" : "clamp"}"${link}><b>Josh Hoffman</b>${p.title ? `<b>${esc(p.title)}</b> ` : ""}${linkify(p.body)}</div>` : "";
    return `<article class="post media-post">${postHeader(p)}
      <div class="carousel-wrap ${multi ? "multi" : ""}">
        <div class="carousel" onscroll="carouselScroll(this)">${slides}</div>
        ${multi ? `<div class="slide-count">1/${media.length}</div>` : ""}
      </div>
      ${multi ? `<div class="dots">${media.map((_, i) => `<span class="${i ? "" : "on"}"></span>`).join("")}</div>` : ""}
      ${postActions(p)}${caption}${downloadButton(p)}${embed}
      ${!full && p.comment_count ? `<a class="view-comments" href="#/post/${p.id}">View ${p.comment_count === 1 ? "1 comment" : `all ${p.comment_count} comments`}</a>` : `<div class="post-foot-pad"></div>`}
    </article>`;
  }
  return `<article class="post text-post">${postHeader(p)}
    <div class="post-text"${link}>${title}${linkify(p.body)}</div>
    ${downloadButton(p)}${embed}${postActions(p)}</article>`;
}

function carouselScroll(el) {
  const i = Math.round(el.scrollLeft / el.clientWidth);
  const wrap = el.parentElement;
  const count = wrap.querySelector(".slide-count");
  const total = el.children.length;
  if (count) count.textContent = `${i + 1}/${total}`;
  wrap.nextElementSibling?.querySelectorAll?.("span").forEach((d, j) => d.classList.toggle("on", j === i));
}

function findPost(id) { return state.post?.id === id ? state.post : state.posts.find((p) => p.id === id); }

async function likePost(id, btn) {
  if (needAccount("like posts")) return;
  const r = await api(`/posts/${id}/like`, { method: "POST" });
  [state.post, ...state.posts].filter((p) => p?.id === id).forEach((p) => { p.liked = r.liked; p.like_count = r.like_count; });
  btn.classList.toggle("liked", r.liked);
  btn.querySelector("span").textContent = r.like_count || "";
}

async function sharePost(id) {
  const url = location.origin + location.pathname + "#/post/" + id;
  if (navigator.share) { try { await navigator.share({ url }); return; } catch { return; } }
  try { await navigator.clipboard.writeText(url); toast("Link copied", true); } catch { prompt("Copy this link:", url); }
}

function postMenu(id) {
  const admin = state.me?.is_admin;
  modal(`<h3>Post</h3>
    <button class="menu-item" onclick="closeModal();sharePost(${id})">${icon("share")} Share link</button>
    ${admin ? `<button class="menu-item danger" onclick="deletePost(${id})">Delete post</button>` : ""}
    <button class="menu-item" onclick="closeModal()">Cancel</button>`);
}
async function deletePost(id) {
  if (!confirm("Delete this post?")) return;
  await api("/posts/" + id, { method: "DELETE" });
  closeModal(); toast("Post deleted", true);
  if (state.route.name === "post") nav("#/feed"); else { await loadPosts(true); render(); }
}

// ---------------------------------------------------------------------------
// Post page + comments
// ---------------------------------------------------------------------------
function renderPostPage() {
  if (!state.post) return `<div class="empty">Loading…</div>`;
  return `${renderPost(state.post, true)}
    ${renderCommentBox()}
    <div class="card comments" id="comments">${renderCommentList()}</div>`;
}

function renderCommentList() {
  const list = state.comments;
  if (!list.length) return `<div class="empty" style="padding:1.5rem">No comments yet${state.me ? " — be the first." : "."}</div>`;
  const ids = new Set(list.map((c) => c.id));
  const top = list.filter((c) => !c.parent_id || !ids.has(c.parent_id));
  const kids = (id) => list.filter((c) => c.parent_id === id);
  return top.map((c) => `${renderComment(c)}${kids(c.id).length ? `<div class="replies">${kids(c.id).map((k) => renderComment(k)).join("")}</div>` : ""}`).join("");
}

function renderComment(c) {
  const mine = state.me && c.user_id === state.me.id;
  const pending = c.image_url && c.image_status === "pending";
  const user = { username: c.username, display_name: c.display_name, avatar_url: c.avatar_url };
  return `<div class="comment" id="c${c.id}">
    <a href="#/u/${esc(c.username)}" onclick="return !needAccount('see member profiles')">${avatar(user, "sm")}</a>
    <div class="body">
      <div class="c-head">
        <span class="c-name" onclick="if(!needAccount('see member profiles')) nav('#/u/${esc(c.username)}')">${esc(c.display_name || c.username)}</span>
        ${c.username?.toLowerCase() === "josh" ? `<span class="badge josh">JOSH</span>` : badgeHtml(ageBadge(c.user_created_at))}
        <span class="pts">${c.user_points || 0} pts</span>
        <span class="muted">· ${timeAgo(c.created_at)}</span>
      </div>
      ${c.body ? `<div class="c-text">${esc(c.body)}</div>` : ""}
      ${c.gif_url ? `<div class="c-media"><img src="${esc(src(c.gif_url))}" alt="GIF" loading="lazy"></div>` : ""}
      ${c.image_url ? `<div class="c-media"><img src="${esc(src(c.image_url))}" alt="" loading="lazy"></div>` : ""}
      ${pending ? `<div class="pending-note">Image is waiting for approval — only you can see it for now</div>` : ""}
      <div class="c-actions">
        <button class="icon-btn like-btn ${c.liked ? "liked" : ""}" onclick="likeComment(${c.id}, this)">${icon("heart", "sm")}<span>${c.like_count || ""}</span></button>
        <button class="icon-btn" onclick="replyTo(${c.id})">Reply</button>
        <button class="icon-btn" onclick="commentMenu(${c.id})" aria-label="More">${icon("more", "sm")}</button>
      </div>
    </div></div>`;
}

function renderCommentBox() {
  if (!state.me) {
    return `<div class="card join-cta"><p>Join to comment, like, and chat with other fans.</p>
      <div class="row" style="justify-content:center"><a class="btn btn-primary" href="#/join">Join</a><a class="btn btn-ghost" href="#/login">Log in</a></div></div>`;
  }
  if (state.me.status !== "active") return `<div class="notice warn">Your account is suspended pending review, so you can't comment right now.</div>`;
  const cc = state.cc;
  const replying = cc.replyTo ? state.comments.find((c) => c.id === cc.replyTo) : null;
  return `<div class="comment-box" id="cbox">
    ${replying ? `<div class="reply-to">Replying to <b>@${esc(replying.username)}</b> <button class="icon-btn" onclick="replyTo(null)">✕</button></div>` : ""}
    <textarea id="cc-text" placeholder="Add a comment…" maxlength="2000" rows="2"></textarea>
    <div id="cc-attach">${renderAttach()}</div>
    <div class="bar">
      ${state.config.gif_search ? `<button class="icon-btn" onclick="toggleGifs('cc')" title="GIF">${gifIcon}</button>` : ""}
      <label class="icon-btn" title="Image or GIF file">${icon("image", "sm")}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none" onchange="attachImage(this)"></label>
      <span style="flex:1"></span>
      <button class="btn btn-primary btn-sm" id="cc-btn" onclick="submitComment()">Post</button>
    </div>
    <div id="cc-gifs">${cc.gifOpen ? renderGifPanel("cc") : ""}</div>
    <div class="muted small" style="margin-top:0.4rem">Images are checked by Josh before anyone else can see them.</div>
  </div>`;
}

function renderAttach() {
  const cc = state.cc;
  if (cc.gif) return `<div class="attach-preview"><img src="${esc(cc.gif.preview || cc.gif.url)}" alt=""><button onclick="clearAttach()">×</button></div>`;
  if (cc.file) return `<div class="attach-preview"><img src="${cc.file._url}" alt=""><button onclick="clearAttach()">×</button></div>`;
  return "";
}
function clearAttach() { state.cc.gif = null; state.cc.file = null; document.getElementById("cc-attach").innerHTML = ""; }
function attachImage(input) {
  const f = input.files[0]; input.value = "";
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) return toast("Images must be under 8 MB");
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
  const btn = document.getElementById("cc-btn"); btn.disabled = true; btn.textContent = "Posting…";
  const fd = new FormData();
  fd.append("body", text);
  if (cc.replyTo) fd.append("parent_id", cc.replyTo);
  if (cc.gif) fd.append("gif_id", cc.gif.id);
  if (cc.file) fd.append("image", cc.file);
  try {
    const c = await api(`/posts/${state.post.id}/comments`, { method: "POST", form: fd });
    state.cc = { replyTo: null, gif: null, file: null, gifOpen: false };
    if (c.pending_image) toast("Comment posted. Your image will appear once Josh approves it.", true);
    await loadPost(state.post.id); await refreshMe();
    render();
    document.getElementById("c" + c.id)?.scrollIntoView({ block: "center" });
  } finally { btn.disabled = false; btn.textContent = "Post"; }
}

async function likeComment(id, btn) {
  if (needAccount("like comments")) return;
  const r = await api(`/comments/${id}/like`, { method: "POST" });
  const c = state.comments.find((x) => x.id === id); if (c) { c.liked = r.liked; c.like_count = r.like_count; }
  btn.classList.toggle("liked", r.liked);
  btn.querySelector("span").textContent = r.like_count || "";
}

function commentMenu(id) {
  const c = state.comments.find((x) => x.id === id) || state.profile?.history?.find((x) => x.id === id);
  const canDelete = state.me && (state.me.is_admin || c?.user_id === state.me.id);
  modal(`<h3>Comment</h3>
    ${state.me && c?.user_id !== state.me.id ? `<button class="menu-item" onclick="openReport('comment', ${id})">Report comment</button>` : ""}
    ${canDelete ? `<button class="menu-item danger" onclick="deleteComment(${id})">Delete comment</button>` : ""}
    ${!state.me ? `<button class="menu-item" onclick="needAccount('report comments')">Report comment</button>` : ""}
    <button class="menu-item" onclick="closeModal()">Cancel</button>`);
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
    <input class="input" placeholder="Search GIPHY" oninput="searchGifs(this.value, '${target}')" id="gif-q-${target}">
    <div class="gif-grid" id="gif-grid-${target}"><div class="muted small">Loading…</div></div>
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
    <p class="muted small" style="margin-bottom:0.7rem">Reports go to Josh. If someone is in immediate danger, contact local emergency services.</p>
    ${Object.entries(reasons).map(([k, v], i) => `<label class="pick"><input type="radio" name="rr" value="${k}" ${i ? "" : ""}> ${esc(v)}</label>`).join("")}
    <textarea class="input" id="rr-details" placeholder="Anything else Josh should know? (optional)" style="margin-top:0.7rem" maxlength="1000"></textarea>
    <div class="form-error" id="rr-err"></div>
    <div class="row" style="margin-top:0.5rem"><button class="btn btn-primary" style="flex:1" onclick="sendReport('${type}', ${id})">Send report</button>
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button></div>`);
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
// Profiles
// ---------------------------------------------------------------------------
function renderProfile() {
  const p = state.profile;
  if (!p) return `<div class="empty">Loading…</div>`;
  const isMe = p.friend_status === "self";
  let actions = "";
  if (isMe) actions = `<a class="btn btn-ghost btn-sm" href="#/settings">Edit profile</a>`;
  else if (p.friend_status === "friends") actions = `<button class="btn btn-primary btn-sm" onclick="openDM(${p.id})">Message</button>
      <button class="btn btn-ghost btn-sm" onclick="unfriend(${p.id})">Unfriend</button>`;
  else if (p.friend_status === "sent") actions = `<button class="btn btn-ghost btn-sm" disabled>Request sent</button>`;
  else if (p.friend_status === "pending") actions = p.request_id
    ? `<button class="btn btn-primary btn-sm" onclick="acceptFriend(${p.request_id})">Accept request</button>
       <button class="btn btn-ghost btn-sm" onclick="rejectFriend(${p.request_id})">Decline</button>` : "";
  else actions = `<button class="btn btn-primary btn-sm" onclick="addFriend(${p.id}, this)">Add friend</button>`;
  if (!isMe) actions += `<button class="btn btn-ghost btn-sm" onclick="openReport('user', ${p.id})" aria-label="Report">Report</button>`;
  if (state.me?.is_admin && !isMe && !p.is_admin) actions += p.status === "active"
    ? `<button class="btn btn-danger btn-sm" onclick="setStatus(${p.id}, 'banned')">Ban</button>`
    : `<button class="btn btn-ghost btn-sm" onclick="setStatus(${p.id}, 'active')">Reinstate</button>`;
  const history = (p.history || []).map((c) => `
    <div class="history-item" onclick="nav('#/post/${c.post_id}')">
      <div class="on">Commented on ${c.post_category ? `<span class="cat-${c.post_category}">${CATS[c.post_category]}</span> · ` : ""}“${esc(String(c.post_snippet || "").replace(/https?:\/\/\S*/g, "").trim() || "a post")}” · ${timeAgo(c.created_at)}</div>
      ${c.body ? `<div class="txt">${esc(c.body)}</div>` : ""}
      ${c.gif_url ? `<img src="${esc(src(c.gif_url))}" alt="GIF" style="max-width:140px;border-radius:8px;margin-top:0.3rem">` : ""}
      ${c.image_url ? `<img src="${esc(src(c.image_url))}" alt="" style="max-width:140px;border-radius:8px;margin-top:0.3rem">` : ""}
      <div class="muted small" style="margin-top:0.2rem">♥ ${c.like_count || 0}</div>
    </div>`).join("");
  return `<div class="card profile-head">
      ${p.is_admin ? joshAvatar("lg") : avatar(p, "lg")}
      <div class="profile-name">${esc(p.display_name || p.username)} ${p.is_admin ? `<span class="badge josh">JOSH</span>` : ""}</div>
      <div class="profile-sub">@${esc(p.username)} ${badgeHtml(p.badge)} <span>· Joined ${esc(joined(p.created_at))}</span></div>
      ${p.status !== "active" ? `<div class="notice warn" style="margin-top:0.6rem">This account is ${esc(p.status)}.</div>` : ""}
      ${isMe && state.me?.avatar_pending ? `<div class="pending-note">Your new photo is waiting for approval</div>` : ""}
      ${p.bio ? `<div class="profile-bio">${esc(p.bio)}</div>` : ""}
      <div class="stats">
        <div><div class="n pts" style="font-size:1.05rem">${p.points || 0}</div><div class="l">Points</div></div>
        <div><div class="n">${p.comment_count || 0}</div><div class="l">Comments</div></div>
        <div><div class="n">${p.friends_count || 0}</div><div class="l">Friends</div></div>
      </div>
      <div class="profile-actions">${actions}</div>
    </div>
    <div class="card"><div class="panel-title">Activity</div>${history || `<div class="empty" style="padding:1rem">No comments yet.</div>`}</div>`;
}

async function reloadProfile() { if (state.profile) { state.profile = await api("/users/" + encodeURIComponent(state.profile.username)); render(); } }
async function addFriend(id, btn) {
  await api(`/friends/request/${id}`, { method: "POST" });
  if (btn) { btn.textContent = "Request sent"; btn.disabled = true; }
  if (state.route.name === "u") await reloadProfile();
}
async function acceptFriend(reqId) {
  await api(`/friends/accept/${reqId}`, { method: "POST" });
  await refreshMe(); toast("Friend added", true);
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
async function openDM(userId) {
  const r = await api(`/chats/direct/${userId}`, { method: "POST" });
  nav("#/chat/" + r.id);
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
function renderFriends() {
  const req = state.requests.received || [];
  const sent = state.requests.sent || [];
  return `<div class="section-title page-title">Friends</div>
    <div class="card"><input class="input" placeholder="Search people by username" oninput="friendSearch(this.value)">
      <div id="fs-results"></div></div>
    ${req.length ? `<div class="card"><div class="panel-title">Requests</div>${req.map((r) => `
      <div class="list-item">${avatar(r, "sm")}<div class="grow clickable" onclick="nav('#/u/${esc(r.username)}')"><b>${esc(r.display_name || r.username)}</b> <span class="muted small">@${esc(r.username)}</span></div>
        <button class="btn btn-primary btn-sm" onclick="acceptFriend(${r.request_id})">Accept</button>
        <button class="btn btn-ghost btn-sm" onclick="rejectFriend(${r.request_id})">Decline</button></div>`).join("")}</div>` : ""}
    <div class="card"><div class="panel-title">Your friends · ${state.friends.length}</div>
      ${state.friends.map((f) => `<div class="list-item">${avatar(f, "sm")}
        <div class="grow clickable" onclick="nav('#/u/${esc(f.username)}')"><b>${esc(f.display_name || f.username)}</b> <span class="muted small">@${esc(f.username)}</span></div>
        <button class="btn btn-ghost btn-sm" onclick="openDM(${f.id})">Message</button></div>`).join("") || `<div class="empty" style="padding:1rem">No friends yet. Search above to find people.</div>`}
    </div>
    ${sent.length ? `<div class="card"><div class="panel-title">Sent requests</div>${sent.map((s) => `<div class="list-item">${avatar(s, "sm")}<div class="grow">@${esc(s.username)}</div><span class="muted small">Pending</span></div>`).join("")}</div>` : ""}`;
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
      || `<div class="muted small" style="padding:0.6rem 0">No one found</div>`;
  }, 250);
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------
function chatTitle(c) {
  if (c.name) return c.name;
  const others = (c.members || []).filter((m) => m.id !== state.me?.id);
  if (!others.length) return "Just you";
  return others.map((m) => m.display_name || m.username).join(", ");
}
function chatAvatar(c) {
  const others = (c.members || []).filter((m) => m.id !== state.me?.id);
  if (c.is_group && others.length > 1) return `<div class="group-av">${avatar(others[0])}${avatar(others[1])}</div>`;
  return avatar(others[0] || {});
}
function lastPreview(c) {
  const m = c.last_message; if (!m) return "No messages yet";
  if (m.kind === "system") return m.body;
  const who = m.sender_id === state.me?.id ? "You: " : "";
  return who + (m.body || (m.gif_url ? "GIF" : ""));
}

function renderChats() {
  return `<div class="row between" style="margin-bottom:0.6rem"><div class="section-title page-title" style="margin:0">Chats</div>
      <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="newChat()">${icon("plus", "sm")} New</button></div>
    <div class="notice">Chats are with friends only. Messages are scanned automatically for rule-breaking content and may be reviewed by Josh. <a href="#/rules">Rules</a></div>
    <div class="card" style="padding:0.4rem">
    ${state.chats.map((c) => `<div class="chat-item ${c.unread ? "unread" : ""}" onclick="nav('#/chat/${c.id}')">${chatAvatar(c)}
      <div class="grow"><div class="t">${esc(chatTitle(c))}</div><div class="p">${esc(lastPreview(c))}</div></div>
      <div style="text-align:right"><div class="muted small">${c.last_message ? timeAgo(c.last_message.created_at) : ""}</div>
      ${c.unread ? `<span class="count">${c.unread}</span>` : ""}</div></div>`).join("") || `<div class="empty">No chats yet. Add friends, then message them.</div>`}
    </div>`;
}

async function newChat() {
  const friends = await api("/friends");
  if (!friends.length) { toast("Add some friends first"); nav("#/friends"); return; }
  modal(`<h3>New chat</h3><p class="muted small" style="margin-bottom:0.5rem">Pick one friend for a DM, or several for a group.</p>
    ${friends.map((f) => `<label class="pick"><input type="checkbox" value="${f.id}" name="nc">${avatar(f, "sm")} ${esc(f.display_name || f.username)}</label>`).join("")}
    <button class="btn btn-primary btn-block" style="margin-top:0.8rem" onclick="startChat()">Start chat</button>`);
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
  if (!c) return `<div class="empty">Loading…</div>`;
  const others = c.members.filter((m) => m.id !== state.me.id);
  const sub = c.is_group ? `${c.members.length} people` : others[0] ? `@${others[0].username}` : "";
  return `<div class="chat-view">
    <div class="chat-head">
      <button class="icon-btn desktop-only" onclick="nav('#/chats')" aria-label="Back">${icon("back")}</button>
      ${chatAvatar(c)}
      <div class="grow clickable" onclick="${!c.is_group && others[0] ? `nav('#/u/${esc(others[0].username)}')` : "chatInfo()"}">
        <div class="t">${esc(chatTitle(c))}</div><div class="muted small">${esc(sub)}</div></div>
      <button class="icon-btn" onclick="chatInfo()" aria-label="Chat options">${icon("more")}</button>
    </div>
    <div class="chat-msgs" id="chat-msgs">${renderMessages(c.messages)}</div>
    ${c.can_send && state.me.status === "active" ? `
      <div id="mc-gifs"></div>
      <div class="chat-input">
        ${state.config.gif_search ? `<button class="icon-btn" onclick="toggleGifs('mc')" title="GIF">${gifIcon}</button>` : ""}
        <input id="mc-text" placeholder="Message" maxlength="2000" autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage()}">
        <button class="btn btn-primary btn-sm" onclick="sendMessage()" aria-label="Send">${icon("send", "sm")}</button>
      </div>` : `<div class="readonly-note">${esc(c.read_only_reason || "You can't send messages right now.")}</div>`}
  </div>`;
}

function renderMessages(msgs) {
  const group = state.chat?.is_group;
  let prevSender = null;
  return msgs.map((m) => {
    if (m.kind === "system") { prevSender = null; return `<div class="sys">${esc(m.body)}</div>`; }
    const mine = m.sender_id === state.me.id;
    const showName = group && !mine && prevSender !== m.sender_id;
    prevSender = m.sender_id;
    return `<div class="msg ${mine ? "mine" : "theirs"}" data-id="${m.id}">
      ${showName ? `<div class="who">${esc(m.display_name || m.username || "")}</div>` : ""}
      ${m.body ? `<div class="bubble">${esc(m.body)}</div>` : ""}
      ${m.gif_url ? `<img class="gif" src="${esc(src(m.gif_url))}" alt="GIF" loading="lazy">` : ""}
      <div class="meta">${timeAgo(m.created_at)}${!mine ? ` · <button onclick="openReport('message', ${m.id})">Report</button>` : ""}</div>
    </div>`;
  }).join("") || `<div class="empty">Say hi 👋</div>`;
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
    <div class="panel-title">${c.members.length} ${c.members.length === 1 ? "person" : "people"}</div>
    ${c.members.map((m) => `<div class="list-item clickable" onclick="nav('#/u/${esc(m.username)}')">${avatar(m, "sm")}<div class="grow">${esc(m.display_name || m.username)} <span class="muted small">@${esc(m.username)}</span></div></div>`).join("")}
    <div style="margin-top:0.6rem">
      ${c.can_send ? `<button class="menu-item" onclick="addPeople()">${icon("plus")} ${c.is_group ? "Add people" : "Add people (starts a new group)"}</button>` : ""}
      ${c.is_group ? `<button class="menu-item" onclick="renameChat()">Rename group</button>
        <button class="menu-item danger" onclick="leaveChat()">Leave group</button>` : ""}
      <button class="menu-item" onclick="closeModal()">Close</button>
    </div>`);
}
async function addPeople() {
  const friends = await api("/friends");
  const inChat = new Set(state.chat.members.map((m) => m.id));
  const options = friends.filter((f) => !inChat.has(f.id));
  if (!options.length) { toast("All your friends are already here"); return; }
  modal(`<h3>Add people</h3>
    ${!state.chat.is_group ? `<p class="muted small" style="margin-bottom:0.5rem">This starts a new group chat. Your 1-on-1 messages stay private.</p>` : ""}
    ${options.map((f) => `<label class="pick"><input type="checkbox" value="${f.id}" name="ap">${avatar(f, "sm")} ${esc(f.display_name || f.username)}</label>`).join("")}
    <button class="btn btn-primary btn-block" style="margin-top:0.8rem" onclick="confirmAddPeople()">Add</button>`);
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
// Settings, rules, auth
// ---------------------------------------------------------------------------
function renderSettings() {
  const me = state.me;
  const pts = state.config.points || {};
  return `<div class="section-title page-title">Settings</div>
    <div class="card"><div class="panel-title">Profile</div>
      <form onsubmit="saveProfile(event)">
        <div class="field"><label>Display name</label><input class="input" name="display_name" value="${esc(me.display_name || "")}" maxlength="50"></div>
        <div class="field"><label>Bio</label><textarea class="input" name="bio" maxlength="300" rows="3">${esc(me.bio || "")}</textarea></div>
        <div class="field"><label>Profile photo</label>
          <div class="row">${avatar(me)}<input type="file" name="avatar" accept="image/jpeg,image/png,image/webp" style="color:var(--text2);font-size:0.85rem"></div>
          <div class="muted small" style="margin-top:0.3rem">${me.avatar_pending ? "Your new photo is waiting for approval." : "New photos are checked by Josh before they show up."}</div></div>
        <button class="btn btn-primary" type="submit" id="sp-btn">Save</button>
      </form></div>
    <div class="card"><div class="panel-title">Points · <span class="pts">${me.points || 0}</span></div>
      <p class="muted small">You earn points for being part of the community (daily limits apply):</p>
      <ul class="muted small" style="padding-left:1.1rem;margin-top:0.4rem">
        <li>Visiting: ${pts.visit?.amount ?? 1} per day</li>
        <li>Commenting: ${pts.comment?.amount ?? 2} each (first ${pts.comment?.dailyCap ?? 10} a day)</li>
        <li>Liking posts and comments: ${pts.like_given?.amount ?? 1} each (first ${pts.like_given?.dailyCap ?? 10} a day)</li>
        <li>Getting likes on your comments: ${pts.like_received?.amount ?? 1} each</li>
        <li>Getting replies: ${pts.reply_received?.amount ?? 1} each</li>
      </ul></div>
    <div class="card"><a href="#/rules">Community rules & safety</a></div>
    <button class="btn btn-danger btn-block" onclick="doLogout()">Log out</button>`;
}
async function saveProfile(e) {
  e.preventDefault();
  const f = e.target; const btn = document.getElementById("sp-btn");
  const fd = new FormData();
  fd.append("display_name", f.display_name.value); fd.append("bio", f.bio.value);
  if (f.avatar.files[0]) fd.append("avatar", f.avatar.files[0]);
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const r = await api("/profile", { method: "PUT", form: fd });
    state.me = await api("/auth/me");
    toast(r.avatar_pending ? "Saved. Your new photo will appear once Josh approves it." : "Saved", true);
    render();
  } finally { btn.disabled = false; btn.textContent = "Save"; }
}

function renderRules() {
  return `<div class="card rules">
    <div class="section-title">Community rules</div>
    <p>Josh's Blog is a place for fans to talk about Josh's software, art and music. Keep it kind and keep it legal.</p>
    <h2>Who can join</h2>
    <ul><li>You must be 18 or older. Accounts that appear to belong to minors are removed.</li><li>One account per person. No impersonation.</li></ul>
    <h2>Not allowed</h2>
    <ul>
      <li>Anything illegal: drugs, weapons, scams, stolen goods, or any other illegal activity.</li>
      <li>Anything sexual involving minors — ever. This is reported to the National Center for Missing &amp; Exploited Children (NCMEC) as required by US law.</li>
      <li>Nudity or sexual content.</li>
      <li>Harassment, threats, hate speech or slurs.</li>
      <li>Spam, or pushing people to other apps or payment apps.</li>
      <li>Sharing someone's private information.</li>
    </ul>
    <h2>How the site is monitored</h2>
    <ul>
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
  if (state.me) return `<div class="empty">You're logged in as @${esc(state.me.username)}. <a href="#/feed">Go to the feed</a></div>`;
  if (mode === "join") return `<div class="auth-wrap"><h1>Join Josh's Blog</h1>
    <p class="sub">Comment, like, add friends and chat. Only Josh posts; everyone can talk.</p>
    <form onsubmit="doJoin(event)">
      <div class="field"><label>Username</label><input class="input" name="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" autocomplete="username"></div>
      <div class="field"><label>Password (8+ characters)</label><input class="input" name="password" type="password" required minlength="8" autocomplete="new-password"></div>
      <label class="check"><input type="checkbox" name="age" required> I confirm I am 18 years of age or older.</label>
      <label class="check"><input type="checkbox" name="terms" required> I agree to the <a href="#/rules" target="_blank">community rules</a>, including that messages are automatically scanned and may be reviewed.</label>
      <button class="btn btn-primary btn-block" type="submit">Create account</button>
      <div class="form-error"></div>
    </form>
    <p class="muted small" style="text-align:center;margin-top:1rem">Already a member? <a href="#/login">Log in</a></p></div>`;
  return `<div class="auth-wrap"><h1>Log in</h1><p class="sub">Welcome back.</p>
    <form onsubmit="doLogin(event)">
      <div class="field"><label>Username</label><input class="input" name="username" required autocomplete="username"></div>
      <div class="field"><label>Password</label><input class="input" name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn btn-primary btn-block" type="submit">Log in</button>
      <div class="form-error"></div>
    </form>
    <p class="muted small" style="text-align:center;margin-top:1rem">New here? <a href="#/join">Join</a> · Or just <a href="#/feed">browse as a guest</a></p></div>`;
}

function openConfirm() {
  modal(`<h3>Quick check</h3>
    <p class="muted small" style="margin-bottom:0.8rem">Josh's Blog is now 18+ with community rules. Please confirm to keep commenting and chatting.</p>
    <label class="check"><input type="checkbox" id="cf-age"> I confirm I am 18 years of age or older.</label>
    <label class="check"><input type="checkbox" id="cf-terms"> I agree to the <a href="#/rules" onclick="closeModal()">community rules</a>, including that messages are automatically scanned and may be reviewed.</label>
    <div class="form-error" id="cf-err"></div>
    <button class="btn btn-primary btn-block" onclick="sendConfirm()">Continue</button>`);
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
// Moderation (admin)
// ---------------------------------------------------------------------------
function flagsHtml(cats, severe) {
  return String(cats || "").split(",").filter(Boolean).map((c) => `<span class="flag ${severe ? "severe" : ""}">${esc(c)}</span>`).join("");
}
function renderMod() {
  const q = state.mod;
  if (!q) return `<div class="empty">Loading…</div>`;
  const severe = q.events.filter((e) => e.severe);
  const mode = state.me.moderation_mode === "ai+rules" ? "AI + rules" : "rules only (free)";
  const section = (title, n, body) => `<div class="card"><div class="panel-title">${title} · ${n}</div>${n ? body : `<div class="muted small">Nothing here.</div>`}</div>`;
  return `<div class="section-title page-title">Moderation</div>
    <div class="notice">Automatic checks: <b>${mode}</b>. Images and uploaded GIFs wait for your approval.</div>
    ${severe.length ? `<div class="notice danger"><b>${severe.length} child-safety alert${severe.length > 1 ? "s" : ""}.</b> The account was suspended automatically. If it's apparent child sexual abuse material, US law requires reporting it to NCMEC's CyberTipline (report.cybertip.org).</div>` : ""}

    ${section("Reports", q.reports.length, q.reports.map((r) => `<div class="mod-item">
      <div class="row between"><div><span class="flag ${r.reason === "child-safety" ? "severe" : ""}">${esc(r.reason_label)}</span>
        <span class="muted small">${esc(r.target_type)} · reported by @${esc(r.reporter)} · ${timeAgo(r.created_at)}</span></div></div>
      ${r.target ? `<div class="small" style="margin-top:0.3rem">By <a href="#/u/${esc(r.target.author)}">@${esc(r.target.author || "?")}</a>${r.target.removed ? " · <span class='muted'>already removed</span>" : ""}</div>
        ${r.target.text ? `<div class="quote">${esc(r.target.text)}</div>` : ""}
        ${r.target.gif_url || r.target.image_url ? `<img class="mod-img" src="${esc(src(r.target.image_url || r.target.gif_url))}" alt="">` : ""}` : `<div class="muted small">Content no longer exists.</div>`}
      ${r.details ? `<div class="muted small">Note: ${esc(r.details)}</div>` : ""}
      <div class="actions">
        ${r.target?.post_id ? `<a class="btn btn-ghost btn-sm" href="#/post/${r.target.post_id}">Open post</a>` : ""}
        ${r.target?.chat_id ? `<button class="btn btn-ghost btn-sm" onclick="modViewChat(${r.target.chat_id})">Read chat</button>` : ""}
        ${r.target_type !== "user" ? `<button class="btn btn-ghost btn-sm" onclick="modResolve(${r.id}, true, false)">Remove</button>` : ""}
        <button class="btn btn-danger btn-sm" onclick="modResolve(${r.id}, ${r.target_type !== "user"}, true)">${r.target_type !== "user" ? "Remove + ban" : "Ban"}</button>
        <button class="btn btn-ghost btn-sm" onclick="modResolve(${r.id}, false, false)">Dismiss</button>
      </div></div>`).join(""))}

    ${section("Images waiting for approval", q.images.comments.length + q.images.avatars.length,
      q.images.comments.map((c) => `<div class="mod-item"><div class="small">Comment by <a href="#/u/${esc(c.username)}">@${esc(c.username)}</a> · ${timeAgo(c.created_at)}</div>
        <img class="mod-img" src="${esc(src(c.image_url))}" alt="">${c.body ? `<div class="quote">${esc(c.body)}</div>` : ""}
        <div class="actions"><button class="btn btn-primary btn-sm" onclick="modImage('comment', ${c.id}, true)">Approve</button>
        <button class="btn btn-danger btn-sm" onclick="modImage('comment', ${c.id}, false)">Reject</button>
        <a class="btn btn-ghost btn-sm" href="#/post/${c.post_id}">Open post</a></div></div>`).join("")
      + q.images.avatars.map((a) => `<div class="mod-item"><div class="small">Profile photo for <a href="#/u/${esc(a.username)}">@${esc(a.username)}</a></div>
        <img class="mod-img" src="${esc(src(a.image_url))}" alt="" style="border-radius:50%;width:120px;height:120px;object-fit:cover">
        <div class="actions"><button class="btn btn-primary btn-sm" onclick="modImage('avatar', ${a.user_id}, true)">Approve</button>
        <button class="btn btn-danger btn-sm" onclick="modImage('avatar', ${a.user_id}, false)">Reject</button></div></div>`).join(""))}

    ${section("Flagged chats", q.chats.length, q.chats.map((c) => `<div class="mod-item">
      <div class="small"><b>${esc(c.name || (c.is_group ? "Group chat" : "DM"))}</b> · ${esc(c.members.map((m) => "@" + m).join(", "))} · ${c.flagged_messages} flagged message${c.flagged_messages === 1 ? "" : "s"}</div>
      <div class="actions"><button class="btn btn-ghost btn-sm" onclick="modViewChat(${c.id})">Read chat</button>
      <button class="btn btn-ghost btn-sm" onclick="modClearChat(${c.id})">Looks fine — clear</button></div></div>`).join(""))}

    ${section("Automatic flags & blocks", q.events.length, q.events.map((e) => `<div class="mod-item">
      <div>${flagsHtml(e.categories, e.severe)} <span class="muted small">${esc(e.action)} · ${esc(e.content_type)} · ${timeAgo(e.created_at)}</span></div>
      <div class="small">By ${e.username ? `<a href="#/u/${esc(e.username)}">@${esc(e.username)}</a>` : "unknown"}${e.user_status && e.user_status !== "active" ? ` · <span class="muted">${esc(e.user_status)}</span>` : ""}</div>
      ${e.text ? `<div class="quote">${esc(e.text)}</div>` : ""}
      <div class="actions">
        ${/^chat:(\d+)/.test(e.context) ? `<button class="btn btn-ghost btn-sm" onclick="modViewChat(${e.context.match(/^chat:(\d+)/)[1]})">Read chat</button>` : ""}
        ${/^post:(\d+)/.test(e.context) ? `<a class="btn btn-ghost btn-sm" href="#/post/${e.context.match(/^post:(\d+)/)[1]}">Open post</a>` : ""}
        ${e.user_id && e.user_status === "active" ? `<button class="btn btn-danger btn-sm" onclick="setStatus(${e.user_id}, 'banned')">Ban user</button>` : ""}
        ${e.user_id && e.user_status === "suspended" ? `<button class="btn btn-ghost btn-sm" onclick="setStatus(${e.user_id}, 'active')">Reinstate</button><button class="btn btn-danger btn-sm" onclick="setStatus(${e.user_id}, 'banned')">Ban</button>` : ""}
        <button class="btn btn-ghost btn-sm" onclick="modEvent(${e.id})">Mark reviewed</button>
      </div></div>`).join(""))}

    ${section("Suspended & banned accounts", q.accounts.length, q.accounts.map((a) => `<div class="mod-item row between">
      <div class="small"><a href="#/u/${esc(a.username)}">@${esc(a.username)}</a> · ${esc(a.status)}${a.status_reason ? ` · <span class="muted">${esc(a.status_reason)}</span>` : ""}</div>
      <div class="actions" style="margin:0">${a.status !== "banned" ? `<button class="btn btn-danger btn-sm" onclick="setStatus(${a.id}, 'banned')">Ban</button>` : ""}
      <button class="btn btn-ghost btn-sm" onclick="setStatus(${a.id}, 'active')">Reinstate</button></div></div>`).join(""))}`;
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
    <div class="muted small" style="margin-bottom:0.6rem">${c.members.map((m) => `@${esc(m.username)}${m.left_at ? " (left)" : ""}`).join(", ")}</div>
    <div style="max-height:55vh;overflow-y:auto">${c.messages.map((m) => m.kind === "system"
      ? `<div class="sys">${esc(m.body)}</div>`
      : `<div class="mod-item" style="padding:0.4rem 0"><div class="small"><b>@${esc(m.username || "?")}</b> <span class="muted">${timeAgo(m.created_at)}</span> ${flagsHtml(m.flags)} ${m.status !== "visible" ? "<span class='muted'>(removed)</span>" : ""}</div>
        ${m.body ? `<div class="small" style="white-space:pre-wrap">${esc(m.body)}</div>` : ""}${m.gif_url ? `<img src="${esc(src(m.gif_url))}" style="max-width:120px;border-radius:6px">` : ""}
        ${m.status === "visible" ? `<button class="icon-btn small" onclick="modRemoveMsg(${m.id}, ${c.id})">Remove</button>` : ""}</div>`).join("")}</div>
    <div class="row" style="margin-top:0.8rem">${c.flagged ? `<button class="btn btn-ghost btn-sm" onclick="modClearChat(${c.id})">Clear flag</button>` : ""}
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">Close</button></div>`);
}
async function modRemoveMsg(id, chatId) { await api(`/mod/messages/${id}/remove`, { method: "POST" }); await modViewChat(chatId); }

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  try { state.config = await api("/config"); } catch {}
  await refreshMe();
  await go();
  if (state.me && !state.me.confirmed) openConfirm();
})();
