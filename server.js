const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Minimal .env loader (no dependency). Values already set in the environment win.
(function loadEnv() {
  try {
    const file = path.join(__dirname, ".env");
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith("#")) continue;
      const key = m[1];
      let val = m[2].trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* ignore malformed .env */ }
})();

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const PUBLIC = path.join(ROOT, "public");

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const submissionsFile = path.join(DATA, "submissions.json");
const usersFile = path.join(DATA, "users.json");
const activityFile = path.join(DATA, "activity.json");
const adminsFile = path.join(DATA, "admins.json");

function readJson(file, fallback=[]) {
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// A user counts as online while a heartbeat has been seen recently.
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const ACTIVITY_LIMIT = 500;

function truncate(value, max) {
  const s = String(value == null ? "" : value);
  return s.length > max ? s.slice(0, max) : s;
}

// Upsert the server-side user record. Identity always comes from a verified
// Firebase token, never from a user-supplied field.
function upsertUser(user, fields = {}) {
  const users = readJson(usersFile, []);
  let record = users.find(u => u.uid === user.uid);
  const now = new Date().toISOString();
  if (!record) {
    record = {
      uid: user.uid,
      email: user.email,
      name: "",
      createdAt: now,
      lastLogin: null,
      lastActive: null,
      loginCount: 0,
      provider: "password",
      isAdmin: !!user.isAdmin
    };
    users.push(record);
  }
  if (user.email) record.email = user.email;
  record.isAdmin = !!user.isAdmin;
  if (typeof fields.name === "string" && fields.name.trim()) record.name = truncate(fields.name.trim(), 100);
  if (fields.provider) record.provider = fields.provider;
  if (fields.login) { record.lastLogin = now; record.loginCount = (record.loginCount || 0) + 1; }
  record.lastActive = now;
  writeJson(usersFile, users);
  return record;
}

function recordActivity(uid, email, name, type, detail) {
  const activity = readJson(activityFile, []);
  activity.unshift({
    id: crypto.randomUUID(),
    uid: uid || null,
    email: email || "",
    name: name || "",
    type,
    detail: truncate(detail || "", 200),
    at: new Date().toISOString()
  });
  writeJson(activityFile, activity.slice(0, ACTIVITY_LIMIT));
}

// Admin accounts are tracked in their own file so they never appear in the
// student user list, but their login time is still shown in the Admins tab.
function recordAdminLogin(user) {
  const admins = readJson(adminsFile, []);
  let rec = admins.find(a => a.uid === user.uid);
  const now = new Date().toISOString();
  if (!rec) { rec = { uid: user.uid, email: user.email, firstSeen: now }; admins.push(rec); }
  rec.email = user.email;
  rec.lastLogin = now;
  rec.loginCount = (rec.loginCount || 0) + 1;
  writeJson(adminsFile, admins);
  return rec;
}

function isOnline(record) {
  if (!record || !record.lastActive) return false;
  return (Date.now() - new Date(record.lastActive).getTime()) < ONLINE_WINDOW_MS;
}

function publicUser(record) {
  return {
    uid: record.uid,
    name: record.name || "",
    email: record.email || "",
    provider: record.provider || "password",
    isAdmin: !!record.isAdmin,
    createdAt: record.createdAt || null,
    lastLogin: record.lastLogin || null,
    lastActive: record.lastActive || null,
    loginCount: record.loginCount || 0,
    online: isOnline(record)
  };
}
// Firebase Web API key (public identifier) used to verify client ID tokens.
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "";

// Admin accounts are identified by email. FIREBASE AUTH is the source of truth:
// a user is only admin if they hold a valid Firebase ID token AND their verified
// email is in this list. Change ADMIN_EMAILS in .env to grant/revoke access.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "admin@internshield.local")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

// Optional standard (non-SSO) administrator credential set in .env:
//   ADMIN_EMAIL + ADMIN_PASSWORD. It is disabled unless a password is set.
// Passwords are stored as a salted PBKDF2 hash (ADMIN_PASSWORD_HASH, preferred)
// or as plain text in ADMIN_PASSWORD for simple local setups.
function makeHash(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 210000, 32, "sha256").toString("hex");
}
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || ADMIN_EMAILS[0] || "").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_PASSWORD_SALT = process.env.ADMIN_PASSWORD_SALT || "";
const ADMIN_CREDENTIAL_ENABLED = !!ADMIN_EMAIL && (!!ADMIN_PASSWORD_HASH || !!ADMIN_PASSWORD);

