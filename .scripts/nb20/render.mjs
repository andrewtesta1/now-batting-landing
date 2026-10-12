#!/usr/bin/env node
/**
 * render.mjs — builds The Now Batting 20 pages from the saved weekly snapshots.
 *
 *   node .scripts/nb20/render.mjs
 *
 * Writes:
 *   top-walk-up-songs/index.html               the current chart   → /top-walk-up-songs
 *   top-walk-up-songs/<monday>.html            one page per week   → /top-walk-up-songs/2026-10-12
 *
 * Reads:
 *   data/nb20/snapshots/*.json   one file per published week (written by generate.mjs)
 *   data/nb20/editorial.json     optional, hand-written "Best 15 seconds" notes
 *
 * Runs in the Vercel buildCommand BEFORE build-seo.mjs (which deletes .scripts/ from the
 * output), and the result is also committed — same convention as build-seo's JSON-LD.
 *
 * It never invents a row. No snapshots → an honest "first chart drops Monday" page. A week
 * page exists only for a week that has a snapshot. History columns appear only when there is
 * history behind them, and a missing value renders as nothing, never as 0.
 */

import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withHistory, mondayOnOrBefore, nyToday, addDays, MIN_CHOS, WINDOW_DAYS } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNAP_DIR = join(ROOT, 'data', 'nb20', 'snapshots');
const EDITORIAL = join(ROOT, 'data', 'nb20', 'editorial.json');
const SLUG = 'top-walk-up-songs';
const SITE = 'https://www.nowbattingapp.com';
const APP_STORE = 'https://apps.apple.com/app/now-batting/id6760744461';

// ── helpers ──────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (ymd, withYear = true) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`;
};
const fmtRange = (a, b) => (a.slice(0, 4) === b.slice(0, 4)
  ? `${fmtDay(a, false)} – ${fmtDay(b)}` : `${fmtDay(a)} – ${fmtDay(b)}`);
const fmtStamp = (iso) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d);
  return `${day}, ${time} ET`;
};
const pad2 = (n) => String(n).padStart(2, '0');

async function loadSnapshots() {
  let files = [];
  try { files = (await readdir(SNAP_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)); } catch { /* none yet */ }
  const out = [];
  for (const f of files) {
    try {
      const s = JSON.parse(await readFile(join(SNAP_DIR, f), 'utf8'));
      if (s && s.chartDate && Array.isArray(s.entries)) out.push(s);
      else console.warn(`  nb20: skipping malformed snapshot ${f}`);
    } catch (e) { console.warn(`  nb20: skipping unreadable snapshot ${f}: ${e.message}`); }
  }
  return out.sort((a, b) => a.chartDate.localeCompare(b.chartDate));
}

/** Editorial notes render only when complete AND marked verified. Nothing is ever filled in. */
async function loadEditorial() {
  try {
    const raw = JSON.parse(await readFile(EDITORIAL, 'utf8'));
    const ok = {};
    for (const [key, v] of Object.entries(raw.songs || {})) {
      if (v && v.verified === true && /^\d{1,2}:\d{2}$/.test(String(v.start || '')) && String(v.why || '').trim()) {
        ok[key] = { start: String(v.start), why: String(v.why).trim() };
      }
    }
    return ok;
  } catch { return {}; }
}

// ── pieces ───────────────────────────────────────────────────────────────────

const WAVE = (fill = '#B8CC00', h = 28) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="88 -1 80 62" height="${h}" aria-hidden="true" focusable="false"><rect x="93.03" y="24" width="6.3" height="12" rx="3.15" fill="${fill}"/><rect x="102.83" y="18" width="6.3" height="24" rx="3.15" fill="${fill}"/><rect x="112.63" y="10.5" width="7" height="39" rx="3.5" fill="${fill}"/><rect x="123.13" y="0" width="8.75" height="60" rx="4.38" fill="${fill}"/><rect x="135.38" y="9" width="7.7" height="42" rx="3.85" fill="${fill}"/><rect x="146.58" y="16.5" width="6.65" height="27" rx="3.32" fill="${fill}"/><rect x="156.73" y="22.5" width="6.65" height="15" rx="3.32" fill="${fill}"/></svg>`;

function movementCell(e, hasPrev) {
  if (!hasPrev || !e.movement) return '<span class="mv mv-none" aria-hidden="true"></span>';
  const m = e.movement;
  if (m.type === 'up') return `<span class="mv mv-up"><span aria-hidden="true">↑ ${m.by}</span><span class="sr">Up ${m.by} from last week</span></span>`;
  if (m.type === 'down') return `<span class="mv mv-down"><span aria-hidden="true">↓ ${m.by}</span><span class="sr">Down ${m.by} from last week</span></span>`;
  if (m.type === 'same') return `<span class="mv mv-same"><span aria-hidden="true">—</span><span class="sr">Same spot as last week</span></span>`;
  if (m.type === 'new') return `<span class="mv mv-new"><span aria-hidden="true">NEW</span><span class="sr">New this week</span></span>`;
  return `<span class="mv mv-re"><span aria-hidden="true">RE-ENTRY</span><span class="sr">Back on the chart</span></span>`;
}

function art(e, size = 52) {
  if (e.artwork) return `<img class="art" src="${esc(e.artwork)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`;
  return `<span class="art art-empty" aria-hidden="true">${WAVE('#DFFF00', 18)}</span>`;
}

