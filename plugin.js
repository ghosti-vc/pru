// PelisMart 0.1.0. Solo lee páginas públicas. No resuelve verificaciones, captchas ni cuentas.
globalThis.__kinoDropPendingFetches = true;
const BASE = "https://pelismart.mov";
const UA = "Mozilla/5.0 (Linux; Android 13; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const LISTS = { pe: ["Películas", "/peliculas"], se: ["Series", "/series"], an: ["Animes", "/animes"], dr: ["Doramas", "/generos/dorama"] };

function log(...a) { try { kino.log(...a); } catch (e) { /* no romper */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function fail(code, detail, es, en) { return kino.error(code, detail, { userMessage: tr(es, en) }); }
function dec(s) {
  return String(s || "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&mdash;/g, "-").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function hostOf(u) { const m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || "")); return m ? m[1] : ""; }
function abs(u) {
  u = dec(u);
  if (!u) return "";
  if (u.startsWith("//")) return "https:" + u;
  if (/^https:\/\//i.test(u)) return u;
  if (u.charAt(0) === "/") return BASE + u;
  return "";
}

async function get(url, referer, accept) {
  const h = { "User-Agent": UA, "Accept-Language": "es", Accept: accept || "text/html,application/json,*/*" };
  h.Referer = referer || BASE + "/";
  const r = await kino.fetch(url, { headers: h });
  return { status: r.status, ok: r.ok, text: await r.text(), res: r };
}
async function page(path) {
  const r = await get(BASE + path);
  if (!r.ok) throw fail(r.status === 403 ? "geo_blocked" : "unavailable", "status " + r.status, "El sitio respondió con el error " + r.status + ".", "The site answered with error " + r.status + ".");
  return r.text;
}

// ---- Tarjetas ---------------------------------------------------------------------------------------
function parseCards(html) {
  const out = [], seen = new Set();
  const parts = html.split('class="card"').slice(1);
  for (const p of parts) {
    const a = /<a href="\/(pelicula|serie|anime)\/([^"#?\/]+)"/i.exec(p);
    if (!a || seen.has(a[2])) continue;
    const alt = /<img[^>]*\balt="([^"]*)"/i.exec(p);
    const t = /class="card__title"[^>]*><a[^>]*>([^<]+)</i.exec(p);
    const src = /<img[^>]*\bsrc="([^"]+)"/i.exec(p);
    const yr = /class="year">(\d{4})/i.exec(p);
    const title = dec(t ? t[1] : alt ? alt[1] : "");
    if (!title) continue;
    seen.add(a[2]);
    const isMovie = a[1].toLowerCase() === "pelicula";
    out.push({
      id: "pm-" + a[2], ref: (isMovie ? "m|" : a[1].toLowerCase() === "anime" ? "a|" : "s|") + a[2],
      title: title.slice(0, 200), kind: isMovie ? "movie" : "series",
      genres: [isMovie ? "peliculas" : "series"], poster: src ? abs(src[1]) || undefined : undefined,
      year: yr ? Number(yr[1]) : undefined,
    });
  }
  const ep = html.split('class="card-episode"').slice(1);
  for (const p of ep) {
    const a = /<a href="(?:https:\/\/pelismart\.mov)?\/(serie|anime)\/([^"#?\/]+)/i.exec(p);
    if (!a || seen.has(a[2])) continue;
    const alt = /<img[^>]*\balt="([^"]*)"/i.exec(p);
    const src = /<img[^>]*\bsrc="([^"]+)"/i.exec(p);
    const title = dec(alt ? alt[1] : "");
    if (!title) continue;
    seen.add(a[2]);
    out.push({ id: "pm-" + a[2], ref: (a[1].toLowerCase() === "anime" ? "a|" : "s|") + a[2], title: title.slice(0, 200), kind: "series", genres: ["series"], poster: src ? abs(src[1]) || undefined : undefined });
  }
  return out;
}