function checkAdminPassword(password) {
  if (!password) return false;
  if (ADMIN_PASSWORD_HASH) {
    if (!ADMIN_PASSWORD_SALT) return false;
    const a = Buffer.from(makeHash(password, ADMIN_PASSWORD_SALT), "hex");
    const b = Buffer.from(ADMIN_PASSWORD_HASH, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (ADMIN_PASSWORD) {
    const a = Buffer.from(String(password));
    const b = Buffer.from(ADMIN_PASSWORD);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return false;
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC));

// Verify a Firebase ID token against Google's Identity Toolkit.
// Returns the account record on success, or null for any missing/invalid token.
async function verifyIdToken(idToken) {
  if (!idToken || !FIREBASE_API_KEY) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) }
    );
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.users) || !data.users.length) return null;
    const u = data.users[0];
    const email = (u.email || "").toLowerCase();
    return {
      uid: u.localId,
      email,
      name: u.displayName || "",
      provider: u.providerUserInfo && u.providerUserInfo.length ? u.providerUserInfo[0].providerId : "password",
      emailVerified: !!u.emailVerified,
      isAdmin: ADMIN_EMAILS.includes(email)
    };
  } catch { return null; }
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

// Require a valid signed-in user.
async function requireAuth(req, res, next) {
  const user = await verifyIdToken(bearer(req));
  if (!user) return res.status(401).json({ error: "Please sign in to continue." });
  req.user = user;
  next();
}

// A standard .env admin credential (email + password) gets its own signed-in
// session token, kept in memory. It only ever grants administrator access and
// never touches student data or the Firebase-backed user registry.
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const adminSessions = new Map();

function issueAdminSession(email) {
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, { email, createdAt: Date.now() });
  return token;
}
function readAdminSession(token) {
  const s = token && adminSessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > ADMIN_SESSION_TTL_MS) { adminSessions.delete(token); return null; }
  return s;
}

// Require an authenticated user who also has the admin role. Accepts either a
// Firebase ID token (email in ADMIN_EMAILS) or a standard .env admin session.
async function adminOnly(req, res, next) {
  const user = await verifyIdToken(bearer(req));
  if (user && user.isAdmin) { req.user = user; return next(); }
  const session = readAdminSession(bearer(req));
  if (session) {
    req.user = { uid: `local-admin:${session.email}`, email: session.email, name: "Administrator",
      provider: "password", emailVerified: true, isAdmin: true, local: true };
    return next();
  }
  if (user) return res.status(403).json({ error: "Administrator access required." });
  return res.status(401).json({ error: "Please sign in to continue." });
}

// Report whether a standard .env admin credential is configured, so the sign-in
// form can accept it. No SSO or fast-pass is offered for administrators.
app.get("/api/auth/admin-enabled", (req, res) => {
  res.json({ enabled: ADMIN_CREDENTIAL_ENABLED });
});

// Standard administrator sign-in: a normal username/email + password entered
// manually. Single sign-on and fast-pass methods are intentionally not offered.
app.post("/api/auth/admin-login", (req, res) => {
  if (!ADMIN_CREDENTIAL_ENABLED) {
    return res.status(403).json({ error: "Administrator sign-in is not configured on this server." });
  }
  const email = clean(req.body && req.body.email, 200).toLowerCase();
  const password = String((req.body && req.body.password) || "");
  const emailOk = email === ADMIN_EMAIL;
  const passwordOk = checkAdminPassword(password);
  if (!emailOk || !passwordOk) {
    return res.status(401).json({ error: "Incorrect administrator email or password." });
  }
  const token = issueAdminSession(ADMIN_EMAIL);
  recordAdminLogin({ uid: `local-admin:${ADMIN_EMAIL}`, email: ADMIN_EMAIL, name: "Administrator" });
  res.json({ token, email: ADMIN_EMAIL, name: "Administrator", role: "admin" });
});

