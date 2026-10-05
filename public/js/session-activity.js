// Shared session/activity helper used by every page.
//
// - startSession(): asks the backend to register the user and, for a real
//   sign-in event, record login time + activity, then reports the server-side
//   role back to the caller.
// - recordLogout(): best-effort activity marker before signing out.
// - startHeartbeat(): keeps the user's "last active" fresh while a page is open,
//   which is what drives the online/offline state on the admin dashboard.
//
// Identity is always proven by a Firebase ID token; nothing here is trusted by
// the server on its own.

async function post(path, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(path, { method: "POST", headers, body: JSON.stringify(body || {}) });
  return r;
}

export async function startSession(user, event) {
  try {
    const token = await user.getIdToken();
    const name = user.displayName || "";
    const r = await post("/api/auth/session", token, { event: event || null, name });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function recordLogout(user) {
  if (!user) return;
  try {
    const token = await user.getIdToken();
    await post("/api/auth/logout-event", token, { name: user.displayName || "" });
  } catch { /* best effort */ }
}

// Send one heartbeat now, then every `everyMs` while the tab stays open.
export function startHeartbeat(user, everyMs = 45000) {
  if (!user) return () => {};
  let stopped = false;
  const ping = async () => {
    if (stopped) return;
    try {
      const token = await user.getIdToken();
      await post("/api/auth/heartbeat", token, {});
    } catch { /* ignore */ }
  };
  ping();
  const id = setInterval(ping, everyMs);
  return () => { stopped = true; clearInterval(id); };
}
