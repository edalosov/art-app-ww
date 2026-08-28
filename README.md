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
- **In-app preview** — a small embedded preview of the current link, with an
  "Open ↗" fallback for sites that block being shown in an iframe.
- **Manage tab** — add/remove links, see which ones have already been shown.
- Everything is stored locally on your device (`localStorage`) — no account,
  no server, no data leaves your phone.

## Deploying it so you can install it on your iPhone

This is a static site (plain HTML/CSS/JS, no build step), so the easiest way
to get an `https://` URL you can install from is GitHub Pages:

1. Push this branch (or merge it into your default branch).
2. In the repo: **Settings → Pages → Build and deployment → Source** = "Deploy
   from a branch", pick the branch and `/ (root)` folder, save.
3. Wait a minute for GitHub to publish it, then open the given
   `https://<user>.github.io/<repo>/` URL on your iPhone in Safari.

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

Note: some sites (OpenSea included, depending on the page) block being shown
inside another app's preview frame for security reasons. When that happens
the preview area will look blank — just tap **Open ↗** to view the link in a
full browser tab instead; copying still works normally either way.