export async function home() {
  await null;
  const html = await page("/");
  const rows = [];
  const secs = html.split(/<h2 class="section__title">/i).slice(1);
  secs.forEach((s, i) => {
    const name = dec((/^([\s\S]*?)<\/h2>/i.exec(s) || [, ""])[1].replace(/<[^>]*>/g, ""));
    const items = parseCards(s);
    log("inicio " + name + " -> " + items.length);
    if (name && items.length && !/comentarios/i.test(name)) rows.push({ id: "row-" + i, title: name, ref: "x", items: items.slice(0, 24) });
  });
  for (const k of Object.keys(LISTS)) rows.push({ id: "cat-" + k, title: LISTS[k][0], ref: k, items: [] });
  const withItems = rows.filter((r) => r.items.length);
  if (!withItems.length) throw fail("unavailable", "sin catálogo", "No se pudo cargar el inicio. Usa el buscador.", "Could not load the home. Use search.");
  return withItems;
}

export async function browse(ref, cursor) {
  await null;
  const L = LISTS[String(ref)];
  if (!L) throw fail("not_found", "catálogo desconocido", "Ese catálogo no existe.", "That catalog does not exist.");
  const n = Math.max(1, Number(cursor) || 1);
  const html = await page(L[1] + (n > 1 ? "?page=" + n : ""));
  const items = parseCards(html);
  log("catálogo " + L[0] + " página " + n + " -> " + items.length);
  return { items, nextCursor: items.length >= 12 ? String(n + 1) : undefined };
}

export async function search(query) {
  await null;
  const q = String((query && query.q) || "").trim().slice(0, 80);
  if (!q) return [];
  const html = await page("/search?s=" + encodeURIComponent(q));
  const items = parseCards(html);
  log("buscar '" + q + "' -> " + items.length);
  return items;
}

// ---- Capítulos --------------------------------------------------------------------------------------
export async function episodes(ref) {
  await null;
  const p = String(ref || "").split("|");
  const kind = p[0], slug = p[1];
  if (!slug) throw fail("not_found", "ref vacía", "No se encontró este título.", "Title not found.");
  if (kind === "m") return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: "m|" + slug, title: tr("Película", "Movie") }] };
  const html = await page("/" + (kind === "a" ? "anime" : "serie") + "/" + slug);
  const title = dec((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [, ""])[1].replace(/<[^>]*>/g, ""));
  const eps = [], seen = new Set();
  const re = /<li>\s*<aside class="epi_desc">([\s\S]*?)<\/aside>\s*<a href="#s\d+-e\d+"([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const s = /data-season="(\d+)"/.exec(m[2]), e = /data-episode="(\d+)"/.exec(m[2]);
    if (!s || !e) continue;
    const key = s[1] + "x" + e[1];
    if (seen.has(key)) continue;
    seen.add(key);
    const label = dec((/<div>([\s\S]*?)<\/div>/i.exec(m[1]) || [, ""])[1].replace(/<[^>]*>/g, ""));
    eps.push({ season: Number(s[1]), number: Number(e[1]), ref: "e|" + kind + "|" + slug + "|" + s[1] + "|" + e[1], title: label && label.length > 2 && label.length < 80 ? label : tr("Episodio ", "Episode ") + e[1] });
  }
  log("capítulos " + slug + " -> " + eps.length);
  if (!eps.length) throw fail("not_found", "sin capítulos", "No se encontraron capítulos.", "No episodes found.");
  eps.sort((a, b) => a.season - b.season || a.number - b.number);
  return { series: { title }, episodes: eps };
}