function row(e, { hasPrev, showWeeks, editorial }) {
  const meta = [];
  if (hasPrev && e.lastWeek != null) meta.push(`<span class="mi">Last week ${e.lastWeek}</span>`);
  if (showWeeks) meta.push(`<span class="mi">${e.weeksOnChart}${e.weeksCensored ? '+' : ''} ${e.weeksOnChart === 1 && !e.weeksCensored ? 'week' : 'weeks'}</span>`);
  if (e.cleanEdit) meta.push('<span class="mi tag">Clean edit</span>');
  const listen = e.appleMusicUrl
    ? `<a class="listen" href="${esc(e.appleMusicUrl)}" target="_blank" rel="noopener" aria-label="Listen to ${esc(e.title)} by ${esc(e.artist)} on Apple Music">Apple Music <span aria-hidden="true">↗</span></a>` : '';
  const ed = editorial[e.key];
  const best = ed ? `
        <details class="best"><summary>Best 15 seconds · starts at ${esc(ed.start)}</summary><p>${esc(ed.why)}</p></details>` : '';
  return `
      <li class="row${e.rank === 1 ? ' row-one' : ''}">
        <span class="rank" aria-label="Number ${e.rank}">${pad2(e.rank)}</span>
        ${art(e)}
        <div class="song">
          <p class="title">${esc(e.title)}</p>
          <p class="artist">${esc(e.artist)}</p>
          ${meta.length ? `<p class="meta">${meta.join('')}</p>` : ''}${listen ? `<p class="links">${listen}</p>` : ''}${best}
        </div>
        ${movementCell(e, hasPrev)}
      </li>`;
}

function highlight(h) {
  const e = h.entry;
  const label = { 'number-one': 'This week’s No. 1', climber: 'Biggest climber', new: 'New to the lineup' }[h.kind];
  const sub = h.kind === 'climber' ? `Up ${e.movement.by} to No. ${e.rank}`
    : h.kind === 'new' ? `Debuts at No. ${e.rank}`
    : e.movement?.type === 'same' ? 'Holds the top spot'
    : e.movement?.type === 'up' ? `Up ${e.movement.by} to No. 1`
    : e.movement?.type === 'new' ? 'Debuts at No. 1'
    : 'Leading off';
  return `
      <div class="hl hl-${h.kind}">
        <p class="hl-label">${label}</p>
        <p class="hl-title">${esc(e.title)}</p>
        <p class="hl-artist">${esc(e.artist)}</p>
        <p class="hl-sub">${sub}</p>
      </div>`;
}

const NAV = `<nav>
  <a href="/" style="display:flex;align-items:center;line-height:1;text-decoration:none;" aria-label="Now Batting home">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 60" height="28" aria-hidden="true"><text x="0" y="44" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="36" fill="#1F1F1F" letter-spacing="-1">now</text><circle cx="80.53" cy="30" r="3.5" fill="#1F1F1F"/><rect class="bar b1" x="93.03" y="24" width="6.3" height="12" rx="3.15" fill="#B8CC00"/><rect class="bar b2" x="102.83" y="18" width="6.3" height="24" rx="3.15" fill="#B8CC00"/><rect class="bar b3" x="112.63" y="10.5" width="7.0" height="39" rx="3.5" fill="#B8CC00"/><rect class="bar b4" x="123.13" y="0" width="8.75" height="60" rx="4.38" fill="#B8CC00"/><rect class="bar b5" x="135.38" y="9" width="7.7" height="42" rx="3.85" fill="#B8CC00"/><rect class="bar b6" x="146.58" y="16.5" width="6.65" height="27" rx="3.32" fill="#B8CC00"/><rect class="bar b7" x="156.73" y="22.5" width="6.65" height="15" rx="3.32" fill="#B8CC00"/><circle cx="175.88" cy="30" r="3.5" fill="#1F1F1F"/><text x="188.38" y="44" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="36" fill="#1F1F1F" letter-spacing="-1">batting</text></svg>
  </a>
  <div class="nav-links">
    <a href="/our-story" class="nav-link">Our Story</a>
    <a href="/how-to-run-walk-up-songs" class="nav-link">Field Guide</a>
    <a href="/top-walk-up-songs" class="nav-link active" aria-current="page">Top 20</a>
    <a href="/support" class="nav-link">Support</a>
  </div>
  <div class="nav-right">
    <a href="${APP_STORE}" class="nav-btn">Download</a>
  </div>
</nav>`;

