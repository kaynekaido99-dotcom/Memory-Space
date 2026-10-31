# YOUR CLASS SECTION — Group Memory Portfolio

<img width="1160" height="902" alt="image" src="https://github.com/user-attachments/assets/4eefed15-e5d6-4f2f-a2a2-f68023a0db39" />
<img width="780" height="693" alt="image" src="https://github.com/user-attachments/assets/feb3db78-a3e1-4b46-b2ba-c21f646c3932" />
<img width="1244" height="872" alt="image" src="https://github.com/user-attachments/assets/b1bd4df6-d547-4cd9-96e7-0dc0e6bcf0a9" />
<img width="574" height="575" alt="image" src="https://github.com/user-attachments/assets/54d176d5-1536-4627-bef9-e6275b620d7b" />



A shared digital memory space for a class, batch, or group. Members sign in with **Google** or **Facebook**, then upload photos into albums, react, comment, and add events to a shared calendar. A bell icon notifies everyone when someone else posts something new.

There is **no server to run and no database to pay for**. The frontend is plain HTML/CSS/JS (host it free on GitHub Pages), and **Google Drive + Google Apps Script** act as the backend and database.



---

## Features

- **Google and Facebook sign-in** (Google Identity Services and Facebook Login SDK)
- **Albums and photos** — create, rename, and delete albums; upload pictures into them
- **Reactions and comments** on every photo
- **Group calendar** — shared events and notes by month
- **Notification bell** — shows what other members created, uploaded, commented, or reacted to, with unread badge, mark as read/unread, and delete
- **Cross-device sync** — auto-refreshes every 60 seconds and when the tab regains focus
- **Installable** — web app manifest for "Add to Home Screen" on iOS and Android
- **Google Drive storage** — all data is stored as JSON and image files in your own Drive folder

## How it works

```
 Browser (GitHub Pages)                         Your Google account
┌────────────────────────┐   fetch (GET/POST)  ┌───────────────────────────┐
│ index / login / portfolio│ ─────────────────▶ │ Apps Script Web App       │
│ app.js · style.css      │   + APP_TOKEN       │ (Code.gs)                 │
│ config.js               │ ◀───────────────── │   │                       │
└──────────┬─────────────┘       JSON           │   ▼                       │
           │ sign-in                            │ Google Drive folder       │
           ▼                                    │  ├─ notes.json            │
   Google / Facebook OAuth                      │  ├─ events.json           │
                                                │  ├─ notifications.json    │
                                                │  └─ <album folders>/photos│
                                                └───────────────────────────┘
```

## Project structure

| File | Purpose |
|---|---|
| `index.html` | Landing page |
| `login.html` | Google / Facebook sign-in page |
| `portfolio.html` | Main app: albums, photos, calendar, notifications |
| `app.js` | All frontend logic (auth, API calls, rendering, notifications) |
| `style.css` | Styling |
| `config.js` | **Your backend URL and token** (`GAS_URL`, `APP_TOKEN`) |
| `Code.gs` | Google Apps Script backend (paste this into script.google.com) |
| `manifest.json` / `icon.png` | PWA / home-screen icon settings |

---

## Setup guide (fresh install)

You will create **four things** and paste their values into the code:

| # | Service | You get | Goes into |
|---|---|---|---|
| 1 | Google Cloud Console | OAuth **Client ID** | `app.js` and `login.html` |
| 2 | Facebook Developers | **App ID** | `app.js` |
| 3 | Google Drive | Folder **ID** | `Code.gs` |
| 4 | Google Apps Script | **Web app URL** + your own **token** | `config.js` and `Code.gs` |

Start by cloning the repo:

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

### Step 1 — Google OAuth Client ID

Console: <https://console.cloud.google.com/>

1. Click the project picker (top bar) → **New Project** → name it (e.g. `class-portfolio`) → **Create**, then select it.
2. Open **APIs & Services → OAuth consent screen** (newer consoles call this **Google Auth Platform**).
   - **User type / Audience:** `External`
   - Fill in the app name, support email, and developer contact email.
   - While the app is in **Testing**, only emails listed under **Test users** can sign in. Add your members, or click **Publish app** to let anyone with a Google account sign in. The default scopes (`email`, `profile`, `openid`) don't need Google verification.
3. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - **Application type:** `Web application`
   - **Authorized JavaScript origins** (add every place the site runs, with no trailing slash and no path):
     ```
     http://localhost:3000
     https://<your-username>.github.io
     ```
     If you use a different local port (e.g. 3004), add that origin too.
   - **Authorized redirect URIs:** leave empty (the sign-in uses the popup flow).
4. Click **Create** and copy the **Client ID** (it ends with `.apps.googleusercontent.com`).
5. Paste it in **two places**:

   `app.js`

   ```javascript
   var GOOGLE_CLIENT_ID = "CHANGE_ME";
   ```

   `login.html` (the `data-client_id` attribute)

   ```html
   <div id="g_id_onload"
        data-client_id="CHANGE_ME"
        ...>
   ```

> Changes to authorized origins can take a few minutes (occasionally longer) to apply.

### Step 2 — Facebook App ID

Console: <https://developers.facebook.com/>

1. Log in → **My Apps → Create App**.
2. Choose the use case **Authenticate and request data from users with Facebook Login**, name the app, and create it.
3. Go to **App settings → Basic**:
   - Copy the **App ID**.
   - Add your site domain to **App domains** (e.g. `<your-username>.github.io`).
   - Add a **Privacy Policy URL** (required to go Live).
4. Open **Facebook Login → Settings** (add the **Facebook Login** product if it isn't listed):
   - Turn **Login with the JavaScript SDK** → **On**.
   - Add to **Allowed Domains for the JavaScript SDK**:
     ```
     https://<your-username>.github.io
     http://localhost:3000
     ```
   - Keep **Client OAuth Login** and **Web OAuth Login** on.
5. The app starts in **Development mode**, where only people with a role on the app (Admin, Developer, Tester) can sign in. Add testers under **App roles → Roles**, or switch the app to **Live** (toggle at the top of the dashboard) to let anyone sign in.
6. Paste the App ID in `app.js`:

   ```javascript
   var FACEBOOK_APP_ID = "CHANGE_ME";
   ```

The app requests the `public_profile` and `email` permissions, both available without App Review.

### Step 3 — Google Drive folder (your database)

Drive: <https://drive.google.com/drive/folders/>

1. Create a new folder (e.g. `class-portfolio-data`).
2. Open it. The URL looks like this:
   ```
   https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
   ```
3. Copy the part after `/folders/`. That is your **FOLDER_ID**.

`Code.gs` creates `notes.json`, `events.json`, `notifications.json`, and one sub-folder per album inside this folder automatically.

### Step 4 — Google Apps Script backend

Console: <https://script.google.com/>

1. Click **New project** and name it.
2. Delete the default code, then paste the entire contents of `Code.gs`.
3. **Generate your own secret token** (any long random string). For example:
   ```bash
   openssl rand -hex 32
   # or
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. Fill in the config at the top of `Code.gs`:

   ```javascript
   var CONFIG = {
     FOLDER_ID: 'CHANGE_ME',
     NOTES_FILENAME: 'notes.json',
     EVENTS_FILENAME: 'events.json',
     NOTIFICATIONS_FILENAME: 'notifications.json',
     APP_TOKEN: 'CHANGE_ME'
   };
   ```

5. Click **Deploy → New deployment**, then the gear icon → **Web app**:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
6. Click **Deploy** and approve the permissions. If Google shows "unverified app", choose **Advanced → Go to *project name* (unsafe)**. It is your own script.
7. Copy the **Web app URL** (it ends in `/exec`).

> **Every time you edit `Code.gs`, you must redeploy:** **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** The `/exec` URL stays the same. Saving the file alone does not update the live web app.

### Step 5 — Connect the frontend

Open `config.js` and paste the URL from Step 4 and the **same token** you put in `Code.gs`:

```javascript
window.APP_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec',
  APP_TOKEN: 'CHANGE_ME'   // must exactly match CONFIG.APP_TOKEN in Code.gs
};
```

`app.js` reads these two values from `config.js`. The fallbacks in `app.js` are only used if `config.js` is missing:

```javascript
var GAS_URL = cfg.GAS_URL || "CHANGE_ME";
var APP_TOKEN = cfg.APP_TOKEN || "CHANGE_ME";
```

### Step 6 — Personalize

Search the project for these placeholders and replace them:

- `YOUR CLASS SECTION` — your group's name (HTML pages, `manifest.json`, `app.js`)
- `"ADD YOUR UNIVERSITY"` / `"UNIVERSITY"` — your school (`index.html`)
- `YOUR_LINK` — Messenger, Facebook page, and developer links in the `index.html` footer
- `icon.png` — add your own 512×512 PNG next to the HTML files

---

## Configuration checklist

| Value | File | Where it comes from |
|---|---|---|
| `GOOGLE_CLIENT_ID` | `app.js` **and** `login.html` (`data-client_id`) | Google Cloud → Credentials |
| `FACEBOOK_APP_ID` | `app.js` | Facebook Developers → App settings → Basic |
| `CONFIG.FOLDER_ID` | `Code.gs` | Drive folder URL |
| `CONFIG.APP_TOKEN` | `Code.gs` | You generate it |
| `APP_TOKEN` | `config.js` | **Same** string as `CONFIG.APP_TOKEN` |
| `GAS_URL` | `config.js` | Apps Script → Deploy → Web app URL |

## Run locally

Google sign-in only works from a real origin, so don't open the HTML files by double-clicking. Serve the folder:

```bash
# Python
python3 -m http.server 3000

