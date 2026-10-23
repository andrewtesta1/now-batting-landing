/**
 * The Now Batting 20 — the chart's rules, as pure functions.
 *
 * Everything that decides what charts, in what order, and what a row says about its
 * movement lives here, with no network and no file system, so it can be tested on fixtures
 * (see test.mjs). generate.mjs feeds it PostHog + Apple data; render.mjs feeds it saved
 * snapshots. If a ranking question ever comes up, this file is the answer.
 *
 * THE METHOD, in one place:
 *   - A "pick" is a `song_selected` event: someone chose a song for a player. It fires from
 *     the song editor (`source: 'editor'`), the parent intake link (`'intake'`) and a
 *     CSV/photo/paste import (`'csv'`/`'photo'`/`'paste'`) — and generate.mjs does NOT
 *     filter on source, so all of them chart.
 *     ⚠️ Importing a SHARED ROSTER is the one path that does not fire it: `applyCloudRoster`
 *     has no capture, deliberately. A shared roster copies one person's picks onto everyone
 *     they share with, so counting it would multiply one coach's taste across their whole
 *     team. If that ever changes, this chart's unit (distinct CHOs) stops meaning what it says.
 *   - Window: the 28 days ending Sunday 23:59:59 America/New_York. One week of picks is too
 *     thin (the week of Oct 5 2026 had no song picked by more than 2 CHOs).
 *   - Unit: DISTINCT CHOs (PostHog person ids). Picking the same song for five players is
 *     one CHO, so one very active team cannot carry a song.
 *   - Alternate releases of one song (single vs album, clean edit, "feat." credits,
 *     soundtrack versions) are merged by normalized title + primary artist, so a song cannot
 *     split its own vote.
 *   - Explicit releases are not counted and never shown.
 *   - A song needs MIN_CHOS distinct CHOs to chart at all.
 *   - Order: CHOs desc, then total picks desc, then CHOs in the window's last 7 days desc,
 *     then title — fully deterministic, so two runs on the same data give the same chart.
 */

export const CHART_SIZE = 20;
export const ON_DECK_SIZE = 5;
export const MIN_CHOS = 3;
export const WINDOW_DAYS = 28;
export const TZ = 'America/New_York';

// ── Dates ──────────────────────────────────────────────────────────────────────

/** Offset of America/New_York from UTC, in minutes, at a given instant (handles DST). */
function nyOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, p) => ((a[p.type] = p.value), a), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** The UTC instant of midnight New York time on a YYYY-MM-DD calendar date. */
export function nyMidnightUtc(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 5, 0, 0)); // 05:00Z is always the same NY date
  const off = nyOffsetMinutes(guess);                     // -240 (EDT) or -300 (EST)
  return new Date(Date.UTC(y, m - 1, d) - off * 60000);
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Today's date in New York as YYYY-MM-DD. */
export function nyToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

/** The most recent Monday (New York calendar) on or before `ymd`. */
export function mondayOnOrBefore(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun … 1 Mon
  return addDays(ymd, -((dow + 6) % 7));
}

/**
 * The reporting window for the chart dated `chartDate` (a Monday).
 * start: first day included; end: last day included; both New York calendar dates.
 */
export function windowFor(chartDate) {
  const start = addDays(chartDate, -WINDOW_DAYS);
  const end = addDays(chartDate, -1);
  return {
    start, end, days: WINDOW_DAYS, timezone: TZ,
    startUtc: nyMidnightUtc(start).toISOString(),
    endUtcExclusive: nyMidnightUtc(chartDate).toISOString(),
    recentStartUtc: nyMidnightUtc(addDays(chartDate, -7)).toISOString(),
  };
}

// ── Song identity ──────────────────────────────────────────────────────────────

const STRIP_PARENS = /\s*[\(\[]([^\)\]]*)[\)\]]/g;
const NOISE = /\b(feat\.?|ft\.?|featuring|with|clean|explicit|edit(ed)?|radio|remaster(ed)?|version|from|soundtrack|mono|stereo|single)\b/i;

export function normalizeTitle(title = '') {
  let t = String(title).replace(STRIP_PARENS, (all, inner) => (NOISE.test(inner) ? '' : all));
  t = t.replace(/\s+-\s+(single|radio edit|clean|remaster(ed)?.*|from .*)$/i, '');
  return t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function primaryArtist(artist = '') {
  const first = String(artist).split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bx\b|\+)\s*/i)[0] || '';
  return first.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function songKey(track) {
  return `${normalizeTitle(track.trackName)}|${primaryArtist(track.artistName)}`;
}

/** Apple's 100px artwork URL → a larger square, so rows stay sharp on retina. */
export function artworkAt(url, px = 200) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, `/${px}x${px}bb.$2`);
}

/** Apple Music link for a track, without iTunes affiliate/tracking params. */
export function cleanAppleUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const i = u.searchParams.get('i');
    u.search = i ? `?i=${i}` : '';
    return u.toString();
  } catch { return null; }
}

// ── Ranking ────────────────────────────────────────────────────────────────────

/**
 * pairs: [{ trackId, personId, picks, lastPick (ISO) }] — one row per (track, CHO) in the window.
 * meta:  Map trackId → iTunes lookup record (missing = Apple returned nothing for that id).
 * Returns { entries, onDeck, qualifying, excluded } — entries/onDeck carry NO counts.
 */
