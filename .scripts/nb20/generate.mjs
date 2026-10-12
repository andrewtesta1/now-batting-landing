#!/usr/bin/env node
/**
 * generate.mjs — writes one weekly snapshot of The Now Batting 20.
 *
 *   POSTHOG_API_KEY=phx_… node .scripts/nb20/generate.mjs              # this Monday's chart
 *   POSTHOG_API_KEY=phx_… node .scripts/nb20/generate.mjs --date 2026-10-12
 *   POSTHOG_API_KEY=phx_… node .scripts/nb20/generate.mjs --backfill 5  # the last 5 Mondays
 *   … add --dry-run to print instead of write.
 *
 * Runs every Monday from .github/workflows/nb20-weekly.yml. It needs a PostHog PERSONAL API
 * key with query access (the same key nb-hq uses), and network access to Apple's public
 * iTunes lookup for song names, artwork and links.
 *
 * WHAT IT WRITES: data/nb20/snapshots/<monday>.json — ranks and song info ONLY. No pick
 * counts, no CHO counts, no person ids. This repo is public and so is /data on the site, so
 * a snapshot holds exactly what the page shows and nothing it doesn't.
 *
 * FAILURE IS LOUD: any PostHog or Apple error exits non-zero WITHOUT writing, so a bad run
 * leaves last week's chart up (with its own dates) rather than publishing a partial one.
 * An existing snapshot is never overwritten unless --force is passed: a published week is
 * history, and history that silently changes is the thing a chart can't afford.
 */

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  computeChart, windowFor, mondayOnOrBefore, nyToday, addDays, MIN_CHOS, WINDOW_DAYS, CHART_SIZE,
} from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'data', 'nb20', 'snapshots');
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.posthog.com';
const POSTHOG_PROJECT = process.env.POSTHOG_PROJECT_ID || '428013';
const KEY = process.env.POSTHOG_API_KEY;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fail = (msg) => { console.error(`\nnb20: FAILED — ${msg}\n`); process.exit(1); };

async function hogql(query) {
  const r = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, name: 'nb20-weekly-chart' }),
  });
  if (!r.ok) throw new Error(`PostHog HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  if (!Array.isArray(j.results)) throw new Error('PostHog returned no results array');
  return j.results;
}

/** One row per (track, CHO) in the window. Person ids never leave this process. */
async function fetchPairs(win) {
  const s = Math.floor(Date.parse(win.startUtc) / 1000);
  const e = Math.floor(Date.parse(win.endUtcExclusive) / 1000);
  const rows = await hogql(`
    SELECT toString(properties.track_id) AS track_id, toString(person_id) AS pid,
           count() AS picks, max(timestamp) AS last_pick
    FROM events
    WHERE event = 'song_selected'
      AND timestamp >= fromUnixTimestamp(${s}) AND timestamp < fromUnixTimestamp(${e})
      AND properties.track_id IS NOT NULL AND toString(properties.track_id) != ''
      AND coalesce(toString(properties.distribution), 'appstore') NOT IN ('testflight', 'dev')
    GROUP BY track_id, pid
    LIMIT 100000`);
  return rows.map(([trackId, personId, picks, lastPick]) => ({
    trackId: String(trackId), personId: String(personId), picks: Number(picks),
    lastPick: new Date(lastPick).toISOString(),
  }));
}

/** Apple's public lookup, batched. A missing id simply doesn't come back. */
async function lookup(ids) {
  const meta = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`https://itunes.apple.com/lookup?country=us&id=${batch.join(',')}`);
        if (!r.ok) throw new Error(`Apple lookup HTTP ${r.status}`);
        const j = await r.json();
        for (const t of j.results || []) if (t.wrapperType === 'track' && t.trackId) meta.set(String(t.trackId), t);
        lastErr = null;
        break;
      } catch (err) { lastErr = err; await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); }
    }
    if (lastErr) throw lastErr;
  }
  return meta;
}

async function exists(p) { try { await access(p); return true; } catch { return false; } }

