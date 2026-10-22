# Now Batting — Landing Page Brief

## What this is
Marketing landing page for **Now Batting** (nowbattingapp.com). Static HTML/CSS/JS — no framework, no build step. Deployed to Vercel.

---

## Key facts
| Thing | Value |
|---|---|
| Live URL | https://nowbattingapp.com |
| Vercel project | `now-batting-landing` (drewtesta-5778s-projects) |
| Repo | `/Users/andrewtesta/now-batting-landing` |
| Files | `index.html`, `vercel.json` |

---

## Fonts & design system
- **Bebas Neue** — headlines (via Google Fonts)
- **DM Sans** — body copy
- CSS variables: `--bg: #06080F`, `--red: #D01426`, `--gold: #D4AF37`, `--green: #22C55E`, `--txt2: #8099B4`

---

## vercel.json — important proxy
```json
{
  "rewrites": [
    { "source": "/join/:id", "destination": "https://walkup-hero.vercel.app/join/:id" }
  ]
}
```
This makes `nowbattingapp.com/join/XXXXXXXX` work as share links. The actual web handler lives in the `walkup-hero` Vercel project. **Don't remove this rewrite.**

---

## /get — smart redirect + attribution (`api/get.ts`)
`/get` is permanent: the printed QR and every social bio link point at it. iPhone → App Store, Android → `/get/android` waitlist, desktop → homepage (UTMs kept).
- Bio links: `/get?utm_source=<tiktok|instagram|youtube|facebook>&utm_medium=social&utm_campaign=bio`. iPhone visitors get Apple campaign tokens `pt=128645121&ct=<source>-<campaign>&mt=8`, so App Store Connect → Campaigns counts downloads per link.
- PostHog: `social_link_tap` when `utm_medium=social`, else `qr_scan`. Token from `POSTHOG_PROJECT_TOKEN` (Production only).
- Measurement canon: `walkup-hero/docs/30-growth/social/measurement.md`.

## Deploy
⚠️ Vercel serves every file in this folder, dot-files included. Anything repo-only (this file, `.claudeignore`, `.github/`) must be listed in `.vercelignore` — they were all public until 2026-10-16. Check a new repo-only file with `curl -I https://www.nowbattingapp.com/<file>` after deploying.

🔴 **`git pull --rebase` FIRST, every time.** The NB20 chart workflow in `.github/` **commits to this repo every Monday (11:20 UTC)**, and `vercel --prod` ships the working tree, not the remote — so deploying from a stale checkout silently un-publishes whatever the Action wrote. That happened on 2026-10-22: `top-walk-up-songs/chart.json` served the 10-12 chart for four minutes while 10-19 was live, **and the iOS app reads that file**, so every Music Hub NB20 card showed the wrong week. It surfaced only because the later `git push` was rejected.

```bash
cd /Users/andrewtesta/now-batting-landing
git pull --rebase
PATH="/usr/local/bin:$PATH" vercel --prod
```

After deploying, confirm the chart did not move: `curl -s https://www.nowbattingapp.com/top-walk-up-songs/chart.json | python3 -c "import sys,json;print(json.load(sys.stdin)['chartDate'])"`

---

## Page sections (in order)
1. **Nav** — logo + social links + App Store CTA button
2. **Hero** — headline, sub, email signup form, app screenshot
3. **How it works** — 3-step visual (Set the lineup / Drop the song / Game day)
4. **Soundboard feature** — shows the in-game playback UI
5. **Just Shipped** — two feature cards: Share Your Roster + Multiple Teams
6. **Closer** — TestFlight beta signup with email form

---

## "Just Shipped" feature cards
- **Share Your Roster** — green SVG share icon, shows 8-char import code demo
- **Multiple Teams** — red SVG people icon, shows team switcher demo
  - League names: **Rec League / Travel / House League** (youth-focused, not Varsity/JV)

---

## Email signups
Handled by a `signup()` JS function inline in the HTML. Sends to a backend endpoint. There are two signup forms (hero + closer).

---

## Relationship to the app repo
The app lives at `/Users/andrewtesta/walkup-hero`. That repo also has a `vercel.json` for its own Vercel project (`walkup-hero.vercel.app`), which hosts all the API endpoints. The landing page and app backend are **separate Vercel projects**.
