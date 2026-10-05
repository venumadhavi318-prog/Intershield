# InternShield — repository notes

Full-stack internship-scam checker: Node.js + Express backend, vanilla
HTML/CSS/JS frontend, Firebase Authentication.

## Run and test
- `npm install && npm start` → http://localhost:3000 (PORT from `.env`).
- `server.js` loads `.env` with a small built-in parser (no dotenv dependency).
- Browser tests use Playwright (`pip install playwright`; Chromium is at
  `/usr/bin/chromium`, launch with `--no-sandbox`).

## Authentication architecture (important)
- Firebase Authentication is the source of truth. The client signs in with the
  Firebase JS SDK (email/password + Google popup).
- The backend verifies every Firebase ID token via Google Identity Toolkit
  (`accounts:lookup`) using `FIREBASE_API_KEY`. See `verifyIdToken` in `server.js`.
- Admin is a server-side role: a signed-in account is admin only when its
  verified email is in `ADMIN_EMAILS` (`.env`). Never trust the browser for
  authorization; `/api/admin/*` uses the `adminOnly` middleware.
- Never reintroduce a client-only login or a shared admin key. Firebase auth
  state is not kept in localStorage. The one exception is the opaque,
  server-issued, revocable session token for the optional `.env` admin
  credential (see `ADMIN_KEY` in `public/admin.html`); it is validated against
  `/api/auth/admin-session` before the dashboard is shown and carries no
  credential material.

## Endpoints
`POST /api/analyze` (open; records the check when a token is present),
`GET /api/auth/check-email`, `POST /api/auth/session`, `POST /api/auth/heartbeat`,
`POST /api/auth/logout-event`, `GET /api/auth/session` (legacy),
`GET /api/auth/google-enabled`, `GET /api/my-analyses`,
`GET /api/auth/admin-enabled`, `POST /api/auth/admin-login`,
`GET /api/auth/admin-session`, `POST /api/auth/admin-logout`,
`GET /api/admin/submissions`, `GET /api/admin/stats`, `GET /api/admin/users`,
`GET /api/admin/activity`, `GET /api/admin/admins`.

## Users, presence, and activity
- Registries live in `data/`: `users.json` (students), `admins.json` (admin
  sign-ins), `activity.json` (login/logout/signup feed). All are keyed by the
  verified Firebase `uid`/`email`; never trust a user-supplied identity.
- `POST /api/auth/session` upserts the user and records login/signup events.
  Admin accounts are excluded from the student registry/feed and tracked in
  `admins.json`. The client sends `event` = login|signup|google|null.
- Presence: the client pings `POST /api/auth/heartbeat` immediately and every
  ~45s (`public/js/session-activity.js`). A user is "online" if `lastActive` is
  within `ONLINE_WINDOW_MS` (2 min) — see `isOnline` in `server.js`.
- Login must never create an account. `GET /api/auth/check-email` reports
  registration using Firebase's `createAuthUri.registered` when present, falling
  back to the app registry. "This email is not registered. Please sign up first."
  is shown when `registered === false` or (no registry record and Firebase
  returns invalid-credential). Do not force a password reset to probe accounts.
- Admin UI: `public/admin.html` has tabs (Users / Login activity / Recent checks
  / Admins), user search by name or email, and presence badges. Guard is the
  server-verified role; never trust localStorage.
- Admin sign-in is a dedicated standard form (`#adminLogin`): username/email +
  a single password field (show-password toggle), an explicit submit button, and
  a secure recovery link (`sendPasswordReset`, from `public/js/firebase.js`).
  It must NOT offer Google/SSO or any fast-pass, and it is shown until the
  server-verified role check succeeds; the dashboard (`#adminDashboard`) stays
  hidden. Recovery always reports a generic result (no account enumeration).
- The form first tries the optional `.env` credential via
  `POST /api/auth/admin-login` (`ADMIN_EMAIL` + `ADMIN_PASSWORD`, or a
  `ADMIN_PASSWORD_HASH`/`ADMIN_PASSWORD_SALT` pair; disabled when unset), then
  falls back to the Firebase admin path (`POST /api/auth/session`). `adminOnly`
  accepts either a Firebase ID token or a local admin session token.

## Preview / deployment
- Public preview: run `PORT=12000 node server.js`; the work-1 host maps to port 12000.
- Google sign-in (popup) fails with `auth/unauthorized-domain` until the serving
  domain is added in Firebase → Authentication → Settings → Authorized domains.
  Email/password login is unaffected.

## Gotchas
- The hamburger (`.menuBars`) uses three `<i>` children; it is shown only at
  `max-width:980px` as `display:flex` and animated to an X via `.isOpen`.
- `public/index.html` autoplay/scroll animations live in `public/js/animations.js`.
- Keep edits minimal and preserve the existing visual design unless asked.