const FOOTER = `<footer>
  <div class="f-logo"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 60" height="20" aria-label="Now Batting"><text x="0" y="44" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="36" fill="#1F1F1F" letter-spacing="-1">now</text><circle cx="80.53" cy="30" r="3.5" fill="#1F1F1F"/><rect x="93.03" y="24" width="6.3" height="12" rx="3.15" fill="#B8CC00"/><rect x="102.83" y="18" width="6.3" height="24" rx="3.15" fill="#B8CC00"/><rect x="112.63" y="10.5" width="7.0" height="39" rx="3.5" fill="#B8CC00"/><rect x="123.13" y="0" width="8.75" height="60" rx="4.38" fill="#B8CC00"/><rect x="135.38" y="9" width="7.7" height="42" rx="3.85" fill="#B8CC00"/><rect x="146.58" y="16.5" width="6.65" height="27" rx="3.32" fill="#B8CC00"/><rect x="156.73" y="22.5" width="6.65" height="15" rx="3.32" fill="#B8CC00"/><circle cx="175.88" cy="30" r="3.5" fill="#1F1F1F"/><text x="188.38" y="44" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="36" fill="#1F1F1F" letter-spacing="-1">batting</text></svg></div>
  <p class="f-copy">© 2026 Chief Hype Officer LLC · <a href="/our-story">Our Story</a> · <a href="/how-to-run-walk-up-songs">Field Guide</a> · <a href="/support">Support</a> · <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms</a></p>
</footer>`;

const HOW = `
    <section class="how" id="how-the-chart-works" aria-labelledby="how-h">
      <h2 id="how-h">How the chart works</h2>
      <dl>
        <dt>What counts</dt>
        <dd>A pick: someone searches Apple Music in the Now Batting song editor and chooses a song for a player. Songs added through the parent link, a roster import or a shared roster aren’t counted.</dd>
        <dt>The window</dt>
        <dd>Each weekly chart reflects four weeks of song selections, ending Sunday at midnight Eastern time.</dd>
        <dt>How it ranks</dt>
        <dd>By how many different Now Batting users picked a song. Picking it for five players still counts once, so one very busy team can’t carry a song. Ties go to total picks, then to the most recent week. A song needs at least ${MIN_CHOS} users to chart.</dd>
        <dt>Versions</dt>
        <dd>A single, an album cut and a clean edit of the same song count together, and the row links to the version picked most. Explicit versions aren’t counted or shown.</dd>
        <dt>When it updates</dt>
        <dd>Every Monday morning. “Last week” compares against the previous Monday’s chart; a song’s first appearance is marked NEW, a return is RE-ENTRY.</dd>
        <dt>Weeks on the chart</dt>
        <dd>Counts every weekly chart a song has made. A plus, like “5+ weeks”, means the song was already on our earliest chart, so it may have been charting longer than our records go back.</dd>
        <dt>Privacy</dt>
        <dd>We publish rankings only. No counts, no player or team names, nothing about who picked what.</dd>
      </dl>
    </section>`;

const MORE = `
    <section class="more" aria-labelledby="more-h">
      <h2 id="more-h">More for the parent with the speaker</h2>
      <ul>
        <li><a href="/how-to-run-walk-up-songs">The Chief Hype Officer Field Guide</a> — set up a walk-up roster, custom announcements, batting order from a photo.</li>
        <li><a href="/offline">Run walk-up music with no service</a> — get Field Ready before you leave home.</li>
        <li><a href="/">What Now Batting does</a> — walk-up songs, your own announcer, the Hype Deck.</li>
      </ul>
    </section>`;

const CTA = `
    <section class="cta" aria-labelledby="cta-h">
      <h2 id="cta-h">Found their next walk-up?</h2>
      <p>Drop it in Now Batting, set the exact second it hits, and let the announcer call their name before it does.</p>
      <a class="cta-btn" href="${APP_STORE}">Get Now Batting</a>
    </section>`;

// ── page ─────────────────────────────────────────────────────────────────────