# or Node
npx serve -l 3000

# or use the VS Code "Live Server" extension
```

Then open <http://localhost:3000/index.html> and make sure that exact origin (`http://localhost:3000`) is listed in Step 1 and Step 2.

## Deploy to GitHub Pages

1. Push the project to GitHub.
2. **Settings → Pages → Build and deployment → Deploy from a branch** → choose `main` and `/ (root)` → **Save**.
3. After a minute your site is at `https://<your-username>.github.io/<your-repo>/`.
4. Add `https://<your-username>.github.io` to the **Google authorized JavaScript origins** and the **Facebook allowed domains** (Steps 1 and 2).

Using a custom domain? Add that domain in the same places.

## Notifications

When a member uploads a photo, creates or renames an album, comments, reacts, or adds a calendar event, `Code.gs` appends a record to `notifications.json` (the latest 100 are kept). Every other member's browser polls for new records and shows an unread badge on the bell.

- You never receive notifications for your own actions.
- Read, unread, and deleted state is stored **per user, per browser** (`localStorage`), so clearing browser data resets it.

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| `Error 400: origin_mismatch` on Google sign-in | The current URL isn't in **Authorized JavaScript origins**. Add the exact origin (scheme + host + port). |
| Google button doesn't appear | `data-client_id` in `login.html` still says `CHANGE_ME`, or the page is opened as `file://`. |
| `Error 403: access_denied` from Google | App is in *Testing* and your email isn't a **Test user**, or publish the app. |
| Facebook login popup closes or errors | App is in Development mode and you have no role on it, or the domain isn't in **Allowed Domains for the JavaScript SDK**. Facebook may also require HTTPS outside localhost. |
| "Backend not configured yet" toast | `config.js` still contains `CHANGE_ME`, or it isn't loaded before `app.js`. |
| `Unauthorized` from the backend | `APP_TOKEN` in `config.js` doesn't exactly match `CONFIG.APP_TOKEN` in `Code.gs`. |
| Backend changes have no effect | You didn't deploy a **New version** of the web app (Step 4). |
| Notification bell stays empty | Make sure you're using the latest `app.js` and `Code.gs`. Notifications are only created by *other* users' actions. |
| CORS or "Failed to fetch" errors | Web app access must be **Anyone**, and `GAS_URL` must be the `/exec` URL (not `/dev`). |

## Security notes

This project is designed for a **small, trusted group** and is not hardened for sensitive data.

- `APP_TOKEN` is a shared secret that ships inside the frontend JavaScript. Anyone who can open the site can read it, so it only deters casual abuse and is **not real authentication**.
- Uploaded photos are served through public Drive view links.
- Google OAuth client IDs and Facebook App IDs are public by design, but never commit client secrets, and rotate `APP_TOKEN` if the repo is public and you've ever committed a real one.
- Keep real values out of git history if you can: commit placeholders (`CHANGE_ME`) and keep your real `config.js` local, or rotate the token after publishing.

Don't store private or sensitive information in this app.

## Tech stack

HTML · CSS · Vanilla JavaScript · Google Identity Services · Facebook Login SDK · Google Apps Script · Google Drive · Font Awesome

## Contributing

Issues and pull requests are welcome. Please open an issue first to discuss major changes.

## License

[MIT]
