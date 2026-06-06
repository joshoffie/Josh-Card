// ---------------------------------------------------------------------------
// Social API routes
// ---------------------------------------------------------------------------
import { Router } from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import {
  registerUser, loginUser, logoutUser, getSessionUser,
  getPublicProfile, getProfileById, updateUserProfile,
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest, removeFriend,
  getFriends, getPendingRequests, getSentRequests, getFriendshipStatus,
  createUserPost, getUserPosts, deleteUserPostById, getFeedPosts,
  sendMessage, getMessages, getConversations, getUnreadCount,
  findUsers,
} from "./social.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// CORS
router.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Auth middleware — sets req.user if valid token
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) req.user = getSessionUser(token);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Login required" });
  next();
}

router.use(authMiddleware);

// ---- Auth ----
router.post("/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await registerUser(username, password);
    const user = getProfileById(result.userId);
    res.status(201).json({ token: result.token, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await loginUser(username, password);
    const user = getProfileById(result.userId);
    res.json({ token: result.token, user });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

router.post("/auth/logout", requireAuth, (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  logoutUser(token);
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, (req, res) => {
  const unread = getUnreadCount(req.user.id);
  const pending = getPendingRequests(req.user.id).length;
  res.json({ ...req.user, unread_messages: unread, pending_requests: pending });
});

// ---- Profiles ----
router.get("/users/search", (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 1) return res.json([]);
  res.json(findUsers(q));
});

router.get("/users/:username", (req, res) => {
  const profile = getPublicProfile(req.params.username);
  if (!profile) return res.status(404).json({ error: "User not found" });
  const friendStatus = req.user ? getFriendshipStatus(req.user.id, profile.id) : "none";
  const posts = getUserPosts(profile.id, 50);
  const friends = getFriends(profile.id);
  res.json({ ...profile, friend_status: friendStatus, posts, friends });
});

router.put("/profile", requireAuth, upload.single("avatar"), async (req, res) => {
  try {
    let avatarUrl = req.user.avatar_url;
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: "image", folder: "josh-blog-avatars", transformation: { width: 200, height: 200, crop: "fill" } },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(req.file.buffer);
      });
      avatarUrl = result.secure_url;
    }
    const displayName = req.body.display_name ?? req.user.display_name;
    const bio = req.body.bio ?? req.user.bio;
    updateUserProfile(req.user.id, displayName, bio, avatarUrl);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Friends ----
router.post("/friends/request/:userId", requireAuth, (req, res) => {
  try {
    sendFriendRequest(req.user.id, parseInt(req.params.userId));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/friends/accept/:requestId", requireAuth, (req, res) => {
  try {
    acceptFriendRequest(parseInt(req.params.requestId), req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/friends/reject/:requestId", requireAuth, (req, res) => {
  try {
    rejectFriendRequest(parseInt(req.params.requestId), req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/friends/:userId", requireAuth, (req, res) => {
  removeFriend(req.user.id, parseInt(req.params.userId));
  res.json({ ok: true });
});

router.get("/friends", requireAuth, (req, res) => {
  res.json(getFriends(req.user.id));
});

router.get("/friends/requests", requireAuth, (req, res) => {
  res.json({
    received: getPendingRequests(req.user.id),
    sent: getSentRequests(req.user.id),
  });
});

// ---- User Posts ----
router.post("/user-posts", requireAuth, upload.single("media"), async (req, res) => {
  try {
    let mediaUrl = "";
    if (req.file) {
      const resourceType = req.file.mimetype.startsWith("video/") ? "video" : "image";
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: resourceType, folder: "josh-blog" },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(req.file.buffer);
      });
      mediaUrl = result.secure_url;
    }
    const post = createUserPost(req.user.id, req.body.body || "", mediaUrl);
    post.username = req.user.username;
    post.display_name = req.user.display_name;
    post.avatar_url = req.user.avatar_url;
    res.status(201).json(post);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/feed", requireAuth, (req, res) => {
  const posts = getFeedPosts(req.user.id, 50);
  res.json(posts);
});

router.delete("/user-posts/:id", requireAuth, (req, res) => {
  deleteUserPostById(parseInt(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---- Messages ----
router.get("/conversations", requireAuth, (req, res) => {
  res.json(getConversations(req.user.id));
});

router.get("/messages/:userId", requireAuth, (req, res) => {
  const msgs = getMessages(req.user.id, parseInt(req.params.userId));
  const other = getProfileById(parseInt(req.params.userId));
  res.json({ user: other, messages: msgs });
});

router.post("/messages/:userId", requireAuth, (req, res) => {
  try {
    const msg = sendMessage(req.user.id, parseInt(req.params.userId), req.body.body);
    res.status(201).json(msg);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/unread", requireAuth, (req, res) => {
  res.json({ count: getUnreadCount(req.user.id) });
});

export default router;
