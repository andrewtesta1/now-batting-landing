// /api/subscribe — the updates list.
//
// A standalone, website-only signup: someone types their email on nowbattingapp.com
// and lands in a Resend Audience. It deliberately touches NOTHING in the app — no
// Sign in with Apple scope, no in-app capture, so no App Privacy label change. The
// only people on this list are people who typed their address into this form.
//
// The list lives in Resend's Contacts rather than in our own store, and that is the
// whole point: Resend then owns unsubscribe handling, the List-Unsubscribe header
// and the broadcast composer. Rolling our own would mean building a send UI, an
// unsubscribe token flow and a suppression list — three things that are already
// solved and all three of which are legally load-bearing.
//
// ⚠️ Resend's current model is ONE audience per account with segments, so contacts
// are created at POST /contacts with no audience id in the path. An older shape
// (POST /audiences/{id}/contacts) is still all over the internet; it is not what
// this account's API takes.
//
// Matches this repo's api/*.ts convention: a plain (req, res) Node serverless
// handler, no @vercel/node types, no build step.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RESEND_KEY = process.env.RESEND_API_KEY;

// Server-side PostHog, same shape as api/get.ts. ⚠️ COUNTS ONLY — never the address.
// This list is the first place the site holds a piece of PII, and the rule the rest
// of the product follows (no PII to analytics) does not get an exception for it.
async function track(event: string, properties: Record<string, unknown>) {
  const token = process.env.POSTHOG_PROJECT_TOKEN;
  if (!token) return;
  try {
    await fetch('https://us.i.posthog.com/capture/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: token,
        event,
        distinct_id: 'server',
        properties: { ...properties, $lib: 'nowbattingapp-site' },
      }),
    });
  } catch {
    /* analytics must never fail a signup */
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const email = String(body?.email ?? '').trim().toLowerCase();
  const firstName = String(body?.firstName ?? '').trim().slice(0, 60);
  // Honeypot: a real person never fills a field they cannot see. Bots fill
  // everything. Answer 200 so a scripted signup learns nothing from the response.
  const trap = String(body?.company ?? '').trim();
  if (trap) return res.status(200).json({ ok: true });

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'bad_email', message: 'That email doesn’t look right.' });
  }

  if (!RESEND_KEY) {
    // Fail loudly rather than silently dropping someone who asked to hear from us.
    // ⚠️ There is no local fallback store on this project, so a dropped signup is
    // gone — an honest error the person can retry beats a cheerful lie.
    console.error('[subscribe] RESEND_API_KEY is not set on this project');
    await track('newsletter_signup_failed', { reason: 'not_configured' });
    return res.status(503).json({ error: 'not_configured', message: 'Sign-up isn’t switched on yet. Try again shortly.' });
  }

  try {
    const r = await fetch('https://api.resend.com/contacts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, first_name: firstName || undefined, unsubscribed: false }),
    });

    // A duplicate is a success from the person's point of view: they asked to be on
    // the list and they are on the list. Never tell someone their signup failed
    // because they already did it.
    if (r.ok || r.status === 409) {
      await track('newsletter_signup', { duplicate: r.status === 409 });
      return res.status(200).json({ ok: true });
    }

    const detail = await r.text();
    if (/already|exists|duplicate/i.test(detail)) {
      await track('newsletter_signup', { duplicate: true });
      return res.status(200).json({ ok: true });
    }

    // ⛔ The upstream body can quote the address back; it never reaches the client
    // and never reaches analytics.
    console.error('[subscribe] resend rejected:', r.status, detail.slice(0, 300));
    await track('newsletter_signup_failed', { reason: 'upstream', status: r.status });
    return res.status(502).json({ error: 'upstream', message: 'Something went wrong. Try again in a minute.' });
  } catch (err) {
    console.error('[subscribe] resend threw:', err);
    await track('newsletter_signup_failed', { reason: 'threw' });
    return res.status(502).json({ error: 'upstream', message: 'Something went wrong. Try again in a minute.' });
  }
}
