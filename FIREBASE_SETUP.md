# Firebase setup

Authentication is handled by Firebase Authentication. The Express backend
verifies every Firebase ID token with Google before it serves protected data.

1. Create a Firebase project.
2. Authentication → Sign-in method:
   - Enable **Email/Password**.
   - Enable **Google** (the "Continue with Google" button is shown only when
     this provider is actually enabled).
3. Create a Web App and copy its Firebase config into:
   `public/js/firebase-config.js`
4. Copy `.env.example` to `.env` and set:
   - `FIREBASE_API_KEY` — the same Web API key (a public client identifier used
     by the backend to verify ID tokens).
   - `ADMIN_EMAILS` — comma-separated emails that hold the admin role.
   `PORT` and the optional `GEMINI_API_KEY` are the only other values.
5. Run the project:
   npm install
   npm start
6. Open http://localhost:3000

## Admin
Admin access is not a password and is not stored in the browser. A user is an
admin only if they sign in with Firebase **and** their verified email is listed
in `ADMIN_EMAILS`. The server checks this on every `/api/admin/*` request, so
changing the URL or localStorage cannot grant access. To create the first admin,
register that email through the normal sign-up form (or the Firebase console)
and add it to `ADMIN_EMAILS`.

## Account data
Signed-in users' checks are stored server-side and returned to the matching
account from `/api/my-analyses`. The security rules in `firestore.rules` and
`storage.rules` are not required by the current Express backend; keep them only
if you extend the client to talk to Firestore/Storage directly.

## Gemini
No Gemini key is required for the included detector. If you add Gemini, call it
from the Express backend and store the key in `.env`, never in frontend code.