// Confirm a standard admin session token is still valid.
app.get("/api/auth/admin-session", adminOnly, (req, res) => {
  res.json({ role: "admin", email: req.user.email, name: req.user.name });
});

// Invalidate a standard admin session token.
app.post("/api/auth/admin-logout", (req, res) => {
  const token = bearer(req);
  if (token) adminSessions.delete(token);
  res.json({ ok: true });
});

// Attach req.user when a valid token is present, but never block the request.
async function optionalAuth(req, res, next) {
  req.user = await verifyIdToken(bearer(req));
  next();
}

// Report whether Google sign-in is actually configured for this Firebase project.
app.get("/api/auth/google-enabled", async (req, res) => {
  if (!FIREBASE_API_KEY) return res.json({ enabled: false });
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${FIREBASE_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId: "google.com", continueUri: "http://localhost" }) }
    );
    const d = await r.json();
    res.json({ enabled: !!(r.ok && d.authUri) });
  } catch { res.json({ enabled: false }); }
});

// Report whether an email is already known, WITHOUT creating or signing in any
// account. This is what lets login show "This email is not registered." instead
// of a generic credential error.
//
// Two independent signals are combined:
//   1. Firebase's createAuthUri `registered` field — authoritative when present,
//      but it is omitted while Firebase's email-enumeration protection is ON.
//   2. Our own registry of accounts created through this app, keyed by verified
//      Firebase identities.
// `registered` is true/false only when a signal is confident, otherwise null so
// the client falls back to the real sign-in result instead of guessing.
app.get("/api/auth/check-email", async (req, res) => {
  const email = clean(req.query.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ registered: null, inRegistry: false, error: "Please enter a valid email address." });
  }
  const users = readJson(usersFile, []);
  const inRegistry = users.some(u => (u.email || "").toLowerCase() === email);

  let firebaseRegistered = null;
  if (FIREBASE_API_KEY) {
    try {
      const r = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${FIREBASE_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: email, continueUri: "http://localhost" }) }
      );
      const d = await r.json();
      if (r.ok && typeof d.registered === "boolean") firebaseRegistered = d.registered;
    } catch { /* fall through to registry signal */ }
  }

  // Firebase wins when it answers; otherwise a registry hit is a confident yes.
  const registered = firebaseRegistered !== null
    ? firebaseRegistered
    : (inRegistry ? true : null);

  res.json({ registered, inRegistry, firebase: firebaseRegistered });
});

// Server-verified session: confirms the token is valid and reports the role.
// A successful call also registers the user and, for genuine sign-in events,
// records login time plus an activity entry. role "admin" never counts as a
// student sign-in.
app.post("/api/auth/session", requireAuth, (req, res) => {
  const event = ["login", "signup", "google", "logout"].includes(req.body && req.body.event)
    ? req.body.event : null;
  const role = req.user.isAdmin ? "admin" : "student";
  const name = clean(req.body && req.body.name, 100) || req.user.name;
  let record = null;
  // Admin accounts are tracked separately and are not part of the student
  // user registry or activity feed.
  if (!req.user.isAdmin && event && event !== "logout") {
    const isLogin = event === "login" || event === "google";
    record = upsertUser(req.user, { name, provider: event === "google" ? "google.com" : undefined, login: isLogin });
    if (isLogin) {
      recordActivity(req.user.uid, req.user.email, record.name, "login",
        event === "google" ? "Signed in with Google" : "Signed in with email and password");
    } else if (event === "signup") {
      recordActivity(req.user.uid, req.user.email, record.name, "signup", "Created a student account");
    }
  } else if (!req.user.isAdmin && !event) {
    // Passive session restore / presence upsert: refresh last-active only.
    record = upsertUser(req.user, { name });
  } else if (req.user.isAdmin && (event === "login" || event === "google")) {
    // Admins are tracked separately; their sign-in never counts as a student.
    recordAdminLogin(req.user);
  }
  res.json({
    uid: req.user.uid,
    email: req.user.email,
    name: record ? record.name : (name || req.user.name),
    emailVerified: req.user.emailVerified,
    role
  });
});

