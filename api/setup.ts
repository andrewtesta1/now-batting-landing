// /setup/:id — the parent link. Serves the static setup.html with the link-preview tags made
// to match the team's SPORT, which a static page cannot do: Messages reads og:image before any
// JavaScript runs, so a basketball team's link previewed as the baseball card (Andrew, 2026-11-13).
//
// Basketball → the And Now card (walkup-hero /api/site-og?brand=andnow, via /og-andnow.png).
// Anything else, or any failure at all → the page exactly as it is today. The form's own
// JavaScript still reads the sport and draws the right form; this only changes the preview.

const API = 'https://walkup-hero.vercel.app';
const PAGE = 'https://www.nowbattingapp.com/setup';

let cachedPage = null; // the static HTML, kept warm between calls on the same instance

async function staticPage() {
  if (cachedPage && Date.now() - cachedPage.at < 5 * 60 * 1000) return cachedPage.html;
  const r = await fetch(PAGE);
  if (!r.ok) throw new Error('page ' + r.status);
  const html = await r.text();
  cachedPage = { html, at: Date.now() };
  return html;
}

async function sportFor(id) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(`${API}/api/roster-intake?id=${encodeURIComponent(id)}&form=1`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.sport === 'basketball' ? 'basketball' : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  const id = String((req.query && req.query.id) || '').slice(0, 16).replace(/[^A-Za-z0-9]/g, '');
  let html;
  try { html = await staticPage(); }
  catch {
    // Never strand a parent: fall back to the plain page path (no id-specific preview).
    res.statusCode = 302; res.setHeader('Location', '/setup?id=' + encodeURIComponent(id)); return res.end();
  }
  if (id && (await sportFor(id)) === 'basketball') {
    html = html
      .replace('https://nowbattingapp.com/og.png', 'https://nowbattingapp.com/og-andnow.png')
      .replace('<title>Set up your player\'s walk-up music — Now Batting</title>', '<title>Add your player — And Now</title>');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  return res.end(html);
}
