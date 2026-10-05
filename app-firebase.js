import {
  auth, watchAuth, logoutStudent, signupStudent, loginStudent, googleSignIn,
  authErrorMessage, isValidEmail, checkEmailRegistered
} from "./js/firebase.js";
import { startSession, recordLogout, startHeartbeat } from "./js/session-activity.js";

let isSignup = false, currentUser = null, currentToken = null;
let stopHeartbeat = () => {};
const $ = id => document.getElementById(id);
const modal = $("authModal");

/* ------------------------------------------------------------------ *
 * Session state. Login state is owned by Firebase; the button is only
 * updated from a real onAuthStateChanged event, never set by hand.
 * ------------------------------------------------------------------ */
function updateLoginButton() {
  const b = $("loginBtn");
  if (!b) return;
  if (currentUser) {
    b.textContent = "Logout";
    b.onclick = async () => {
      // Mark the logout in the activity feed before Firebase clears the session.
      await recordLogout(currentUser);
      stopHeartbeat();
      await logoutStudent();
    };
  } else {
    b.textContent = "Login";
    b.onclick = () => openAuth(false);
  }
}

watchAuth(async user => {
  currentUser = user;
  stopHeartbeat();
  if (user) {
    try { currentToken = await user.getIdToken(); } catch { currentToken = null; }
    // Restore/refresh the server-side session and presence. A page load is not
    // a new sign-in, so no login event is recorded here.
    await startSession(user, null);
    stopHeartbeat = startHeartbeat(user);
    // Signed-in users receive email-verification mail at signup; surface it once.
    if (isSignup && user.emailVerified === false && $("authMsg")) {
      $("authMsg").textContent = "Account created. A verification email has been sent to your inbox.";
    }
  } else {
    currentToken = null;
  }
  updateLoginButton();
  updateHistoryLink();
});
updateLoginButton();

// Show the "My checks" link only for signed-in students.
function updateHistoryLink() {
  const link = $("historyLink");
  if (!link) return;
  link.hidden = !currentUser;
}

/* ------------------------------------------------------------------ *
 * Internship checker (existing functionality preserved)
 * ------------------------------------------------------------------ */