// Kept for backward compatibility with any older client bundle.
app.get("/api/auth/session", requireAuth, (req, res) => {
  res.json({ uid: req.user.uid, email: req.user.email, emailVerified: req.user.emailVerified, role: req.user.isAdmin ? "admin" : "student" });
});

// Lightweight heartbeat so the dashboard can show who is online and last active.
app.post("/api/auth/heartbeat", requireAuth, (req, res) => {
  if (req.user.isAdmin) return res.json({ online: true });
  const record = upsertUser(req.user, {});
  res.json({ online: true, lastActive: record.lastActive });
});

// Explicit logout marker. The client then signs out of Firebase.
app.post("/api/auth/logout-event", optionalAuth, (req, res) => {
  if (req.user) {
    const name = clean(req.body && req.body.name, 100) || req.user.name;
    recordActivity(req.user.uid, req.user.email, name, "logout", "Signed out");
  }
  res.json({ ok: true });
});

function clean(value, max=5000) {
  return String(value || "").trim().slice(0, max);
}

function analyzeOffer(input) {
  const title = clean(input.title, 250);
  const company = clean(input.company, 250);
  const description = clean(input.description, 7000);
  const contact = clean(input.contact, 500);
  const link = clean(input.link, 1000);
  const combined = `${title} ${company} ${description} ${contact} ${link}`.toLowerCase();

  let score = 0;
  const signals = [];

  const add = (points, label, detail) => {
    score += points;
    signals.push({ points, label, detail });
  };

  if (/registration fee|application fee|processing fee|training fee|security deposit|pay.*internship|fee.*internship|₹\s?\d+|\brs\.?\s?\d+|\binr\s?\d+/i.test(combined)) {
    add(30, "Payment requested", "The offer appears to ask for money such as a registration, processing, training, or security fee.");
  }
  if (/guaranteed job|100% job|guaranteed placement|earn \d+.*day|earn.*daily|instant selection|selected without interview/i.test(combined)) {
    add(20, "Unrealistic promise", "The wording contains unusually strong guarantees or instant-selection claims.");
  }
  if (/whatsapp only|telegram only|contact.*whatsapp|message.*telegram/i.test(combined)) {
    add(12, "Informal contact channel", "The offer relies heavily on messaging apps rather than a verifiable company channel.");
  }
  if (/urgent|act now|limited seats|today only|within \d+ hours/i.test(combined)) {
    add(10, "Pressure language", "Urgency can make it harder for candidates to verify an offer independently.");
  }
  if (!company) add(8, "Missing company name", "A company name is needed for meaningful verification.");
  if (!description || description.length < 80) add(8, "Limited job details", "The internship description contains very little information.");
  if (!link) add(5, "No company/job link", "There is no website or job link to verify.");
  if (link && !/^https?:\/\//i.test(link)) add(7, "Unclear link format", "The supplied link does not look like a normal HTTP/HTTPS URL.");
  if (/@(gmail|yahoo|outlook|hotmail)\./i.test(contact)) {
    add(8, "Free email address", "A free mailbox can be legitimate, but an official company domain is easier to verify.");
  }
  if (/pay.*upi|upi.*pay|send.*otp|share.*otp|share.*password|bank details|card details/i.test(combined)) {
    add(35, "Sensitive information request", "The text appears to request money or sensitive account information.");
  }

  score = Math.min(100, score);
  let level = score >= 55 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";

  const advice = level === "HIGH"
    ? "Pause before responding. Do not pay or share passwords, OTPs, card/bank credentials, or identity documents until the organization is independently verified."
    : level === "MEDIUM"
      ? "Verify the company, recruiter, domain, job posting, and contact details using independent sources before proceeding."
      : "No major warning signals were detected by this basic checker. This is not proof that the internship is genuine; verify the organization independently.";

  return {
    score, level, signals, advice,
    checkedAt: new Date().toISOString(),
    disclaimer: "This tool provides a risk assessment, not a legal or definitive determination that an internship is fake."
  };
}

// Analysis is always available. Writing the submission record to the shared
// dashboard additionally requires a verified signed-in account, so the stored
// identity comes from the auth token rather than a user-supplied field.
app.post("/api/analyze", optionalAuth, (req,res) => {
  const result = analyzeOffer(req.body);
  if (req.user) {
    const submissions = readJson(submissionsFile, []);
    submissions.unshift({
      id: crypto.randomUUID(),
      uid: req.user.uid,
      studentName: clean(req.body.studentName,100) || req.user.email.split("@")[0],
      studentEmail: req.user.email,
      title: clean(req.body.title,250),
      company: clean(req.body.company,250),
      link: clean(req.body.link,1000),
      level: result.level,
      score: result.score,
      result,
      createdAt: new Date().toISOString()
    });
    writeJson(submissionsFile, submissions.slice(0, 1000));
  }
  res.json(result);
});

// A signed-in student's own history, matched by verified account id.
app.get("/api/my-analyses", requireAuth, (req,res) => {
  const rows = readJson(submissionsFile, []).filter(x => x.uid === req.user.uid);
  res.json(rows);
});

app.get("/api/admin/submissions", adminOnly, (req,res) => {
  res.json(readJson(submissionsFile, []));
});

app.get("/api/admin/stats", adminOnly, (req,res) => {
  const data = readJson(submissionsFile, []);
  const users = readJson(usersFile, []);
  const activity = readJson(activityFile, []);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  res.json({
    // Risk counts (existing keys preserved).
    total:data.length,
    high:data.filter(x=>x.level==="HIGH").length,
    medium:data.filter(x=>x.level==="MEDIUM").length,
    low:data.filter(x=>x.level==="LOW").length,
    // User statistics.
    usersTotal: users.length,
    usersOnline: users.filter(isOnline).length,
    usersOffline: users.filter(u => !isOnline(u)).length,
    usersActiveToday: users.filter(u => u.lastActive && new Date(u.lastActive).getTime() >= dayAgo).length,
    loginsToday: activity.filter(a => a.type === "login" && new Date(a.at).getTime() >= dayAgo).length
  });
});

// Full user list with presence and last-active, newest activity first.
app.get("/api/admin/users", adminOnly, (req,res) => {
  const users = readJson(usersFile, []);
  const list = users.map(publicUser).sort((a,b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return new Date(b.lastActive || 0) - new Date(a.lastActive || 0);
  });
  res.json(list);
});

// Login / logout / signup activity feed.
app.get("/api/admin/activity", adminOnly, (req,res) => {
  res.json(readJson(activityFile, []));
});

// The accounts that currently hold the admin role (from configured emails).
app.get("/api/admin/admins", adminOnly, (req,res) => {
  const admins = readJson(adminsFile, []);
  res.json(ADMIN_EMAILS.map(email => {
    const match = admins.find(a => (a.email||"").toLowerCase() === email);
    return { email, registered: !!match, lastLogin: match ? match.lastLogin : null, loginCount: match ? (match.loginCount||0) : 0 };
  }));
});

app.get("*", (req,res) => res.sendFile(path.join(PUBLIC, "index.html")));

app.listen(PORT, () => console.log(`InternShield running at http://localhost:${PORT}`));