function page({ chart, isCurrent, allDates, editorial, nextMonday }) {
  const canonical = isCurrent ? `${SITE}/${SLUG}` : `${SITE}/${SLUG}/${chart?.chartDate}`;
  const n = chart?.entries.length || 0;
  const h1 = !chart ? 'This Week’s Top 20 Walk-Up Songs'
    : isCurrent ? `This Week’s Top ${n < 20 ? n : 20} Walk-Up Songs`
    : `Top ${n < 20 ? n : 20} Walk-Up Songs · Week of ${fmtDay(chart.chartDate)}`;
  const title = isCurrent || !chart ? 'Top 20 Walk-Up Songs This Week | Now Batting'
    : `Top 20 Walk-Up Songs, Week of ${fmtDay(chart.chartDate)} | Now Batting`;
  const desc = chart
    ? `The Now Batting 20: the walk-up songs picked by the most Now Batting users over the ${WINDOW_DAYS} days to ${fmtDay(chart.window.end)}. ${chart.entries[0] ? `No. 1: ${chart.entries[0].title} by ${chart.entries[0].artist}. ` : ''}New chart every Monday.`
    : 'The Now Batting 20: the walk-up songs picked by the most Now Batting users, ranked every Monday with Apple Music links.';

  const hasPrev = Boolean(chart?.hasPrev);
  const showWeeks = (chart?.historyWeeks || 0) >= 2;

  const jsonld = chart && n ? `
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `The Now Batting 20 — week of ${fmtDay(chart.chartDate)}`,
    description: `Walk-up songs ranked by how many Now Batting users picked them, ${fmtRange(chart.window.start, chart.window.end)}.`,
    url: canonical, numberOfItems: n,
    itemListElement: chart.entries.map((e) => ({
      '@type': 'ListItem', position: e.rank,
      item: { '@type': 'MusicRecording', name: e.title, byArtist: { '@type': 'MusicGroup', name: e.artist }, ...(e.appleMusicUrl ? { url: e.appleMusicUrl } : {}) },
    })),
  }).replace(/</g, '\\u003c')}</script>` : '';

  const period = chart ? `
        <p class="period"><span>Week of ${fmtDay(chart.chartDate)}</span><span class="dot" aria-hidden="true">·</span><span>Picks ${fmtRange(chart.window.start, chart.window.end)} (ET)</span></p>
        <p class="refresh">${chart.backfilled
          ? `Back-calculated from the same pick data${chart.generatedAt ? ` on ${fmtStamp(chart.generatedAt)}` : ''}, before the chart launched.`
          : `Updated ${fmtStamp(chart.generatedAt)}`}</p>` : '';

  const archiveBanner = !isCurrent && chart ? `
    <p class="banner">You’re looking at the chart from the week of ${fmtDay(chart.chartDate)}. <a href="/${SLUG}">See this week’s →</a></p>` : '';

  const stale = isCurrent && chart ? `
    <p class="banner stale" id="stale" hidden>This week’s chart is running late. You’re seeing the chart from the week of ${fmtDay(chart.chartDate)}.</p>` : '';

  const body = !chart ? `
    <section class="empty">
      <p class="empty-big">First pitch is ${fmtDay(nextMonday)}.</p>
      <p>The first Now Batting 20 drops Monday morning. Until then, the warm-up playlist is your call.</p>
    </section>`
    : !n ? `
    <section class="empty">
      <p class="empty-big">Quiet week at the ballpark.</p>
      <p>No song was picked by ${MIN_CHOS} or more Now Batting users in this window, so there’s no chart to post. We’d rather show nothing than make one up.</p>
    </section>`
    : `
    ${chart.highlights?.length ? `<div class="hls" aria-label="This week’s highlights">${chart.highlights.map(highlight).join('')}
    </div>` : ''}
    <ol class="chart" aria-label="The Now Batting 20, week of ${fmtDay(chart.chartDate)}">${chart.entries.map((e) => row(e, { hasPrev, showWeeks, editorial })).join('')}
    </ol>
    ${n < 20 ? `<p class="short">Only ${n} songs cleared the bar this week (at least ${MIN_CHOS} users). Short chart, honest chart.</p>` : ''}
    ${chart.onDeck?.length ? `
    <section class="deck" aria-labelledby="deck-h">
      <h2 id="deck-h">On deck</h2>
      <p class="deck-sub">Just outside the 20.</p>
      <ol class="deck-list" start="21">${chart.onDeck.map((e) => `
        <li><span class="deck-rank">${e.rank}</span><span class="deck-song"><span class="deck-title">${esc(e.title)}</span> <span class="deck-artist">${esc(e.artist)}</span></span>${e.appleMusicUrl ? `<a class="listen" href="${esc(e.appleMusicUrl)}" target="_blank" rel="noopener" aria-label="Listen to ${esc(e.title)} by ${esc(e.artist)} on Apple Music">Apple Music <span aria-hidden="true">↗</span></a>` : ''}</li>`).join('')}
      </ol>
    </section>` : ''}`;

  // Every other published week. On an old week's page the newest one is "This week".
  const latestDate = allDates[allDates.length - 1];
  const past = allDates.filter((d) => d !== chart?.chartDate).reverse();
  const archive = past.length ? `
    <section class="past" aria-labelledby="past-h">
      <h2 id="past-h">${isCurrent ? 'Past charts' : 'Other weeks'}</h2>
      <ul>${past.map((d) => d === latestDate
        ? `<li><a href="/${SLUG}">This week · ${fmtDay(d)}</a></li>`
        : `<li><a href="/${SLUG}/${d}">Week of ${fmtDay(d)}</a></li>`).join('')}</ul>
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- Generated by .scripts/nb20/render.mjs from data/nb20/. Do not hand-edit; edit the script. -->
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:site_name" content="Now Batting" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:title" content="${esc(isCurrent || !chart ? 'The Now Batting 20 — This Week’s Top 20 Walk-Up Songs' : `The Now Batting 20 — Week of ${fmtDay(chart.chartDate)}`)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:image" content="${SITE}/nb20/nb20-og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="The Now Batting 20 — This Week’s Top 20 Walk-Up Songs" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${SITE}/nb20/nb20-og.png" />
  <link rel="preload" href="/fonts/inter-var-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/jetbrains-mono-var-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">${jsonld}
  <style>${CSS}</style>
</head>
<body>
${NAV}
<main>
  <header class="hero">
    <img class="lockup" src="/nb20/nb20-horizontal-dark.svg" alt="The Now Batting 20" width="403" height="62">
    <h1>${esc(h1)}</h1>
    <p class="measures">Updated weekly. Ranked by how many Now Batting users picked each song over the past four weeks.</p>${period}
    ${chart && n ? `<button class="share" type="button" data-url="${canonical}" data-title="${esc(isCurrent ? 'The Now Batting 20' : `The Now Batting 20 — week of ${fmtDay(chart.chartDate)}`)}">Share the chart</button><span class="share-msg" role="status" aria-live="polite"></span>` : ''}
  </header>
  ${archiveBanner}${stale}
  ${body}
  ${CTA}
  ${HOW}
  ${archive}
  ${MORE}
</main>
${FOOTER}
<script>
  (function () {
    var btn = document.querySelector('.share');
    if (btn) btn.addEventListener('click', function () {
      var url = btn.getAttribute('data-url'), title = btn.getAttribute('data-title');
      var msg = document.querySelector('.share-msg');
      function copied(t) { if (msg) { msg.textContent = t; setTimeout(function () { msg.textContent = ''; }, 2500); } }
      if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () {}); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { copied('Link copied'); }, function () { window.prompt('Copy this link', url); });
      } else { window.prompt('Copy this link', url); }
    });
    ${isCurrent && chart ? `// A static page can't know when it's being read, so the check runs here: past ten days, say so.
    var stale = document.getElementById('stale');
    if (stale && Date.now() - Date.parse('${chart.chartDate}T12:00:00Z') > 10 * 864e5) stale.hidden = false;` : ''}
  })();
</script>
</body>
</html>
`;
}

