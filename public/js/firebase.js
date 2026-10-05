import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile, sendEmailVerification,
  GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-analytics.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Analytics is optional and only runs in browser contexts that support it.
export const analyticsReady = isSupported()
  .then(supported => (supported ? getAnalytics(app) : null))
  .catch(() => null);

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

// Ask the backend whether an email is a known account. This uses Firebase's
// account lookup plus the app's own registry and NEVER creates or signs in an
// account. `registered` is true/false when confident, otherwise null.
export async function checkEmailRegistered(email) {
  const unknown = { registered: null, inRegistry: false };
  try {
    const r = await fetch(`/api/auth/check-email?email=${encodeURIComponent(String(email).trim())}`);
    if (!r.ok) return unknown;
    const d = await r.json();
    return {
      registered: typeof d.registered === "boolean" ? d.registered : null,
      inRegistry: !!d.inRegistry
    };
  } catch { return unknown; }
}

// Translate Firebase error codes into clear, user-friendly messages. Internal
// codes are never shown. Where Firebase deliberately cannot distinguish two
// causes (wrong password vs. unregistered email) a single honest message is
// returned instead of guessing, which also prevents account enumeration.
export function authErrorMessage(err) {
  const code = (err && err.code) || "";
  switch (code) {
    case "auth/invalid-email":
    case "auth/missing-email":        return "Please enter a valid email address.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
                                      return "Incorrect email or password. Please check your details and try again.";
    case "auth/email-already-in-use": return "An account with this email already exists.";
    case "auth/weak-password":        return "Please choose a password of at least 6 characters.";
    case "auth/too-many-requests":    return "Too many attempts. Please wait a moment and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request": return "Google sign-in was cancelled.";
    case "auth/popup-blocked":        return "Your browser blocked the sign-in popup. Please allow popups and try again.";
    case "auth/account-exists-with-different-credential":
                                      return "An account already exists with this email using a different sign-in method.";
    case "auth/operation-not-allowed": return "This sign-in method is not enabled.";
    case "auth/unauthorized-domain":   return "Google sign-in is not available on this domain. Add it to Firebase Authentication → Settings → Authorized domains, or use email and password.";
    case "auth/network-request-failed": return "Network error. Please check your connection and try again.";
    default:                          return "Something went wrong. Please try again.";
  }
}

export async function signupStudent(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) { try { await updateProfile(cred.user, { displayName: name }); } catch { /* non-fatal */ } }
  // Only sent when the project has email verification configured; a failure
  // here does not block account creation.
  try { await sendEmailVerification(cred.user); } catch { /* optional */ }
  return cred.user;
}

export async function loginStudent(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// Send a secure, time-limited Firebase password reset link to the account's
// email. Callers should always show a generic confirmation so the response does
// not reveal whether an address is registered (no account enumeration).
export async function sendPasswordReset(email) {
  const { sendPasswordResetEmail } = await import("https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js");
  await sendPasswordResetEmail(auth, String(email || "").trim());
}

export async function googleSignIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function logoutStudent() { await signOut(auth); }
export function watchAuth(callback) { return onAuthStateChanged(auth, callback); }
