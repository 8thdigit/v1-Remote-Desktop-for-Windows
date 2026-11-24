// Vercel Routing Middleware for the Connect.AI viewer.
//
// The viewer is a static single-page app, so the title, description, share
// image and favicon an admin sets in /admin → Site settings are only applied
// by script once the page runs. Link previews (WhatsApp, LinkedIn, Facebook,
// X, Slack, Telegram, Discord, search engines) read the HTML without running
// script. For those crawlers only, this fetches the settings from the relay
// and writes them into the HTML. People's browsers are not touched, so normal
// page loads gain no latency.

export const config = {
  matcher: ['/((?!api/|assets/|downloads/).*)'],
};

const RELAY = 'https://msfwr-relay.onrender.com';

const CRAWLER = /bot|crawler|spider|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|slack|twitter|whatsapp|telegram|discord|linkedin|skype|pinterest|vkshare|redditbot|applebot|quora|outbrain|w3c_validator|preview/i;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function setMeta(html, attr, key, value) {
  if (!value) return html;
  const tag = `<meta ${attr}="${key}" content="${esc(value)}" />`;
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[.:]/g, (c) => `\\${c}`)}"[^>]*>`, 'i');
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`);
}

export default async function middleware(request) {
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname === '/index.html' || /\.[a-z0-9]{2,5}$/i.test(url.pathname)) return;
  if (!CRAWLER.test(request.headers.get('user-agent') || '')) return;

  try {
    const relay = (typeof process !== 'undefined' && process.env && process.env.MSFWR_RELAY_URL) || RELAY;
    const signal = AbortSignal.timeout(2500);
    const [page, settings] = await Promise.all([
      fetch(new URL('/index.html', url), { signal }),
      fetch(`${relay}/api/site/settings`, { signal }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (!page.ok || !settings) return;
    let html = await page.text();
    const title = settings.og && settings.og.title;
    const description = settings.og && settings.og.description;
    const image = settings.ogImage ? new URL(settings.ogImage.url, url.origin).href : '';
    if (title) html = html.replace(/<title>[^<]*<\/title>/i, `<title>${esc(title)}</title>`);
    html = setMeta(html, 'name', 'description', description);
    html = setMeta(html, 'property', 'og:title', title);
    html = setMeta(html, 'property', 'og:description', description);
    html = setMeta(html, 'property', 'og:url', url.origin + url.pathname);
    html = setMeta(html, 'property', 'og:image', image);
    html = setMeta(html, 'name', 'twitter:title', title);
    html = setMeta(html, 'name', 'twitter:description', description);
    html = setMeta(html, 'name', 'twitter:image', image);
    if (settings.favicon) {
      html = html.replace(/<link rel="icon"[^>]*>/i, `<link rel="icon" type="${esc(settings.favicon.type)}" href="${esc(settings.favicon.url)}" />`);
    }
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
    });
  } catch {
    // The relay is asleep or slow: serve the static page with its default tags.
    return;
  }
}