// ── styles (tokens + nav/footer copied from the Field Guide so the pages match) ──

const CSS = `
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400 900; font-display: swap; src: url('/fonts/inter-var-latin.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400 900; font-display: swap; src: url('/fonts/inter-var-latin-ext.woff2') format('woff2'); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
    @font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 400 700; font-display: swap; src: url('/fonts/jetbrains-mono-var-latin.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #F6F4EF; --mid: #FFFFFF; --surf: #EDEAD9; --bord: rgba(0,0,0,0.09);
      --charcoal: #1F1F1F; --neon: #DFFF00; --daylight: #B8CC00; --daylight-dim: #8A9900; --olive: #5E6B00;
      --txt: #1F1F1F; --txt2: #4A4A4A; --txt3: #666666;
      --font-sans: 'Inter', system-ui, -apple-system, sans-serif; --font-mono: 'JetBrains Mono', ui-monospace, monospace;
      --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px;
    }
    html { scroll-behavior: smooth; }
    body { background: var(--bg); color: var(--txt); font-family: var(--font-sans); font-size: 16px; overflow-x: hidden; -webkit-font-smoothing: antialiased; }
    a { color: inherit; }
    .sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

    nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 18px 48px; background: rgba(246,244,239,0.97); backdrop-filter: blur(16px); border-bottom: 1px solid var(--bord); }
    .nav-right { display: flex; align-items: center; gap: 16px; }
    .nav-links { display: flex; align-items: center; gap: 28px; }
    .nav-link { font-size: 14px; font-weight: 500; color: var(--txt2); text-decoration: none; transition: color 0.15s; }
    .nav-link:hover, .nav-link.active { color: var(--txt); }
    .nav-btn { background: var(--daylight); color: #1F1F1F; font-weight: 700; font-size: 14px; letter-spacing: 0.01em; padding: 10px 20px; border-radius: var(--radius-sm); text-decoration: none; transition: background 0.15s; white-space: nowrap; }
    .nav-btn:hover { background: var(--daylight-dim); }

    main { position: relative; z-index: 1; max-width: 760px; margin: 0 auto; padding: 108px 32px 72px; }

    /* HEADER — charcoal, because the lockup is drawn for it and neon on cream doesn't read. */
    .hero { background: var(--charcoal); color: #fff; border-radius: var(--radius-lg); padding: 32px 32px 28px; margin-bottom: 20px; }
    .lockup { display: block; width: 100%; max-width: 420px; height: auto; margin-bottom: 22px; }
    .hero h1 { font-size: clamp(26px, 4.2vw, 40px); font-weight: 800; letter-spacing: -0.03em; line-height: 1.05; margin-bottom: 10px; text-wrap: balance; }
    .measures { font-size: 15px; color: rgba(255,255,255,0.78); line-height: 1.55; margin-bottom: 14px; }
    .period { font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--neon); display: flex; flex-wrap: wrap; gap: 4px 8px; }
    .period .dot { color: rgba(255,255,255,0.4); }
    .refresh { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; color: rgba(255,255,255,0.55); margin-top: 6px; }
    .share { margin-top: 18px; font: 700 13px/1 var(--font-mono); letter-spacing: 0.04em; color: var(--charcoal); background: var(--neon); border: 0; border-radius: var(--radius-sm); padding: 11px 16px; cursor: pointer; }
    .share:hover { background: #ECFF5C; }
    .share:focus-visible, .cta-btn:focus-visible, .listen:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--olive); outline-offset: 2px; }
    .share-msg { margin-left: 10px; font: 600 12px var(--font-mono); color: var(--neon); }

    .banner { background: var(--mid); border: 1px solid var(--bord); border-left: 4px solid var(--daylight); border-radius: var(--radius-sm); padding: 12px 14px; font-size: 14px; color: var(--txt2); margin-bottom: 16px; }
    .banner a { font-weight: 700; color: var(--txt); }

    /* HIGHLIGHTS — compact on purpose; the chart is the show. Scrolls sideways on phones. */
    .hls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }
    .hl { background: var(--mid); border: 1px solid var(--bord); border-radius: var(--radius-md); padding: 12px 14px; min-width: 0; }
    .hl-label { font: 700 10px var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--olive); margin-bottom: 6px; }
    .hl-title { font-size: 15px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.2; overflow-wrap: anywhere; }
    .hl-artist { font-size: 13px; color: var(--txt2); margin-top: 2px; overflow-wrap: anywhere; }
    .hl-sub { font: 600 11px var(--font-mono); color: var(--txt3); margin-top: 8px; }

    /* CHART */
    .chart { list-style: none; background: var(--mid); border: 1px solid var(--bord); border-radius: var(--radius-lg); overflow: hidden; }
    .row { display: grid; grid-template-columns: 40px 52px minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 14px 18px; border-top: 1px solid var(--bord); }
    .row:first-child { border-top: 0; }
    .row-one { background: linear-gradient(90deg, rgba(223,255,0,0.16), rgba(223,255,0,0) 60%); box-shadow: inset 4px 0 0 var(--daylight); }
    .rank { font: 700 22px/1 var(--font-mono); color: var(--txt); text-align: right; font-variant-numeric: tabular-nums; }
    .row-one .rank { color: var(--olive); }
    .art { width: 52px; height: 52px; border-radius: 6px; object-fit: cover; background: var(--surf); display: block; }
    .art-empty { display: flex; align-items: center; justify-content: center; background: var(--charcoal); }
    .song { min-width: 0; }
    .title { font-size: 16px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.25; overflow-wrap: anywhere; }
    .artist { font-size: 14px; color: var(--txt2); line-height: 1.35; margin-top: 1px; overflow-wrap: anywhere; }
    .meta { font: 500 11px/1.6 var(--font-mono); color: var(--txt3); margin-top: 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 0; }
    /* Separators belong to the item AFTER them, so a wrapped line never ends on a dangling dot. */
    .meta .mi + .mi::before { content: '·'; margin: 0 6px; color: var(--txt3); }
    /* The tag is boxed, so it needs no separator — and a wrapped line never starts with a stray dot. */
    .meta .mi.tag { color: var(--txt2); border: 1px solid var(--bord); border-radius: 4px; padding: 0 5px; margin-left: 8px; }
    .meta .mi.tag::before { content: none; }
    .links { font: 700 11px/1.6 var(--font-mono); margin-top: 2px; }
    .listen { color: var(--txt); font-weight: 700; text-decoration: none; white-space: nowrap; }
    .listen:hover { text-decoration: underline; text-underline-offset: 2px; }
    .mv { font: 700 13px var(--font-mono); white-space: nowrap; text-align: right; min-width: 44px; }
    .mv-up { color: var(--olive); }
    .mv-down { color: var(--txt3); }
    .mv-same { color: var(--txt3); }
    .mv-new { font-size: 10.5px; letter-spacing: 0.06em; background: var(--charcoal); color: var(--neon); border-radius: 4px; padding: 4px 6px; }
    .mv-re { font-size: 10px; letter-spacing: 0.04em; border: 1px solid var(--charcoal); color: var(--charcoal); border-radius: 4px; padding: 3px 5px; }
    .best { margin-top: 8px; }
    .best summary { cursor: pointer; font: 700 11px var(--font-mono); letter-spacing: 0.04em; color: var(--olive); }
    .best p { font-size: 14px; color: var(--txt2); line-height: 1.55; margin-top: 6px; }
    .short { font-size: 13px; color: var(--txt3); margin-top: 10px; }

    .deck { margin-top: 26px; }
    .deck h2, .how h2, .past h2, .more h2 { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }
    .deck-sub { font-size: 14px; color: var(--txt3); margin: 2px 0 10px; }
    .deck-list { list-style: none; border-top: 1px solid var(--bord); }
    .deck-list li { display: flex; align-items: baseline; gap: 12px; padding: 10px 2px; border-bottom: 1px solid var(--bord); font-size: 14px; }
    .deck-rank { font: 700 13px var(--font-mono); color: var(--txt3); min-width: 22px; text-align: right; }
    .deck-song { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .deck-title { font-weight: 700; }
    .deck-artist { color: var(--txt2); }
    .deck-list .listen { font: 700 11px var(--font-mono); }

    .cta { margin: 36px 0 8px; background: var(--charcoal); color: #fff; border-radius: var(--radius-lg); padding: 26px 28px; }
    .cta h2 { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 8px; }
    .cta p { font-size: 15px; color: rgba(255,255,255,0.78); line-height: 1.6; margin-bottom: 18px; max-width: 520px; }
    .cta-btn { display: inline-block; background: var(--neon); color: var(--charcoal); font: 700 14px var(--font-sans); padding: 12px 20px; border-radius: var(--radius-sm); text-decoration: none; }
    .cta-btn:hover { background: #ECFF5C; }

    .how, .past, .more { margin-top: 40px; }
    .how dl { margin-top: 12px; border-top: 1px solid var(--bord); }
    .how dt { font: 700 11px var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--olive); padding-top: 14px; }
    .how dd { font-size: 14.5px; color: var(--txt2); line-height: 1.65; padding: 4px 0 14px; border-bottom: 1px solid var(--bord); }
    .past ul { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .past a { display: inline-block; font: 600 12px var(--font-mono); text-decoration: none; border: 1px solid var(--bord); background: var(--mid); border-radius: 999px; padding: 7px 12px; }
    .past a:hover { border-color: var(--daylight); }
    .more ul { margin: 10px 0 0 18px; }
    .more li { font-size: 14.5px; color: var(--txt2); line-height: 1.6; margin-bottom: 6px; }
    .more a { color: var(--txt); font-weight: 700; text-underline-offset: 2px; }

    .empty { background: var(--mid); border: 1px solid var(--bord); border-radius: var(--radius-lg); padding: 28px; }
    .empty-big { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 6px; }
    .empty p { color: var(--txt2); line-height: 1.6; }

    footer { border-top: 1px solid var(--bord); padding: 28px 48px; display: flex; align-items: center; justify-content: space-between; }
    .f-logo { display: flex; align-items: center; line-height: 1; }
    .f-copy { font-size: 12px; color: var(--txt3); }
    .f-copy a { color: var(--txt3); text-decoration: none; }
    .f-copy a:hover { color: var(--txt); }

    @media (max-width: 860px) {
      nav { padding: 14px 18px; }
      .nav-links { order: 3; width: 100%; border-top: 1px solid var(--bord); padding-top: 10px; margin-top: 10px; gap: 20px; }
      main { padding: 128px 16px 56px; }
      footer { flex-direction: column; gap: 12px; text-align: center; padding: 22px 18px; }
    }
    @media (max-width: 600px) {
      .hero { padding: 22px 18px 20px; border-radius: var(--radius-md); }
      .lockup { margin-bottom: 16px; }
      .hls { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; gap: 8px; margin-bottom: 16px; padding-bottom: 4px; scrollbar-width: none; }
      .hls::-webkit-scrollbar { display: none; }
      .hl { flex: 0 0 78%; scroll-snap-align: start; }
      .period { flex-direction: column; }
      .period .dot { display: none; }
      .row { grid-template-columns: 30px 44px minmax(0, 1fr) auto; gap: 10px; padding: 12px 12px; }
      .rank { font-size: 18px; }
      .art { width: 44px; height: 44px; }
      .title { font-size: 15px; }
      .artist { font-size: 13px; }
      .mv { min-width: 0; }
      .cta { padding: 22px 18px; }
    }
    /* WAVEFORM (nav logo idle motion, as on every page) */
    @keyframes idle-1 { 0%,100%{transform:scaleY(1);}50%{transform:scaleY(0.55);} }
    @keyframes idle-4 { 0%,100%{transform:scaleY(1);}50%{transform:scaleY(0.68);} }
    @media (prefers-reduced-motion: no-preference) {
      nav .bar { transform-origin: center bottom; transform-box: fill-box; }
      nav .b1, nav .b7 { animation: idle-1 2s ease-in-out infinite; }
      nav .b4 { animation: idle-4 1.6s ease-in-out infinite; }
    }
`;


