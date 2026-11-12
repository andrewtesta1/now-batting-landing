/**
 * The And Now demo's sample (andnow-demo/sample/): The Voice Upstairs (was The Legend) reading a short Starting 5 —
 * the welcome, our five, the close — rendered from the APP's script so the demo can say
 * "exactly what the app records". Re-run whenever sports/court/rollCall.ts or plan.ts changes.
 *
 *   npx tsx .scripts/andnow-demo-sample.ts ~/walkup-hero
 *
 * Renders through the live /api/tts (same model, voice and court/court_roll settings the app
 * uses), writes NN.mp3 + script.json. Eight short calls; check the cost before widening it.
 */
import { writeFileSync, mkdirSync } from 'fs';
const APP = process.argv[2] ?? `${process.env.HOME}/walkup-hero`;
const OUT = new URL('../andnow-demo/sample/', import.meta.url).pathname;
const LEGEND = '2yxRHClfrohSkhkckjv6';
const { planRollCall } = await import(`${APP}/sports/court/plan.ts`);
const P = (id: string, number: string, f: string, l: string) => ({ id, number, firstName: f, lastName: l });
const home = { team: 'Now Batting Ballers', starters: [P('h1','2','Avery','Swish'), P('h2','5','Mia','Buckets'), P('h3','11','Theo','Glass'), P('h4','23','Riley','Hoops'), P('h5','34','Sam','Dunkley')] };
// The opponent is named but not introduced: the welcome and the close name the matchup.
const away = { team: 'And-One Dunkers', starters: [] };
const plan = planRollCall({ voiceId: LEGEND, home, away, settings: { visitors: false, visitorsStyle: 'dramatic', positions: true, venue: 'the Now Batting Arena', timeOfDay: 'tonight' } });
mkdirSync(OUT, { recursive: true });
const script = [];
for (const [i, s] of plan.entries()) {
  const file = `${String(i).padStart(2, '0')}.mp3`;
  const r = await fetch('https://walkup-hero.vercel.app/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: s.text, voiceId: LEGEND, type: 'pa_call', profile: s.profile ?? 'court_roll' }) });
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('audio')) throw new Error(`${file}: ${r.status}`);
  writeFileSync(OUT + file, Buffer.from(await r.arrayBuffer()));
  script.push({ slot: s.slot, file, gap: s.gapAfter ?? 650, display: s.display ?? s.text.replace(/\[[^\]]*\]\s*/g, ''), lit: (s.slot.match(/^rc:home:(\d)$/) ?? [])[1] ?? null });
  console.log(file, script[script.length - 1].display);
}
writeFileSync(OUT + 'script.json', JSON.stringify(script));
