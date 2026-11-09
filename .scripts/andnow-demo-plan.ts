import { planRollCall } from '/Users/andrewtesta/walkup-hero-andnow/sports/court/plan';
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
const P = (id: string, number: string, firstName: string, lastName: string) => ({ id, number, firstName, lastName }) as any;
const home = { team: 'Now Batting Ballers',
  starters: [P('h1','2','Avery','Swish'), P('h2','5','Mia','Buckets'), P('h3','11','Theo','Glass'), P('h4','23','Riley','Hoops'), P('h5','34','Sam','Dunkley')],
  bench: [P('h6','8','Kai','Pivot'), P('h7','15','Lee','Hustle')] };
const away = { team: 'And-One Dunkers',
  starters: [P('a1','0','Casey','Alley'), P('a2','4','Quinn','Oop'), P('a3','7','Morgan','Rim'), P('a4','12','Blake','Backboard'), P('a5','44','Drew','Paint')],
  bench: [P('a6','9','Jesse','Crossover'), P('a7','30','Robin','Fastbreak')] };
const combos: Record<string, any> = {};
const unique: Record<string, { text: string; profile: string }> = {};
for (const visitors of [true, false]) for (const bench of [true, false]) for (const coaches of [true, false]) for (const officials of [true, false]) {
  const key = `${+visitors}${+bench}${+coaches}${+officials}`;
  const plan = planRollCall({ voiceId: 'VOICE', home, away, settings: {
    visitors, visitorsStyle: 'dramatic', positions: true, venue: 'the Now Batting Arena', timeOfDay: 'tonight', bench,
    headCoach: coaches ? 'Dana Fastpass' : '', assistants: coaches ? ['Chris Layup'] : [],
    awayHeadCoach: coaches ? 'Lou Fullcourt' : '', awayAssistants: coaches ? ['Sky Hook'] : [],
    officials: officials ? ['Terry Whistle', 'Pat Stripes'] : [] } as any });
  combos[key] = plan.map(s => {
    const profile = s.profile ?? 'court_roll';
    const h = createHash('sha1').update(profile + '|' + s.text).digest('hex').slice(0, 12);
    unique[h] = { text: s.text, profile };
    const away = s.slot.startsWith('rc:away:') || s.slot.endsWith(':away');
    const lit = s.slot.match(/^rc:(home|away):(\d)$/);
    return { slot: s.slot, clip: h, gap: s.gapAfter ?? 650, away, label: s.label ?? null, display: s.display ?? s.text.replace(/\[[^\]]*\]\s*/g, ''), lit: lit ? { side: lit[1], i: +lit[2] } : null };
  });
}
writeFileSync(process.argv[2] + '/combos.json', JSON.stringify(combos));
writeFileSync(process.argv[2] + '/unique.json', JSON.stringify(unique, null, 1));
console.log('combos', Object.keys(combos).length, 'unique clips', Object.keys(unique).length, 'chars', Object.values(unique).reduce((n, u) => n + u.text.length, 0));
console.log(combos['1111'].map((s: any) => s.display).join('\n'));
