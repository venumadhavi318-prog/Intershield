# InternShield

InternShield is a full-stack web app that helps students assess internship offers for suspicious signals.

## Stack
- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js + Express
- Storage: JSON files (easy to understand for an interview assignment)
- Authentication: Firebase Authentication (email/password + Google); the
  Express backend verifies every ID token before serving protected data
- AI/API: Optional. The included detector works without an external API.

## Run
1. Install Node.js.
2. Open a terminal in this folder.
3. Run:
   npm install
   npm start
4. Open http://localhost:3000

## Accounts
- Students sign up with name + email + password, or use Google sign-in.
- Login never creates an account. If the email is not registered the form
  shows "This email is not registered. Please sign up first."
- The admin dashboard is separate and always server-verified.

## Admin
The admin console at `/admin.html` is protected by its own standard sign-in
form (username/email + a single password field with a show-password toggle and
a secure password-recovery link). Google/single sign-on and any fast-pass
method are intentionally not offered for administrators. A signed-in account is
treated as admin only when its verified email is listed in `ADMIN_EMAILS`
(see `.env`). The server enforces this on every admin API call, so the role
cannot be granted from the browser.

There are two ways in, both server-verified:

1. Firebase administrator — a normal Firebase Auth account whose email is in
   `ADMIN_EMAILS`. Default demo admin: `admin@internshield.local` /
   `Admin@12345`.
2. Standard .env credential — set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`
   and the same sign-in form accepts those. It is disabled while
   `ADMIN_PASSWORD` is blank. For local setups a plain password is fine; for
   anything shared, store a hash instead:
   ```
   node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log('ADMIN_PASSWORD_SALT='+s);console.log('ADMIN_PASSWORD_HASH='+c.pbkdf2Sync('your-password',s,210000,32,'sha256').toString('hex'))"
   ```
   Put the two printed values in `.env` and leave `ADMIN_PASSWORD` blank.

Password recovery uses Firebase's time-limited password-reset email. The
confirmation message is always generic, so it never reveals whether an address
is registered.

The admin dashboard shows user statistics (total / online / offline / active
today / logins today), a searchable user list (by name or email), the login
activity feed (who signed in or out, and when), last-active times, and the
existing risk statistics for recent checks. Presence is derived from a periodic
heartbeat while a page is open.

## Configuration
Copy `.env.example` to `.env`. The relevant values are `FIREBASE_API_KEY`
(used by the backend to verify Firebase ID tokens), `ADMIN_EMAILS`, and `PORT`.
See `FIREBASE_SETUP.md` for the full Firebase setup.

## API
The backend exposes:
POST /api/analyze             (open; records the check when a token is supplied)
GET  /api/auth/check-email    (is an email known? never creates/signs in an account)
POST /api/auth/session        (verifies an ID token; records login/signup events)
POST /api/auth/heartbeat      (refreshes presence / last-active)
POST /api/auth/logout-event   (records a sign-out)
GET  /api/auth/session        (legacy: verify a token, returns the role)
GET  /api/auth/google-enabled (reports whether Google sign-in is configured)
GET  /api/my-analyses         (a signed-in user's own checks)
GET  /api/admin/submissions   (admin only)
GET  /api/admin/stats         (admin only; risk + user statistics)
GET  /api/admin/users         (admin only; users with presence + last active)
GET  /api/admin/activity      (admin only; login / logout / signup feed)
GET  /api/admin/admins        (admin only; configured admin accounts)

The `/api/analyze` endpoint uses a transparent rule-based scoring engine. This is intentional: the project runs without paid API keys.

## Optional AI upgrade
You can later connect Gemini/OpenAI in the backend. Keep the API key only in a server-side `.env` file; never put it in frontend JavaScript.


## Firebase edition
Firebase Authentication provides student signup/login and Google sign-in.
Analysis history is stored by the Express backend and returned from
`/api/my-analyses`. See `FIREBASE_SETUP.md`.


## Scroll-Driven Hero Assignment Features
The homepage now includes the requested animation-focused assignment layer:
- Full first-screen hero section with letter-spaced headline.
- Percentage impact metrics with staggered entrance/count-up animation.
- GSAP + ScrollTrigger initial-load and scroll-driven motion.
- Main InternShield visual moves, scales and rotates from scroll progress.
- A dedicated scroll-story section demonstrates Detect → Verify → Decide motion.
- Uses transform-based animation and `scrub` interpolation for smooth scrolling.
- Respects `prefers-reduced-motion`.
- Existing internship checker, Firebase student history, authentication, and admin dashboard are preserved.