const ART_DIR = join(ROOT, 'nb20', 'art');
async function saveArtwork(trackId, remoteUrl) {
  if (!remoteUrl || !/^\d+$/.test(trackId)) return null;
  const file = join(ART_DIR, `${trackId}.jpg`);
  const local = `/nb20/art/${trackId}.jpg`;
  if (await exists(file)) return local;
  try {
    const r = await fetch(remoteUrl);
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return null;
    await mkdir(ART_DIR, { recursive: true });
    await writeFile(file, Buffer.from(await r.arrayBuffer()));
    return local;
  } catch { return null; }
}

async function buildOne(chartDate, { backfilled }) {
  const win = windowFor(chartDate);
  const pairs = await fetchPairs(win);
  if (!pairs.length) throw new Error(`no song_selected events between ${win.start} and ${win.end}`);
  const ids = [...new Set(pairs.map((p) => p.trackId))];
  const meta = await lookup(ids);
  const chart = computeChart(pairs, meta, { recentStartUtc: win.recentStartUtc });

  // Logged for the operator (the Actions log), never written to the public snapshot.
  console.log(`  ${chartDate}: ${pairs.length} CHO-song pairs, ${ids.length} songs, ${chart.qualifying} qualify (≥${MIN_CHOS} CHOs)`);
  if (chart.excluded.unresolvedIds.length) {
    console.log(`  ⚠ ${chart.excluded.unresolvedIds.length} picked id(s) Apple's lookup did not return — possibly dead catalog ids,` +
      ` i.e. walk-ups that may be silent: ${chart.excluded.unresolvedIds.slice(0, 40).join(', ')}`);
  }
  if (chart.excluded.explicitIds.length) console.log(`  ${chart.excluded.explicitIds.length} explicit version(s) not counted`);

  // Artwork is copied onto our own origin. The site loads nothing third-party, and a chart
  // page should not be the thing that starts handing every visitor's IP to Apple's CDN.
  // A failed download means no artwork (the page draws a placeholder), never a broken image.
  if (!flag('--dry-run')) for (const e of [...chart.entries, ...chart.onDeck]) e.artwork = await saveArtwork(e.trackId, e.artwork);

  return {
    version: 1,
    chartDate,
    window: { start: win.start, end: win.end, days: WINDOW_DAYS, timezone: win.timezone },
    generatedAt: new Date().toISOString(),
    backfilled,
    method: { activity: 'song_selected', rankBy: 'distinct CHOs', minChos: MIN_CHOS, size: CHART_SIZE },
    entryCount: chart.entries.length,
    entries: chart.entries,
    onDeck: chart.onDeck,
  };
}

async function main() {
  if (!KEY) fail('POSTHOG_API_KEY is not set (a PostHog personal API key with query access).');
  const thisMonday = mondayOnOrBefore(nyToday());
  const back = Number(opt('--backfill') || 0);
  const dates = opt('--date') ? [opt('--date')]
    : back > 0 ? Array.from({ length: back }, (_, i) => addDays(thisMonday, -7 * (back - 1 - i)))
    : [thisMonday];

  for (const d of dates) {
    if (mondayOnOrBefore(d) !== d) fail(`${d} is not a Monday — charts are dated by the Monday they publish.`);
    if (d > thisMonday) fail(`${d} is in the future.`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const d of dates) {
    const file = join(OUT_DIR, `${d}.json`);
    if (!flag('--force') && await exists(file)) { console.log(`  ${d}: already published, leaving it alone`); continue; }
    // Anything generated after its own Monday is a reconstruction, and says so on the page.
    const snap = await buildOne(d, { backfilled: d !== thisMonday || flag('--mark-backfilled') });
    if (flag('--dry-run')) { console.log(JSON.stringify(snap, null, 2)); continue; }
    await writeFile(file, JSON.stringify(snap, null, 2) + '\n');
    console.log(`  wrote data/nb20/snapshots/${d}.json (${snap.entryCount} songs${snap.backfilled ? ', back-calculated' : ''})`);
  }
}

main().catch((e) => fail(e.stack || String(e)));
