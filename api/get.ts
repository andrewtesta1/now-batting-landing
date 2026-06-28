// /get — device-detecting smart redirect for the printed QR code.
//
// The /get URL is STABLE FOREVER (a printed QR points at it); ALL routing logic
// lives in this handler, never in the URL. Detects the visitor's platform from
// the User-Agent and 302-redirects server-side (no client-side flash of content):
//   • iOS (iPhone/iPad/iPod) → App Store listing
//   • Android                → /get/android  (in-site "Android coming" waitlist —
//                              Android users are NEVER sent to the App Store)
//   • desktop / everything   → homepage
//
// Incoming query params (the QR's UTMs) are preserved onto the in-site
// destinations so Vercel Web Analytics attributes the scan. The Apple URL can't
// carry them, so they're logged here first for attribution.
//
// Matches this repo's existing api/*.ts convention: a plain (req, res) Node
// serverless handler, no @vercel/node types, no build step.

// Hardcoded to match the rest of the site (index.html hardcodes this same URL
// everywhere — there is no env var for it in this repo). App Store ID: 6760744461.
const APP_STORE_URL = 'https://apps.apple.com/app/now-batting/id6760744461';

export default function handler(req: any, res: any) {
  const ua = String(req.headers['user-agent'] || '');

  // Detection order matters — check Android before iOS.
  let device: 'ios' | 'android' | 'desktop';
  if (/Android/i.test(ua)) device = 'android';
  else if (/iPhone|iPad|iPod/i.test(ua)) device = 'ios';
  else device = 'desktop';

  // Preserve the incoming query string (UTMs) verbatim.
  const url = String(req.url || '');
  const qIndex = url.indexOf('?');
  const queryString = qIndex >= 0 ? url.slice(qIndex + 1) : '';
  const suffix = queryString ? `?${queryString}` : '';

  // Lightweight attribution log. Vercel Web Analytics is client-side only and
  // can't be fired from a server redirect without adding a dependency (this repo
  // has no package.json / build step), so this structured line lands in the
  // Vercel function logs. For the in-site paths the UTMs also survive on the URL
  // for client-side Analytics to pick up; for the App Store path this log is the
  // only attribution, captured BEFORE the redirect.
  const params = new URLSearchParams(queryString);
  try {
    console.log(JSON.stringify({
      event: 'get_redirect',
      device,
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
    }));
  } catch {}

  let destination: string;
  if (device === 'ios') destination = APP_STORE_URL;            // params dropped from Apple URL (logged above)
  else if (device === 'android') destination = `/get/android${suffix}`;
  else destination = `/${suffix}`;

  // no-store so a CDN/browser never caches one device's redirect and serves it
  // to another — the resolution must run fresh on every scan.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.statusCode = 302;
  res.setHeader('Location', destination);
  res.end();
}
