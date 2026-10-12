# The Now Batting 20 — data

`/top-walk-up-songs` (and one page per week at `/top-walk-up-songs/<monday>`) is built from the files here.

| Path | What | Who writes it |
|---|---|---|
| `snapshots/<monday>.json` | One published week: ranks + song info. **No counts, no person ids.** | `.github/workflows/nb20-weekly.yml` every Monday, via `.scripts/nb20/generate.mjs` |
| `editorial.json` | Optional "Best 15 seconds" notes | You, by hand |
| `/nb20/art/<trackId>.jpg` | Album art, copied onto our own origin | `generate.mjs` |

**The method** (full detail in `.scripts/nb20/lib.mjs`): a pick is a `song_selected` event — a CHO searching Apple Music in the song editor and choosing a song. Each Monday's chart covers the 28 days ending Sunday at midnight Eastern. Songs rank by **distinct CHOs**, ties by total picks then the most recent week; at least 3 CHOs to chart. Alternate releases merge; explicit versions are not counted.

**Published weeks are history.** `generate.mjs` refuses to overwrite an existing snapshot without `--force`. Snapshots generated after their own Monday are marked `"backfilled": true` and the page says "back-calculated".

## Commands

```bash
node .scripts/nb20/test.mjs                                   # the rules, on fixtures
POSTHOG_API_KEY=phx_… node .scripts/nb20/generate.mjs --backfill 5   # this week + 4 before it
node .scripts/nb20/render.mjs                                 # rebuild the pages
```

## Adding a "Best 15 seconds" note

Find the song's `key` in the latest snapshot (e.g. `"thunderstruck|ac dc"`), then in `editorial.json`:

```json
{ "songs": { "thunderstruck|ac dc": { "start": "0:31", "why": "The drums kick in and the crowd chant lands right as they reach the box.", "verified": true } } }
```

It renders only when `start`, `why` and `verified: true` are all present. Somebody listens to the track and picks the moment. Never fill one in from memory to make a row look complete.
