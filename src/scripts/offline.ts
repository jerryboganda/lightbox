// Offline packs: a whole system (its topic pages, the print view and every script, style, font and image they need)
// saved into one Cache Storage bucket. The service worker answers offline page loads from any cache, packs included,
// and keeps this bucket across app updates; signing out wipes it with every other cache.
export const PACKS = 'lb-packs';
const MANIFEST = '/__pack/';
const MAX_ASSETS = 400;

export interface Pack { system: string; label: string; pages: string[]; assets: string[]; bytes: number; at: number }

export const supported = () => typeof caches !== 'undefined' && 'serviceWorker' in navigator;

const same = (u: string) => { try { const x = new URL(u, location.origin); return x.origin === location.origin ? x.pathname + x.search : null; } catch { return null; } };
const isAsset = (p: string) => p.startsWith('/_astro/') || p.startsWith('/_image') || p.startsWith('/icons/');

function pageAssets(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html'), out = new Set<string>();
  const add = (u?: string | null) => { const p = u && same(u.trim()); if (p && isAsset(p)) out.add(p); };
  doc.querySelectorAll('script[src]').forEach((e) => add(e.getAttribute('src')));
  doc.querySelectorAll('link[href]').forEach((e) => add(e.getAttribute('href')));
  doc.querySelectorAll('img[src]').forEach((e) => add(e.getAttribute('src')));
  doc.querySelectorAll('img[srcset], source[srcset]').forEach((e) => e.getAttribute('srcset')!.split(',').forEach((s) => add(s.trim().split(/\s+/)[0])));
  doc.querySelectorAll('astro-island').forEach((e) => { add(e.getAttribute('component-url')); add(e.getAttribute('renderer-url')); });
  // Inline module scripts import their chunks by absolute path.
  doc.querySelectorAll('script:not([src])').forEach((e) => (e.textContent || '').match(/\/_astro\/[\w.-]+\.(?:js|css)/g)?.forEach(add));
  return out;
}

// Chunks import siblings ("./x.js" or "/_astro/x.js"); stylesheets pull fonts with url(...).
function nested(path: string, body: string) {
  const out: string[] = [], dir = path.slice(0, path.lastIndexOf('/') + 1);
  for (const m of body.matchAll(/["'(](\.\/[\w.-]+\.(?:js|css|woff2?))["')]/g)) out.push(dir + m[1].slice(2));
  for (const m of body.matchAll(/\/_astro\/[\w.-]+\.(?:js|css|woff2?|webp|png|jpe?g|svg)/g)) out.push(m[0]);
  return out;
}

async function readManifests(cache: Cache) {
  const keys = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith(MANIFEST));
  const all = await Promise.all(keys.map(async (k) => (await (await cache.match(k))?.json().catch(() => null)) as Pack | null));
  return all.filter((p): p is Pack => !!p?.system);
}

export async function listPacks(): Promise<Pack[]> {
  if (!supported() || !(await caches.has(PACKS))) return [];
  return (await readManifests(await caches.open(PACKS))).sort((a, b) => a.label.localeCompare(b.label));
}

export async function hasPack(system: string) {
  if (!supported() || !(await caches.has(PACKS))) return false;
  return !!(await (await caches.open(PACKS)).match(MANIFEST + system));
}

/** Saves the pack, reporting progress as (done, total). Throws if the system page itself cannot be fetched. */
export async function savePack(system: string, label: string, topicPaths: string[], onProgress?: (done: number, total: number) => void) {
  const cache = await caches.open(PACKS);
  const pages = [`/study/${system}`, ...topicPaths, `/study/${system}/print`];
  const seen = new Set<string>(), queue: string[] = [];
  const want = (p: string) => { if (!seen.has(p) && seen.size < MAX_ASSETS) { seen.add(p); queue.push(p); } };
  const total = () => pages.length + seen.size;
  let bytes = 0, done = 0;

  for (const p of pages) {
    const res = await fetch(p, { credentials: 'same-origin', cache: 'no-cache' }).catch(() => null);
    if (!res?.ok || res.redirected) { if (p === pages[0]) throw new Error('offline'); onProgress?.(++done, total()); continue; }
    const html = await res.clone().text();
    bytes += html.length;
    await cache.put(p, res);
    pageAssets(html).forEach(want);
    onProgress?.(++done, total());
  }
  for (let p = queue.shift(); p; p = queue.shift()) {
    try {
      const res = (await caches.match(p)) || (await fetch(p).catch(() => null));
      if (res?.ok) {
        if (/\.(js|css)$/.test(p)) nested(p, await res.clone().text()).forEach(want);
        bytes += Number(res.headers.get('content-length')) || (await res.clone().blob()).size;
        await cache.put(p, res);
      }
    } catch { /* one missing file must not sink the pack */ }
    onProgress?.(++done, total());
  }
  const pack: Pack = { system, label, pages, assets: [...seen], bytes, at: Date.now() };
  await cache.put(MANIFEST + system, new Response(JSON.stringify(pack), { headers: { 'content-type': 'application/json' } }));
  return pack;
}

/** Removes a pack, keeping any file another pack still needs. */
export async function removePack(system: string) {
  if (!supported() || !(await caches.has(PACKS))) return;
  const cache = await caches.open(PACKS), all = await readManifests(cache);
  const me = all.find((p) => p.system === system);
  if (!me) return;
  const keep = new Set(all.filter((p) => p.system !== system).flatMap((p) => [...p.pages, ...p.assets]));
  await Promise.all([...me.pages, ...me.assets].filter((u) => !keep.has(u)).map((u) => cache.delete(u)));
  await cache.delete(MANIFEST + system);
  if (all.length === 1) await caches.delete(PACKS);
}

export const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
