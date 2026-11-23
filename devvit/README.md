# floop — Devvit Subreddit Radar & Daily Digest App

**floop** runs natively inside Reddit via **Devvit Web + Mod Tools**, eliminating the need for external `reddit.com/prefs/apps` OAuth API keys.

## Features

- **Native Reddit API Discovery (Zero External Keys)**: Uses `@devvit/web/server`'s authenticated `reddit` client (`reddit.getSubredditInfoByName`, `reddit.getNewPosts`, `reddit.getRisingPosts`, `reddit.searchPosts`) plus an on-demand live subreddit lookup bar (`POST /api/subreddits/lookup`).
- **Real Unmodified Data**: Preserves exact Reddit `created_utc` timestamps, live subscriber counts, active counts, and omits unmeasured post/comment counts cleanly (`null`).
- **12 Categories Including NSFW & Adult**: Technology & AI, Gaming, Science & Engineering, Finance & Business, Entertainment & Media, Art & Design, Sports & Fitness, Memes & Humor, Lifestyle & Food, Music & Audio, Career & Education, and NSFW & Adult.
- **Devvit Mod Tool Menus & Forms**:
  - **Launch floop Subreddit Radar** — posts the interactive custom webview post (`dist/client/index.html`).
  - **Post Today's Subreddit Digest** — compiles today's newly created & hottest 90-day subreddits into a Reddit Markdown post.
  - **Subscribe to Daily Subreddit Alerts** — native Devvit form saving category alerts into Redis.
  - **floop: Sync Live Reddit Subreddits** — manually refreshes live Reddit community metadata into Redis.
- **Automated Daily Scheduler (`08:00 UTC`)**: Uses Devvit `scheduler` (`0 8 * * *`) + `redis` to deliver daily HTML digests via HTTPS email providers (`Resend` / `SendGrid`) or Reddit PM fallback.

## Fetch Domains

The following external domains are configured in `devvit.json` under `permissions.http.domains`:

- `arctic-shift.photon-reddit.com` — Optional supplementary read-only lookup of newly created public Reddit subreddits via Arctic Shift's public API.
- `api.resend.com` — Optional HTTPS email dispatch endpoint used when an admin provides a Resend API key in app settings to deliver daily category digests to opted-in subscribers.
- `api.sendgrid.com` — Optional fallback HTTPS email dispatch endpoint used when an admin provides a SendGrid API key in app settings.

## Setup, Playtest & Publish

```bash
cd devvit
npm install
npx devvit login
npm run dev
```

When you are ready to upload and publish for Reddit review:

```bash
npm run upload
npm run launch
```