/**
 * The homepage strip (between the NB20:TEASER markers in index.html): this week's top three,
 * linking to the chart. Rewritten every build so the homepage always matches the chart.
 * Missing markers are skipped with a note, never an error — the chart must never break the homepage.
 */
async function writeHomeTeaser(latest) {
  const file = join(ROOT, 'index.html');
  const START = '<!-- NB20:TEASER:START — generated by .scripts/nb20/render.mjs. Do not hand-edit. -->';
  const END = '<!-- NB20:TEASER:END -->';
  let html;
  try { html = await readFile(file, 'utf8'); } catch { return; }
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < a) { console.warn('  nb20: index.html has no NB20:TEASER markers, homepage strip skipped'); return; }
  const top = latest?.entries?.slice(0, 3) || [];
  const list = top.length
    ? `<ol class="nb20t-list" aria-label="Top three this week">${top.map((e) => `<li><span class="nb20t-rank">${e.rank}</span>${e.artwork ? `<img src="${esc(e.artwork)}" alt="" width="56" height="56" loading="lazy" decoding="async">` : '<i></i>'}<p>${esc(e.title)}<em>${esc(e.artist)}</em></p></li>`).join('')}</ol>`
    : '<p class="nb20t-empty">The first chart drops Monday.</p>';
  const block = `${START}
<section class="nb20-teaser" aria-labelledby="nb20t-h">
  <a class="nb20t-card" href="/${SLUG}">
    <div class="nb20t-intro">
      <div class="nb20t-glow"><img class="nb20t-lockup" src="/nb20/nb20-horizontal-dark.svg" alt="The Now Batting 20" width="403" height="62" loading="lazy" decoding="async"></div>
      <h2 class="nb20t-title" id="nb20t-h">The walk-up song chart.<span>Updated every Monday.</span></h2>
      <p class="nb20t-tag">Real song picks. From real lineups.</p>
    </div>
    <div class="nb20t-top">
      <p class="nb20t-week">${latest ? `This week · ${fmtDay(latest.chartDate)}` : 'Coming Monday'}</p>
      ${list}
      <span class="nb20t-cta">See the full 20 →</span>
    </div>
  </a>
</section>
${END}`;
  await writeFile(file, html.slice(0, a) + block + html.slice(b + END.length));
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const snapshots = await loadSnapshots();
  const editorial = await loadEditorial();
  const dates = snapshots.map((s) => s.chartDate);
  const nextMonday = addDays(mondayOnOrBefore(nyToday()), 7);

  // The folder is rebuilt from scratch each run, so a week page can only exist for a week
  // that has a snapshot. index.html is the current chart (/top-walk-up-songs under cleanUrls);
  // a sibling top-walk-up-songs.html would make that URL ambiguous, so there isn't one.
  const weekDir = join(ROOT, SLUG);
  await rm(weekDir, { recursive: true, force: true });
  await rm(join(ROOT, `${SLUG}.html`), { force: true });
  await mkdir(weekDir, { recursive: true });

  const latest = dates.length ? withHistory(snapshots, dates[dates.length - 1]) : null;
  await writeFile(join(weekDir, 'index.html'), page({ chart: latest, isCurrent: true, allDates: dates, editorial, nextMonday }));

  for (const d of dates) {
    await writeFile(join(weekDir, `${d}.html`), page({ chart: withHistory(snapshots, d), isCurrent: false, allDates: dates, editorial, nextMonday }));
  }
  await writeHomeTeaser(latest);
  console.log(`  nb20: rendered /${SLUG} (${latest ? `week of ${latest.chartDate}, ${latest.entries.length} songs` : 'no chart yet'}) + ${dates.length} week page(s)`);
}

main().catch((e) => { console.error(`\n  nb20 render FAILED: ${e.stack || e}\n`); process.exit(1); });
