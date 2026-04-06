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

## Deploy
```bash
cd /Users/andrewtesta/now-batting-landing
PATH="/usr/local/bin:$PATH" vercel --prod
```

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
