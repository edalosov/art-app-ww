// Serverless function (Vercel Node runtime): given ?url=, fetches that page
// server-side and returns its Open Graph / Twitter preview image + title.
// This is the same "link unfurling" mechanism Slack/Twitter/iMessage use —
// it reads the image the site itself publishes for previews, so it works
// even for pages (like OpenSea) that block being shown inside an <iframe>.

const dns = require('dns').promises;
const net = require('net');

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 300000;
const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0']);

module.exports = async (req, res) => {
  const target = typeof req.query.url === 'string' ? req.query.url : null;
  if (!target) {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  try {
    const result = await fetchPreviewMeta(target);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ error: 'Could not load preview', detail: String((e && e.message) || e) });
  }
};

async function fetchPreviewMeta(startUrl) {
  let current = parseHttpUrl(startUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Identify as a known link-preview bot (same one Facebook/Slack/iMessage
          // use for "unfurling") rather than a made-up name — sites that block
          // unrecognized bots commonly allowlist this one for exactly this purpose.
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect with no location');
      current = parseHttpUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) throw new Error(`Upstream responded ${response.status}`);

    const html = await readLimited(response, MAX_HTML_BYTES);
    const image = extractMeta(html, ['og:image', 'twitter:image']);
    const title = extractMeta(html, ['og:title', 'twitter:title']) || extractTitleTag(html);
    return { image: image ? new URL(image, current).toString() : null, title };
  }
  throw new Error('Too many redirects');
}

function parseHttpUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }
  return parsed;
}

async function assertPublicHost(hostname) {
  const host = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) throw new Error('Blocked host');
  const records = await dns.lookup(host, { all: true });
  for (const { address } of records) {
    if (isPrivateAddress(address)) throw new Error('Refusing to fetch a private/internal address');
  }
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fe80:')) return true; // link-local
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique local
    if (low.startsWith('::ffff:')) {
      const v4 = low.slice('::ffff:'.length);
      return net.isIPv4(v4) ? isPrivateAddress(v4) : true;
    }
    return false;
  }
  return true; // unrecognized format — block to be safe
}

async function readLimited(response, maxBytes) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytesRead = 0;
  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.length;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return html;
}

function extractMeta(html, propertyNames) {
  for (const name of propertyNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
    ];
    for (const re of patterns) {
      const match = html.match(re);
      if (match) return decodeHtmlEntities(match[1]);
    }
  }
  return null;
}

function extractTitleTag(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : null;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}
