#!/usr/bin/env node
// node .scripts/nb20/test.mjs — the chart rules on fixtures. No network.
import assert from 'node:assert/strict';
import {
  computeChart, withHistory, windowFor, mondayOnOrBefore, normalizeTitle, primaryArtist, songKey,
  cleanAppleUrl, artworkAt, MIN_CHOS,
} from './lib.mjs';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

const track = (id, name, artist, extra = {}) => [String(id), {
  wrapperType: 'track', trackId: id, trackName: name, artistName: artist, collectionName: 'X',
  artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/a/${id}/100x100bb.jpg`,
  trackViewUrl: `https://music.apple.com/us/album/x/1?i=${id}&uo=4`, trackExplicitness: 'notExplicit', ...extra,
}];
const pick = (trackId, personId, picks = 1, lastPick = '2026-10-10T12:00:00.000Z') => ({ trackId: String(trackId), personId, picks, lastPick });
const many = (trackId, n, prefix = 'p') => Array.from({ length: n }, (_, i) => pick(trackId, `${prefix}${i}`));

t('window is 28 days ending Sunday, midnight New York, across DST', () => {
  const w = windowFor('2026-10-12');
  assert.equal(w.start, '2026-09-14'); assert.equal(w.end, '2026-10-11');
  assert.equal(w.startUtc, '2026-09-14T04:00:00.000Z');          // EDT
  assert.equal(w.endUtcExclusive, '2026-10-12T04:00:00.000Z');
  assert.equal(windowFor('2026-11-09').endUtcExclusive, '2026-11-09T05:00:00.000Z'); // EST after Nov 1
  assert.equal(mondayOnOrBefore('2026-10-18'), '2026-10-12');
  assert.equal(mondayOnOrBefore('2026-10-12'), '2026-10-12');
});

t('ranks by distinct CHOs, not picks — one busy CHO cannot carry a song', () => {
  const meta = new Map([track(1, 'Thunderstruck', 'AC/DC'), track(2, 'Big Dawgs', 'Hanumankind & Kalmi')]);
  const pairs = [...many(1, 4), pick(2, 'busy', 40), pick(2, 'a'), pick(2, 'b')];
  const c = computeChart(pairs, meta);
  assert.deepEqual(c.entries.map((e) => e.title), ['Thunderstruck', 'Big Dawgs']);
});

t(`needs at least ${MIN_CHOS} CHOs to chart`, () => {
  const meta = new Map([track(1, 'A', 'X'), track(2, 'B', 'Y')]);
  const c = computeChart([...many(1, MIN_CHOS), ...many(2, MIN_CHOS - 1)], meta);
  assert.equal(c.entries.length, 1); assert.equal(c.qualifying, 1);
});

t('alternate releases merge, a CHO on two versions counts once, the most-picked version is shown', () => {
  const meta = new Map([
    track(10, 'All I Do Is Win (feat. T-Pain, Ludacris, Snoop Dogg & Rick Ross)', 'DJ Khaled'),
    track(11, 'All I Do Is Win', 'DJ Khaled feat. T-Pain', { trackExplicitness: 'cleaned' }),
    track(20, 'Other', 'Z'),
  ]);
  const pairs = [pick(10, 'a'), pick(10, 'b'), pick(11, 'b'), pick(11, 'c'), pick(11, 'd'), ...many(20, 3, 'z')];
  const c = computeChart(pairs, meta);
  assert.equal(c.entries[0].title, 'All I Do Is Win');       // 4 distinct CHOs beat 3
  assert.equal(c.entries[0].trackId, '11');                   // 3 CHOs on the clean single vs 2
  assert.equal(c.entries[0].cleanEdit, true);
  assert.deepEqual(c.entries[0].otherVersionIds, ['10']);
});

t('explicit versions are not counted; ids Apple does not return are reported, not charted', () => {
  const meta = new Map([track(1, 'Song', 'A', { trackExplicitness: 'explicit' }), track(2, 'Fine', 'B')]);
  const c = computeChart([...many(1, 9), ...many(2, 3), ...many(3, 5)], meta);
  assert.deepEqual(c.entries.map((e) => e.title), ['Fine']);
  assert.deepEqual(c.excluded.explicitIds, ['1']);
  assert.deepEqual(c.excluded.unresolvedIds, ['3']);
});

t('ties break on total picks, then on CHOs in the last 7 days, then title', () => {
  const meta = new Map([track(1, 'Bravo', 'A'), track(2, 'Alpha', 'B'), track(3, 'Charlie', 'C')]);
  const old = '2026-09-20T00:00:00.000Z';
  const pairs = [
    ...many(1, 3, 'x').map((p) => ({ ...p, lastPick: old })),                 // 3 CHOs, 3 picks, 0 recent
    ...many(2, 3, 'y'),                                                       // 3 CHOs, 3 picks, 3 recent
    pick(3, 'q', 2), pick(3, 'r'), pick(3, 's'),                              // 3 CHOs, 4 picks
  ];
  const c = computeChart(pairs, meta, { recentStartUtc: '2026-10-05T04:00:00.000Z' });
  assert.deepEqual(c.entries.map((e) => e.title), ['Charlie', 'Alpha', 'Bravo']);
});

