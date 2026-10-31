# Wiring IT'INIANZ up to Google Drive

This replaces Firebase entirely. Memories and album metadata live in
`notes.json`, comments on photos live with their photo records in `notes.json`,
calendar notes live in `events.json`, and the latest 100 in-app notifications
live in `notifications.json` inside a Drive folder you own. Each album has a
Drive subfolder where its photos are stored.

## 1. Create the Drive folder

Make a new folder in Google Drive (e.g. "IT'INIANZ Data"). Open it and copy
the ID out of the URL:

```
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
                                        \_____________ this part ____________/
```

## 2. Create the Apps Script project

1. Go to https://script.google.com → **New project**.
2. Delete the placeholder code and paste in the contents of `Code.gs`.
3. At the top of the file, set:
   - `FOLDER_ID` → the folder ID from step 1
   - `APP_TOKEN` → any long random string you make up (this is a shared
     secret the frontend sends with every request — it's not real user
     authentication, just a way to keep random internet traffic from
     hitting your endpoint)

## 3. Deploy it as a Web App

1. **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. Click **Deploy**, then **Authorize access** and approve the Drive
   permission it asks for (your script needs it to read/write the folder).
6. Copy the **Web app URL** — it ends in `/exec`.

If you ever edit `Code.gs`, you need to create a **new version** under
**Manage deployments** for the changes to go live at the same URL.

Photo comments can be created by any signed-in user, while edits and deletes
are checked against the comment author's Google email or Facebook account ID.
This owner check uses the app's current shared-token login model; it is not
strong authentication against a user who deliberately modifies the frontend.

## 4. Point the frontend at it

Open `config.js` and fill in:

```js
window.APP_CONFIG = {
  GAS_URL: "https://script.google.com/macros/s/AKfycb.../exec",
  APP_TOKEN: "the-same-random-string-you-put-in-Code.gs",
};
```

Upload `config.js`, `Code.gs` isn't needed on the web host (it only lives in
Apps Script) — upload the rest of the site (`index.html`, `login.html`,
`portfolio.html`, `style.css`, `app.js`, `config.js`) to wherever you're
hosting it.

## 5. Configure Google sign-in

In Google Cloud Console, open the OAuth client for the client ID used in
`login.html`. Under **Authorized JavaScript origins**, add the exact origin
used to open the site, for example:

```
http://127.0.0.1:3000
```

Add your production HTTPS origin there as well before deploying. Google will
reject sign-in from an origin that is not listed.

## 6. Try it

- Open `login.html` and sign in with the Google button.
- Create an album, then open it and upload one or more photos.
- Open the site on a second device (or an incognito window) and log in —
  it fetches the same `notes.json` and shows the same photo, served from
  Drive.

## How it works, briefly

- `GET ?action=getNotes` returns the parsed contents of `notes.json`.
- `POST {action:"createAlbum", album:{id,title,...}}` creates a Drive
  subfolder and adds its album record to `notes.json`.
- `POST {action:"renameAlbum", albumId:"...", title:"..."}` renames the
  Drive subfolder and its album record.
- `POST {action:"deleteAlbum", albumId:"..."}` removes the album, its photos,
  and its records from shared memories.
- `POST {action:"saveNotes", notes:[...]}` overwrites `notes.json` with the
  full array you send — the app always reads the latest copy right before
  writing, to reduce (but not fully eliminate) the chance of two devices
  clobbering each other if they save at the exact same moment.
- `GET ?action=getEvents` returns the shared calendar notes from `events.json`.
- `POST {action:"saveEvents", events:[...]}` overwrites the shared calendar
  notes. Each event stores its date/time in `startsAt` and its text in `note`.
- `POST {action:"uploadImage", albumId:"...", data:"data:image/...;base64,..."}` decodes
  the photo, saves it into that album's Drive subfolder, sets it to "anyone with the
  link can view," and returns a hotlink-friendly URL
  (`https://lh3.googleusercontent.com/d/<fileId>`) that gets stored on the
  note.
- `POST {action:"deleteImage", fileId:"..."}` trashes that Drive file when
  a memory (or its old photo) is deleted or replaced.
- The portfolio page polls every 20 seconds and also re-syncs whenever the
  tab regains focus or visibility, so a second device's edits show up
  without a manual refresh.

## Known limitations of this simple design

- **Not a real login.** The `admin` / `admin1234` check happens entirely in
  the browser, exactly as in the original app — anyone who opens the page
  and reads `app.js` can see the credentials and the `APP_TOKEN`. That's
  fine for a private link shared with your group, but don't treat it as
  secure against a motivated stranger.
- **Whole-file writes.** Because everything lives in one `notes.json`, two
  people saving at the exact same instant could still overwrite one
  another (last write wins). For a small group posting occasionally this
  is a non-issue; if you outgrow it, the natural upgrade is one JSON file
  per note instead of one shared array.
