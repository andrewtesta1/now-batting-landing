import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
const [,, D, OUT] = process.argv;
const unique = JSON.parse(readFileSync(D + '/unique.json', 'utf8'));
const voices = { legend: 'HkNPNJx3jZgH8LNXPQbu', hypeman: 'TskxLHtUU7Z2k6D2tusL', powerhouse: 'KOgItLCSoz8gXSnTNfZL', mainevent: '4iR9hIjH3Ac1pfeljRZB', smooth: '2yxRHClfrohSkhkckjv6' };
const jobs = [];
for (const [slug, id] of Object.entries(voices)) { mkdirSync(`${OUT}/${slug}`, { recursive: true }); for (const [h, u] of Object.entries(unique)) jobs.push({ slug, id, h, ...u }); }
let ok = 0, fail = 0;
const one = async (j) => {
  const f = `${OUT}/${j.slug}/${j.h}.mp3`;
  if (existsSync(f) && statSync(f).size > 1000) { ok++; return; }
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch('https://walkup-hero.vercel.app/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: j.text, voiceId: j.id, type: 'pa_call', profile: j.profile }) });
      if (r.status === 429) { console.log('RATE LIMITED'); fail++; return; }
      if (!r.ok) throw new Error(r.status);
      writeFileSync(f, Buffer.from(await r.arrayBuffer())); ok++; return;
    } catch (e) { await new Promise(r => setTimeout(r, 1500)); }
  }
  fail++; console.log('fail', j.slug, j.h);
};
const q = [...jobs];
await Promise.all([0,1,2].map(async () => { for (let j = q.shift(); j; j = q.shift()) await one(j); }));
console.log('ok', ok, 'fail', fail, 'of', jobs.length);
