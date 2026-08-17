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
// QR-scan attribution: every scan fires a durable `qr_scan` event into PostHog
// (see below) BEFORE the redirect, so scans are counted permanently — even iOS
// scans, which redirect straight to Apple and otherwise leave no record. The
// incoming query params (the QR's UTMs) are also preserved onto the in-site
// destinations so Vercel Web Analytics attributes the desktop/Android scans too.
//
// Matches this repo's existing api/*.ts convention: a plain (req, res) Node
// serverless handler, no @vercel/node types, no build step.

// Hardcoded to match the rest of the site (index.html hardcodes this same URL
// everywhere — there is no env var for it in this repo). App Store ID: 6760744461.
const APP_STORE_URL = 'https://apps.apple.com/app/now-batting/id6760744461';

// PostHog capture. The project token is a PUBLIC, write-only ingestion key (the
// same one shipped inside the iOS app), so it is safe to hardcode here; an env
// var overrides it if ever set. Capture is fire-and-forget with a hard timeout —
// it can never slow down or break a scan.
// Minimal Node global decl — this repo has no @types/node / build step.
declare const process: { env: Record<string, string | undefined> };
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';
const POSTHOG_TOKEN =
  process.env.POSTHOG_PROJECT_TOKEN || 'phc_yfUXreiWksqhzb64LfeZ9EGGc6KANmcU2fvXWkRgQtf6';

async function captureScan(props: Record<string, unknown>): Promise<void> {
  if (!POSTHOG_TOKEN) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        api_key: POSTHOG_TOKEN,
        event: 'qr_scan',
        // Anonymous per-scan id — we care about scan volume, not identity.
        distinct_id: `qr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        properties: { ...props, $lib: 'now-batting-get-redirect' },
      }),
    });
  } catch {
    // Never let attribution failure affect the redirect.
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: any, res: any) {
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
  const params = new URLSearchParams(queryString);

  let destination: string;
  if (device === 'ios') destination = APP_STORE_URL;            // params dropped from Apple URL (captured below)
  else if (device === 'android') destination = `/get/android${suffix}`;
  else destination = `/${suffix}`;

  // Durable scan attribution → PostHog. Awaited (with a 1.5s cap) so the event
  // is delivered before the serverless function is frozen post-response; the
  // hard timeout guarantees a slow PostHog never delays the scan noticeably.
  await captureScan({
    device,
    destination_type: device === 'ios' ? 'app_store' : device === 'android' ? 'android_waitlist' : 'homepage',
    utm_source: params.get('utm_source') || null,
    utm_medium: params.get('utm_medium') || null,
    utm_campaign: params.get('utm_campaign') || null,
    referrer: String(req.headers['referer'] || req.headers['referrer'] || '') || null,
  });

  // Keep the legacy structured log line too (harmless, shows in live fn logs).
  try {
    console.log(JSON.stringify({
      event: 'get_redirect',
      device,
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
    }));
  } catch {}

  // no-store so a CDN/browser never caches one device's redirect and serves it
  // to another — the resolution must run fresh on every scan.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.statusCode = 302;
  res.setHeader('Location', destination);
  res.end();
}