$("checkerForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("formMsg").textContent = "Analyzing…";
  const payload = { title: $("title").value, company: $("company").value, contact: $("contact").value, link: $("link").value, description: $("description").value };
  try {
    const headers = { "Content-Type": "application/json" };
    if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
    const r = await fetch("/api/analyze", { method: "POST", headers, body: JSON.stringify(payload) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Analysis failed");
    renderResult(data);
    $("formMsg").textContent = currentUser ? "Analysis complete. Saved to your history." : "Analysis complete. Login to save your history.";
  } catch (err) { $("formMsg").textContent = err.message; }
});

function renderResult(d) {
  const r = $("result"); r.className = "panel result";
  r.innerHTML = `<p class="eyebrow">ANALYSIS COMPLETE</p>
  <div class="riskBadge ${d.level.toLowerCase()}">${d.level} RISK</div>
  <div class="score">${d.score}<small>/100</small></div>
  <p>${esc(d.advice)}</p><div class="signals">${d.signals.length ? d.signals.map(x => `<div class="signal"><b>⚠️ ${esc(x.label)} <small>(+${x.points})</small></b><span>${esc(x.detail)}</span></div>`).join("") : "<div class='signal'><b>✓ No major warning signals detected</b><span>Still verify the company independently.</span></div>"}</div>
  <p><small>${esc(d.disclaimer)}</small></p>`;
}
function esc(s) { return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

/* ------------------------------------------------------------------ *
 * Auth modal
 * ------------------------------------------------------------------ */
$("toggleAuth").onclick = () => openAuth(!isSignup);
document.querySelector("[data-close]").onclick = () => modal.classList.add("hidden");
modal.addEventListener("click", e => { if (e.target === modal) modal.classList.add("hidden"); });

function openAuth(signup) {
  isSignup = signup;
  $("authTitle").textContent = signup ? "Create Student Account" : "Student Login";
  $("nameWrap").classList.toggle("hidden", !signup);
  $("authPassword").setAttribute("autocomplete", signup ? "new-password" : "current-password");
  $("toggleAuth").textContent = signup ? "Already have an account? Login" : "Create a student account";
  $("authForm").querySelector('button[type="submit"]').textContent = signup ? "Create account" : "Continue";
  $("authMsg").textContent = ""; modal.classList.remove("hidden");
}

$("authForm").onsubmit = async e => {
  e.preventDefault();
  const msg = $("authMsg");
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const name = $("authName").value.trim();

  if (!isValidEmail(email)) { msg.textContent = "Please enter a valid email address."; return; }
  if (isSignup) {
    if (!name) { msg.textContent = "Please enter your full name."; return; }
    if (password.length < 6) { msg.textContent = "Please choose a password of at least 6 characters."; return; }
  } else if (!password) {
    msg.textContent = "Please enter your password."; return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  msg.textContent = isSignup ? "Creating your account…" : "Signing in…";
  try {
    if (isSignup) {
      const user = await signupStudent(name, email, password);
      // Register the new student and record the signup in the activity feed.
      const session = await fetchSession(await user.getIdToken(), "signup");
      if (session && session.role === "admin") {
        modal.classList.add("hidden");
        location.href = "/admin.html";
        return;
      }
      // Keep the modal open so the "verify your email" notice is visible.
      msg.textContent = user.emailVerified
        ? "Account created. You are signed in."
        : "Account created. A verification email has been sent to your inbox.";
    } else {
      // Administrators sign in through this same form. The credential configured
      // on the server (.env) is accepted first; on success the admin panel opens
      // directly with a server-issued session.
      const adminToken = await tryAdminCredential(email, password);
      if (adminToken) {
        try { localStorage.setItem("internshield.adminToken", adminToken); } catch { /* ignore */ }
        modal.classList.add("hidden");
        location.href = "/admin.html";
        return;
      }
      // Login must never create an account. Confirm the email is already
      // registered before attempting sign-in, so an unregistered address gets a
      // clear message instead of a generic credential error.
      const { registered, inRegistry } = await checkEmailRegistered(email);
      if (registered === false) {
        msg.textContent = "This email is not registered. Please sign up first.";
        return;
      }
      try {
        const user = await loginStudent(email, password);
        // Role comes from the server, which verifies the Firebase token. A
        // non-admin can never reach the dashboard by changing URL or storage.
        const session = await fetchSession(await user.getIdToken(), "login");
        if (session && session.role === "admin") {
          modal.classList.add("hidden");
          location.href = "/admin.html";
          return;
        }
        modal.classList.add("hidden");
        return;
      } catch (err) {
        // Firebase cannot distinguish an unregistered email from a wrong
        // password. When this app has no record of the account either, treat it
        // as unregistered; otherwise report the honest credential error.
        if (!inRegistry && isUnregisteredCode(err)) {
          msg.textContent = "This email is not registered. Please sign up first.";
        } else {
          msg.textContent = authErrorMessage(err);
        }
        return;
      }
    }
  } catch (err) {
    msg.textContent = authErrorMessage(err);
  } finally {
    submitBtn.disabled = false;
  }
};

function isUnregisteredCode(err) {
  const code = (err && err.code) || "";
  return code === "auth/invalid-credential" || code === "auth/invalid-login-credentials";
}

// Check the credential configured on the server (.env). Returns a session token
// for administrators, or null for everyone else so the normal login continues.
async function tryAdminCredential(email, password) {
  try {
    const r = await fetch("/api/auth/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    if (r.ok) {
      const d = await r.json();
      if (d && d.token) return d.token;
    }
  } catch { /* not an admin credential — fall through */ }
  return null;
}

async function fetchSession(token, event) {
  try {
    const r = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ event: event || null, name: currentUser ? (currentUser.displayName || "") : "" })
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/* ------------------------------------------------------------------ *
 * Google sign-in — shown only when the provider is actually configured
 * ------------------------------------------------------------------ */
fetch("/api/auth/google-enabled")
  .then(r => r.json())
  .then(d => {
    if (d && d.enabled) {
      $("googleSection").hidden = false;
      $("googleBtn").hidden = false;
    }
  })
  .catch(() => { /* leave hidden on failure */ });

$("googleBtn").onclick = async () => {
  const msg = $("authMsg");
  msg.textContent = "";
  try {
    const user = await googleSignIn();
    const session = await fetchSession(await user.getIdToken(), "google");
    if (session && session.role === "admin") { location.href = "/admin.html"; return; }
    modal.classList.add("hidden");
  } catch (err) {
    msg.textContent = authErrorMessage(err);
  }
};

/* ------------------------------------------------------------------ *
 * Show / hide password (independent control, value preserved)
 * ------------------------------------------------------------------ */
document.querySelectorAll(".pwToggle").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = $(btn.dataset.target);
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    btn.setAttribute("aria-pressed", String(show));
    btn.querySelectorAll(".eyeOpen").forEach(el => el.style.display = show ? "none" : "");
    btn.querySelectorAll(".eyeOff").forEach(el => el.style.display = show ? "" : "none");
  });
});

/* Mobile navigation toggle */
(function initNav() {
  const btn = $("menuBtn"), nav = $("primaryNav");
  if (!btn || !nav) return;
  const close = () => { nav.classList.remove("open"); btn.classList.remove("isOpen"); btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    btn.classList.toggle("isOpen", open);
    btn.setAttribute("aria-expanded", String(open));
  });
  nav.addEventListener("click", e => { if (e.target.closest("a")) close(); });
})();
