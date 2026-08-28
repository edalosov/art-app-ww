# Art Link Rotator

A tiny installable web app for quickly copying OpenSea (or any) links over to a
digital art frame app. Save a batch of links once; every time you open the
app it hands you the next one you haven't seen yet, with a copy button and a
small in-app preview, so you don't have to dig back through OpenSea each time.

- **New link on every open** — links are shown in a shuffled, non-repeating
  order. Once every link has been shown once, a new shuffled cycle starts
  automatically (you can also force a reshuffle with "Reset cycle").
- **One-tap copy** — the "Copy link" button puts the URL straight on your
  clipboard, ready to paste into the frame app.
- **In-app preview** — shows the link's own preview image (the same one
  Slack/Twitter/iMessage use for "link unfurling"), fetched through a small
  serverless function so it works even for sites like OpenSea that block
  being shown directly in an iframe. Falls back to an iframe, then an
  "Open ↗" button, if a site has no preview image.
- **Manage tab** — add/remove links, see which ones have already been shown.
- **Cloud sync (optional)** — connect your computer and your iPhone with a
  shared sync code so a link added on one shows up on the other. Off by
  default; everything stays local-only (`localStorage`) until you turn it on.

## Deploying it so you can install it on your iPhone

This is mostly a static site (plain HTML/CSS/JS, no build step) plus one
small serverless function (`api/preview.js`) that powers the in-app preview
image. **Vercel** picks both up automatically with zero configuration — just
connect the GitHub repo in the Vercel dashboard and it deploys on every
push. (Plain GitHub Pages also works for everything except the preview
image, since it only serves static files and can't run `api/preview.js` —
previews would fall back to the plain iframe/`Open ↗` behavior there.)

## Installing on iPhone

1. Open the site's URL in **Safari** (must be Safari, not Chrome, for the
   "Add to Home Screen" install flow to work).
2. Tap the **Share** icon → **Add to Home Screen** → **Add**.
3. Launch it from the home screen icon like any other app — it opens full
   screen, no browser chrome.

## Using it

1. Open the app, go to the **Manage** tab, and paste in your OpenSea links
   (a label is optional, otherwise it shows the site's hostname).
2. Switch to the **Link** tab — it already picked a link for you.
3. Tap **Copy link**, switch to your digital frame app, paste it in.
4. Close the app. Next time you open it, you'll get a different, not-yet-seen
   link (until the whole list has cycled through, then it reshuffles and
   starts again).

Note: the preview normally shows the link's own preview image (see below).
On the rare page that has neither a preview image nor allows being framed,
the preview area will look blank — just tap **Open ↗** to view the link in a
full browser tab instead; copying still works normally either way.

## Syncing links between your computer and your iPhone

By default each device keeps its own local list. To share one list between
devices, this app can sync through a free Firebase (Firestore) database —
your data, your own free Google-backed project, no cost.

### One-time setup (do this once, from any computer)

1. Go to <https://console.firebase.google.com/>, sign in with a Google
   account, and click **Add project**. Give it any name, and you can skip
   Google Analytics (not needed).
2. Once the project is created, click the **`</>`** (web) icon on the project
   overview page to register a web app. Give it any nickname — you don't need
   Firebase Hosting.
3. Firebase will show you a `firebaseConfig` object with values like
   `apiKey`, `authDomain`, `projectId`, etc. Copy that whole block.
4. In the left sidebar go to **Build → Firestore Database → Create database**.
   Choose any region close to you, and start in **production mode** (we set
   our own rules next).
5. Open the **Rules** tab of Firestore and replace the contents with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /syncedLinkLists/{code} {
         allow read, write: if true;
       }
       match /{document=**} {
         allow read, write: if false;
       }
     }
   }
   ```

   This only opens up the one collection this app uses. Anyone who has both
   your Firebase config *and* your specific sync code (a long random string,
   generated in the app — see below) could read or change that one document,
   so treat the sync code like a password and don't share it. There's
   nothing sensitive in the data itself (just link URLs), so this trade-off
   keeps setup simple.
6. Click **Publish** on the rules.
7. Send me (Claude) the `firebaseConfig` values from step 3 and I'll paste
   them into `firebase-config.js` and push the update — after that, cloud
   sync will be available in the app's Manage tab.

### Using it day to day

1. On your **first** device (say, your computer), open the app's Manage tab
   and tap **Start syncing (create code)**. It generates a sync code and
   uploads your current link list to the cloud under that code.
2. Copy the sync code shown, open the app on your **iPhone**, go to Manage,
   paste the code into "Or paste a sync code from your other device", and
   tap **Connect**. (If the phone already had its own local links, you'll be
   asked to confirm since they'll be replaced by the synced list.)
3. From then on, adding or removing a link on either device updates the
   shared list automatically. The iPhone still gets a fresh, not-yet-seen
   link every time you open it — that "seen" state is shared too, so you
   won't get a repeat just because you last saw it on the other device.

You can disconnect a device at any time from the Manage tab ("Disconnect
this device") — its local list stays as it was, it just stops syncing.