// ---- Reproducción -----------------------------------------------------------------------------------
function mediaIn(html, org) {
  const t = String(html || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const re = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  let m;
  while ((m = re.exec(t))) { if (!/(demo|sample|trailer|youtube)/i.test(m[0])) return m[0]; }
  const f = /(?:file|src|source|hls|video_url)\s*[:=]\s*["'](\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i.exec(t);
  return f && org ? org + f[1] : "";
}
function framesIn(html, base) {
  const out = [];
  const re = /<iframe[^>]*\bsrc=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) { const u = m[1].startsWith("/") ? base + m[1] : m[1].startsWith("//") ? "https:" + m[1] : m[1]; if (/^https:\/\//i.test(u)) out.push(u); }
  const re2 = /(?:location(?:\.href)?\s*=|window\.open\()\s*["']([^"']+)["']/gi;
  while ((m = re2.exec(html))) if (/^https:\/\//i.test(m[1])) out.push(m[1]);
  const mr = /http-equiv=["']refresh["'][^>]*url=([^"'>\s]+)/i.exec(html);
  if (mr && /^https:\/\//i.test(mr[1])) out.push(mr[1]);
  return out;
}
function result(u, referer) {
  return { url: u, mime: /\.m3u8/i.test(u) ? "application/x-mpegurl" : "video/mp4", headers: { Referer: referer, "User-Agent": UA } };
}
async function capture(url, referer) {
  if (typeof kino.browser !== "object" || !kino.browser || typeof kino.browser.capture !== "function") return null;
  const pg = await kino.browser.capture(url, { timeoutMs: 12000, headers: { Referer: referer } });
  const media = pg && Array.isArray(pg.media) ? pg.media : [];
  const f = media.find((x) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url) && !/(demo|sample|trailer)/i.test(x.url));
  if (!f) return null;
  const out = { url: f.url, mime: f.mime || f.mimeType || (/\.m3u8/i.test(f.url) ? "application/x-mpegurl" : "video/mp4") };
  if (f.headers && typeof f.headers === "object") out.headers = f.headers;
  return out;
}

// Sigue vidurl -> iframes/redirecciones, anotando en el registro lo que ve (para depurar).
async function follow(url, referer, depth) {
  if (depth > 3) return null;
  let r;
  try { r = await get(url, referer); } catch (e) { log("vidurl fallo de red " + hostOf(url)); return null; }
  let finalUrl = url;
  try { if (r.res && r.res.url) finalUrl = r.res.url; } catch (e) { /* sin url final */ }
  const html = r.text || "";
  log("paso" + depth + " " + hostOf(url) + url.replace(/^https?:\/\/[^\/]+/, "").slice(0, 40) + " status=" + r.status + " final=" + hostOf(finalUrl) + " largo=" + html.length);
  if (!r.ok) { log("cuerpo: " + html.replace(/\s+/g, " ").slice(0, 200)); return null; }
  const org = (/^(https?:\/\/[^\/?#]+)/i.exec(finalUrl) || [])[1] || "";
  const m = mediaIn(html, org);
  if (m) { log("video encontrado en " + hostOf(finalUrl)); return result(m, org + "/"); }
  const next = framesIn(html, org);
  log("enlaces: " + next.map((x) => hostOf(x)).join(",") + " | inicio: " + html.replace(/\s+/g, " ").slice(0, 160));
  for (const n of next.slice(0, 3)) { const v = await follow(n, finalUrl, depth + 1); if (v) return v; }
  return null;
}

export async function resolve(ref) {
  await null;
  const p = String(ref || "").split("|");
  let vid = [];
  if (p[0] === "m") {
    const html = await page("/pelicula/" + p[1]);
    const re = /<button[^>]*class="server-btn[^"]*"[^>]*data-url="([^"]+)"[^>]*>([^<]*)</gi;
    let m;
    while ((m = re.exec(html))) vid.push({ url: abs(m[1]), name: dec(m[2]) });
  } else if (p[0] === "e") {
    const r = await get(BASE + "/api/episodio/" + (p[1] === "a" ? "anime" : "serie") + "/" + encodeURIComponent(p[2]) + "/" + p[3] + "/" + p[4], BASE + "/", "application/json");
    if (!r.ok) throw fail("unavailable", "status " + r.status, "El sitio respondió con el error " + r.status + ".", "The site answered with error " + r.status + ".");
    let html = "";
    try { html = String(JSON.parse(r.text).html || ""); } catch (e) { /* respuesta inesperada */ }
    const re = /<(?:iframe|button)[^>]*(?:src|data-url)="([^"]+)"/gi;
    let m;
    while ((m = re.exec(html))) vid.push({ url: abs(m[1]), name: "" });
  } else throw fail("not_found", "referencia desconocida", "No se encontró este título.", "Title not found.");
  vid = vid.filter((v) => v.url);
  log("servidores: " + vid.map((v) => v.name + "@" + v.url.replace(BASE, "")).join(" ; "));
  if (!vid.length) throw fail("not_found", "sin servidores", "Este título no tiene servidores de video.", "No video servers for this title.");
  for (const v of vid) {
    const hit = await follow(v.url, BASE + "/", 0);
    if (hit) return hit;
    try {
      const c = await capture(v.url, BASE + "/");
      if (c) { log("video por navegador"); return c; }
    } catch (e) { log("navegador falló"); }
  }
  throw fail("unavailable", "sin video", "No se pudo sacar el video de este servidor.", "Could not get the video from this server.");
}
