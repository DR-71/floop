# floop — Live Newly Created Subreddit Explorer & 90-Day Breakout Radar

Explore newly created subreddits live by category, subscriber thresholds, media support, and daily growth velocity (`+subs/day`), track the hottest breakout subreddits in the last 90 days, and automate daily email digests.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FDR-71%2Ffloop)

## Features

- **12 Precision-Classified Categories**: `Technology & AI`, `Gaming`, `Science & Engineering`, `Finance & Business`, `Entertainment & Media`, `Art & Design`, `Sports & Fitness`, `Memes & Humor`, `Lifestyle & Food`, `Music & Audio`, `Career & Education`, and `NSFW & Adult` (`18+`).
- **Radar Split View + Dedicated Views**: View **Newly Created Subreddits (Live)** and **Hottest New Subreddits (Last 90 Days)** side-by-side or in full-width grids.
- **Multi-Dimensional Filtering**: Filter by creation window (`24h`, `7d`, `30d`, `90d`), minimum subscribers, daily growth velocity (`+subs/day`), media support (`Media` vs. `Discussion`), `SFW Only` toggle, keyword search, and 5 sort modes.
- **24-Hour Daily Email Digest Automation**:
  - Sends an immediate welcome & first daily digest email on signup containing newly created subreddits in the subscriber's chosen category + the hottest new subreddits in the last 90 days.
  - Configured with **Vercel Cron Jobs** ([`vercel.json`](./vercel.json) → `/api/automations/cron` at `0 8 * * *`) and `node-cron` for local/server deployments.
  - Supports **Live Nodemailer Sandbox SMTP** out of the box, plus **Gmail / Custom SMTP**, **Resend API**, **SendGrid API**, and **Automation Webhooks** (Make / Zapier / n8n).

## Optional Environment Variables on Vercel

| Variable | Description |
| :--- | :--- |
| `REDDIT_CLIENT_ID` | Optional Reddit OAuth app client ID for live `/subreddits/new.json` polling without cloud IP blocks |
| `REDDIT_CLIENT_SECRET` | Optional Reddit OAuth app client secret (paired with `REDDIT_CLIENT_ID`) |
| `RESEND_API_KEY` | Optional Resend API key (`re_...`) for direct inbox delivery |
| `RESEND_FROM` | Verified Resend sender email (defaults to `onboarding@resend.dev`) |
| `SMTP_HOST` | Optional custom SMTP host (defaults to `smtp.gmail.com`) |
| `SMTP_PORT` | Optional custom SMTP port (defaults to `587`) |
| `SMTP_USER` | Optional SMTP username / Gmail address |
| `SMTP_PASS` | Optional SMTP password / Gmail 16-char App Password |
| `SMTP_FROM` | Optional full `From` header (e.g. `floop <noreply@yourdomain.com>`) |
| `FLOOP_FROM_EMAIL` | Optional sender email override when using generic `floop` branding |
| `FLOOP_FROM_NAME` | Optional sender display name (defaults to `floop`) |
| `SENDGRID_API_KEY` | Optional SendGrid v3 API key |
| `KV_REST_API_URL` | Optional Upstash / Vercel KV REST URL for persistent alerts & digest logs |
| `KV_REST_API_TOKEN` | Optional Upstash / Vercel KV REST token |
| `FLOOP_WEBHOOK_URL` | Optional webhook URL triggered on every daily digest dispatch |

## Local Development

```bash
npm install
npm run dev
```