export function computeChart(pairs, meta, { recentStartUtc } = {}) {
  const groups = new Map();
  const unresolved = new Set();
  const explicit = new Set();

  for (const p of pairs) {
    const t = meta.get(String(p.trackId));
    if (!t) { unresolved.add(String(p.trackId)); continue; }
    if (t.trackExplicitness === 'explicit') { explicit.add(String(p.trackId)); continue; }
    const key = songKey(t);
    if (!key.split('|')[0]) { unresolved.add(String(p.trackId)); continue; }
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, persons: new Set(), recent: new Set(), picks: 0, versions: new Map() }));
    g.persons.add(p.personId);
    if (recentStartUtc && p.lastPick && p.lastPick >= recentStartUtc) g.recent.add(p.personId);
    g.picks += p.picks;
    let v = g.versions.get(String(p.trackId));
    if (!v) g.versions.set(String(p.trackId), (v = { track: t, persons: new Set(), picks: 0 }));
    v.persons.add(p.personId);
    v.picks += p.picks;
  }

  const ranked = [...groups.values()]
    .filter((g) => g.persons.size >= MIN_CHOS)
    .map((g) => {
      // The version shown and linked is the one the most CHOs picked.
      const shown = [...g.versions.values()].sort((a, b) =>
        b.persons.size - a.persons.size || b.picks - a.picks ||
        String(a.track.trackId).localeCompare(String(b.track.trackId)))[0].track;
      return { g, shown };
    })
    .sort((a, b) =>
      b.g.persons.size - a.g.persons.size ||
      b.g.picks - a.g.picks ||
      b.g.recent.size - a.g.recent.size ||
      a.shown.trackName.localeCompare(b.shown.trackName));

  const toEntry = ({ g, shown }, i) => ({
    rank: i + 1,
    key: g.key,
    trackId: String(shown.trackId),
    title: shown.trackName,
    artist: shown.artistName,
    album: shown.collectionName || null,
    artwork: artworkAt(shown.artworkUrl100),
    appleMusicUrl: cleanAppleUrl(shown.trackViewUrl),
    // Apple's own flag for an edited release. Only ever shown when Apple says so.
    cleanEdit: shown.trackExplicitness === 'cleaned',
    otherVersionIds: [...g.versions.keys()].filter((id) => id !== String(shown.trackId)).sort(),
  });

  const entries = ranked.slice(0, CHART_SIZE).map(toEntry);
  const onDeck = ranked.slice(CHART_SIZE, CHART_SIZE + ON_DECK_SIZE).map((r, i) => toEntry(r, CHART_SIZE + i));
  return {
    entries, onDeck,
    qualifying: ranked.length,
    excluded: { unresolvedIds: [...unresolved].sort(), explicitIds: [...explicit].sort() },
  };
}

// ── History ────────────────────────────────────────────────────────────────────

/**
 * Decorate the chart dated `date` with movement, using every snapshot up to and including it.
 * snapshots: array of snapshot objects (any order). Returns null if `date` isn't among them.
 *
 * Movement exists only against the chart EXACTLY seven days earlier — a skipped week is not
 * a comparable chart, so nothing on that page claims to have moved.
 *   up/down/same — on both charts; NEW — on no earlier chart; RE-ENTRY — on an earlier
 *   chart but not last week's.
 * Weeks on chart counts every chart a song appeared on. If it was on the OLDEST chart we
 * have, the true count may be higher, so it is flagged `weeksCensored` and shown as "N+".
 */
export function withHistory(snapshots, date) {
  const sorted = [...snapshots].sort((a, b) => a.chartDate.localeCompare(b.chartDate));
  const idx = sorted.findIndex((s) => s.chartDate === date);
  if (idx < 0) return null;
  const current = sorted[idx];
  const earlier = sorted.slice(0, idx);
  const prev = earlier.length && earlier[earlier.length - 1].chartDate === addDays(date, -7)
    ? earlier[earlier.length - 1] : null;
  const oldest = sorted[0];

  const rankIn = (snap, key) => snap.entries.find((e) => e.key === key)?.rank ?? null;

  const decorate = (e) => {
    const lastWeek = prev ? rankIn(prev, e.key) : null;
    let movement = null;
    if (prev) {
      if (lastWeek == null) movement = earlier.some((s) => rankIn(s, e.key) != null) ? { type: 'reentry' } : { type: 'new' };
      else if (lastWeek > e.rank) movement = { type: 'up', by: lastWeek - e.rank };
      else if (lastWeek < e.rank) movement = { type: 'down', by: e.rank - lastWeek };
      else movement = { type: 'same' };
    }
    const appearances = sorted.slice(0, idx + 1).filter((s) => rankIn(s, e.key) != null).length;
    return {
      ...e, lastWeek, movement,
      weeksOnChart: appearances,
      weeksCensored: rankIn(oldest, e.key) != null && oldest.chartDate !== date,
    };
  };

  const entries = current.entries.map(decorate);
  return {
    ...current,
    entries,
    onDeck: current.onDeck || [],
    hasPrev: Boolean(prev),
    historyWeeks: idx + 1,
    highlights: highlightsFor(entries, Boolean(prev)),
  };
}

/** Up to three editorial callouts, each derived from the chart itself. */
export function highlightsFor(entries, hasPrev) {
  const out = [];
  if (entries[0]) out.push({ kind: 'number-one', entry: entries[0] });
  if (!hasPrev) return out;
  const climbers = entries.filter((e) => e.movement?.type === 'up');
  if (climbers.length) {
    const best = climbers.reduce((a, b) => (b.movement.by > a.movement.by ? b : a));
    out.push({ kind: 'climber', entry: best });
  }
  const debut = entries.find((e) => e.movement?.type === 'new');
  if (debut) out.push({ kind: 'new', entry: debut });
  return out;
}