t('snapshot entries carry no counts and no person ids', () => {
  const meta = new Map([track(1, 'A', 'X')]);
  const e = computeChart(many(1, 5), meta).entries[0];
  const json = JSON.stringify(e);
  assert.ok(!/"(chos|picks|persons|count)"/i.test(json), json);
  assert.ok(!json.includes('p0'));
});

t('chart caps at 20, next 5 are On Deck ranked 21–25', () => {
  const entries = Array.from({ length: 30 }, (_, i) => track(100 + i, `Song ${String(i).padStart(2, '0')}`, `Artist ${i}`));
  const meta = new Map(entries);
  const pairs = entries.flatMap(([id], i) => many(id, 40 - i, `s${i}-`));
  const c = computeChart(pairs, meta);
  assert.equal(c.entries.length, 20); assert.equal(c.onDeck.length, 5);
  assert.equal(c.onDeck[0].rank, 21); assert.equal(c.onDeck[4].rank, 25);
});

const snap = (date, keys) => ({ chartDate: date, window: windowFor(date), entries: keys.map((k, i) => ({ rank: i + 1, key: k, title: k, artist: k })) });

t('movement: up/down/same/NEW/RE-ENTRY against last week only', () => {
  const s = [
    snap('2026-09-28', ['a', 'b', 'c', 'gone']),
    snap('2026-10-05', ['b', 'a', 'c']),
    snap('2026-10-12', ['a', 'c', 'b', 'gone', 'fresh']),
  ];
  const h = withHistory(s, '2026-10-12');
  const m = Object.fromEntries(h.entries.map((e) => [e.key, e.movement]));
  assert.deepEqual(m.a, { type: 'up', by: 1 });
  assert.deepEqual(m.c, { type: 'up', by: 1 });
  assert.deepEqual(m.b, { type: 'down', by: 2 });
  assert.deepEqual(m.gone, { type: 'reentry' });
  assert.deepEqual(m.fresh, { type: 'new' });
  assert.equal(h.entries.find((e) => e.key === 'b').lastWeek, 1);
});

t('first chart ever: no movement at all — nothing is labelled NEW just because tracking started', () => {
  const h = withHistory([snap('2026-10-12', ['a', 'b'])], '2026-10-12');
  assert.equal(h.hasPrev, false);
  assert.ok(h.entries.every((e) => e.movement === null && e.lastWeek === null));
  assert.deepEqual(h.highlights.map((x) => x.kind), ['number-one']);
});

t('a skipped week is not a comparable chart', () => {
  const h = withHistory([snap('2026-09-28', ['a']), snap('2026-10-12', ['a'])], '2026-10-12');
  assert.equal(h.hasPrev, false); assert.equal(h.entries[0].movement, null);
});

t('weeks on chart counts appearances and flags songs present since the oldest chart', () => {
  const s = [snap('2026-09-28', ['a']), snap('2026-10-05', ['b']), snap('2026-10-12', ['a', 'b'])];
  const h = withHistory(s, '2026-10-12');
  const a = h.entries.find((e) => e.key === 'a'), b = h.entries.find((e) => e.key === 'b');
  assert.equal(a.weeksOnChart, 2); assert.equal(a.weeksCensored, true);
  assert.equal(b.weeksOnChart, 2); assert.equal(b.weeksCensored, false);
});

t('highlights: biggest climber is the largest upward move among songs on both charts; ties → higher rank', () => {
  const s = [snap('2026-10-05', ['a', 'b', 'c', 'd', 'e']), snap('2026-10-12', ['e', 'd', 'a', 'new1', 'b', 'c'])];
  const h = withHistory(s, '2026-10-12');
  const climber = h.highlights.find((x) => x.kind === 'climber').entry;
  assert.equal(climber.key, 'e');                        // 5 → 1, by 4
  assert.equal(h.highlights.find((x) => x.kind === 'new').entry.key, 'new1');
});

t('title/artist normalization', () => {
  assert.equal(normalizeTitle('Sunflower (Spider-Man: Into the Spider-Verse)'), 'sunflower spider man into the spider verse');
  assert.equal(normalizeTitle('Big Guy (from "The SpongeBob Movie: Search for SquarePants”)'), 'big guy');
  assert.equal(normalizeTitle('Crank That (Soulja Boy)'), 'crank that soulja boy');
  assert.equal(normalizeTitle('Lose Yourself - Single'), 'lose yourself');
  assert.equal(primaryArtist('Forrest Frank & Connor Price'), 'forrest frank');
  assert.equal(primaryArtist('The White Stripes'), 'white stripes');
  assert.equal(songKey({ trackName: 'Thunderstruck', artistName: 'AC/DC' }), 'thunderstruck|ac dc');
});

t('Apple links lose tracking params, artwork is upsized', () => {
  assert.equal(cleanAppleUrl('https://music.apple.com/us/album/x/1?i=575998661&uo=4'), 'https://music.apple.com/us/album/x/1?i=575998661');
  assert.equal(artworkAt('https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg'), 'https://is1-ssl.mzstatic.com/image/thumb/x/200x200bb.jpg');
});

console.log(`\n  nb20: ${passed} tests passed\n`);
