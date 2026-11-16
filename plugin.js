// Sitios (prueba 0.2.0): PelisPlusHD, FlixLatam y Cinehax. Películas y series.
// Solo lee páginas públicas. No resuelve verificaciones, captchas ni cuentas.

globalThis.__kinoDropPendingFetches = true; // al terminar una llamada, Kino no espera lo que haya quedado pendiente
const UA = "Mozilla/5.0 (Linux; Android 13; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const SITES = [
  ["pp", "PelisPlusHD", "https://www.pelisplushd.la"],
  ["fl", "FlixLatam", "https://flixlatam.com"],
  ["ch", "Cinehax", "https://cinehax.com"],
];

function log(...a) { try { kino.log(...a); } catch (e) { /* no romper */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function fail(code, detail, es, en) { return kino.error(code, detail, { userMessage: tr(es, en) }); }
function dec(s) {
  return String(s || "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function hostOf(u) { const m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || "")); return m ? m[1] : ""; }
function absUrl(u) {
  let x = String(u || "").trim();
  if (x.startsWith("//")) x = "https:" + x;
  return /^https:\/\//i.test(x) ? x : "";
}
function abs(base, u) {
  u = String(u || "").trim();
  if (!u) return "";
  if (u.startsWith("//")) return "https:" + u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.charAt(0) === "/") return base + u;
  return "";
}
function siteOf(url) { return SITES.find((s) => url.indexOf(s[2].replace(/^https?:\/\/(www\.)?/, "")) >= 0); }

async function get(url, referer) {
  const h = { "User-Agent": UA, "Accept-Language": "es", Accept: "text/html,application/json" };
  if (referer) h.Referer = referer;
  const r = await kino.fetch(url, { headers: h });
  return { status: r.status, ok: r.ok, text: await r.text() };
}


// ---- Catálogo -------------------------------------------------------------------------------------
function kindOf(url) { return /\/(serie|series|anime|animes)\//i.test(url) ? "series" : "movie"; }

function parseCards(base, html) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,900}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 60) {
    const href = abs(base, m[1]);
    if (!href || href.indexOf(base.replace(/^https?:\/\/(www\.)?/, "")) < 0 || seen.has(href)) continue;
    if (!/\/(pelicula|peliculas|serie|series|anime|animes|movie|content)\/[^\/]+/i.test(href)) continue;
    const img = /<img\b[^>]*>/i.exec(m[2]);
    if (!img) continue;
    const alt = /\balt="([^"]{2,})"/i.exec(img[0]) || /\btitle="([^"]{2,})"/i.exec(m[0]);
    const src = /\b(?:data-src|data-lazy-src|src)="([^"]+)"/i.exec(img[0]);
    const title = dec(alt ? alt[1] : "").replace(/^(ver|póster|poster|imagen)\s+/i, "");
    if (!title || title.length < 2) continue;
    seen.add(href);
    out.push({ href, title, poster: src ? abs(base, dec(src[1])) : "" });
  }
  return out;
}

function toItems(id, cards) {
  return cards.map((c) => {
    const kind = kindOf(c.href);
    return { id: id + "-" + c.href.replace(/[^a-z0-9]+/gi, "-").slice(-60), ref: "p|" + encodeURIComponent(c.href), title: c.title.slice(0, 200), kind, genres: [kind === "movie" ? "peliculas" : "series"], poster: c.poster || undefined };
  });
}

const memo = new Map();
function cached(key, ttl, make) {
  const hit = memo.get(key);
  if (hit && hit.at + ttl > Date.now()) return hit.p;
  const p = make();
  memo.set(key, { at: Date.now(), p });
  p.catch(() => { if (memo.get(key) && memo.get(key).p === p) memo.delete(key); });
  return p;
}

async function homeOf(site) {
  const [id, name, base] = site;
  const h = await cached("h:" + id, 120000, () => get(base + "/"));
  if (!h.ok) { log(name + " inicio status=" + h.status); return []; }
  return toItems(id, parseCards(base, h.text));
}

export async function home() {
  await null;
  const res = await Promise.allSettled(SITES.map((s) => homeOf(s)));
  const rows = [];
  res.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length) rows.push({ id: "row-" + SITES[i][0], title: SITES[i][1], genre: "series", ref: SITES[i][0], items: r.value.slice(0, 20) });
    else log("inicio: falló " + SITES[i][1]);
  });
  if (!rows.length) throw fail("unavailable", "ningún sitio respondió", "No se pudo cargar el inicio. Prueba de nuevo en un momento.", "Could not load the home. Try again in a moment.");
  return rows;
}

export async function browse(ref) {
  await null;
  const site = SITES.find((s) => s[0] === String(ref));
  if (!site) throw fail("not_found", "sitio desconocido", "Ese catálogo no existe.", "That catalog does not exist.");
  return { items: await homeOf(site) };
}

export async function search(query) {
  await null;
  const q = String((query && query.q) || "").trim().slice(0, 80);
  if (!q) return [];
  const res = await Promise.allSettled(SITES.map(async ([id, name, base]) => {
    const s = await cached("q:" + id + ":" + q.toLowerCase(), 120000, () => get(base + "/?s=" + encodeURIComponent(q)));
    const cards = parseCards(base, s.text);
    log("buscar " + name + " status=" + s.status + " resultados=" + cards.length);
    return toItems(id, cards.slice(0, 15));
  }));
  const out = [];
  res.forEach((r) => { if (r.status === "fulfilled") out.push.apply(out, r.value); });
  return out;
}

// ---- Capítulos ------------------------------------------------------------------------------------
export async function episodes(ref) {
  await null;
  const url = decodeURIComponent(String(ref || "").slice(2));
  if (!/^https:\/\//i.test(url)) throw fail("not_found", "referencia desconocida", "No se encontró este título.", "Title not found.");
  const site = siteOf(url);
  const base = site ? site[2] : "";
  const h = await cached("t:" + url, 300000, () => get(url));
  if (!h.ok) throw fail("unavailable", "status " + h.status, "El sitio respondió con el error " + h.status + ".", "The site answered with error " + h.status + ".");
  const t = h.text;
  const title = dec((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(t) || /<title>([^<]*)<\/title>/i.exec(t) || [, ""])[1].replace(/<[^>]*>/g, " ")).replace(/\s*[|\-–].*$/, "");
  if (kindOf(url) === "movie") return { series: { title }, episodes: [{ season: 1, number: 1, ref: "p|" + encodeURIComponent(url), title: tr("Película", "Movie") }] };
  // Serie: enlaces a capítulos de esta misma serie.
  const eps = [];
  const seen = new Set();
  const slug = (/\/(?:serie|series|anime|animes)\/([^\/?#]+)/i.exec(url) || [])[1] || "";
  const re = /<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let m;
  while ((m = re.exec(t))) {
    const href = abs(base, m[1]);
    if (!href || seen.has(href) || href === url) continue;
    const sm = /(?:season|temporada)[\/-](\d+)[\/-](?:episode|episodio|capitulo)[\/-](\d+)/i.exec(href) || /\/(\d+)x(\d+)\/?$/.exec(href);
    if (!sm) continue;
    if (slug && href.indexOf(slug) < 0) continue;
    seen.add(href);
    const label = dec(m[2].replace(/<[^>]*>/g, " "));
    eps.push({ season: Number(sm[1]), number: Number(sm[2]), ref: "p|" + encodeURIComponent(href), title: label && label.length < 80 ? label : tr("Episodio ", "Episode ") + sm[2] });
  }
  log("capítulos " + url.slice(0, 70) + ": " + eps.length);
  if (!eps.length) {
    // Aún no se conoce la forma de esta página: se anotan pistas para la siguiente versión.
    (t.match(/href="[^"]*(?:episodio|capitulo|temporada|season|episode)[^"]*"/gi) || []).slice(0, 8).forEach((x, i) => log("pista cap" + i + " " + x.slice(0, 140)));
    throw fail("not_found", "sin capítulos", "No se encontró la lista de capítulos de este título.", "No episode list found for this title.");
  }
  eps.sort((a, b) => (a.season - b.season) || (a.number - b.number));
  return { series: { title }, episodes: eps };
}

// ---- Reproducción ---------------------------------------------------------------------------------
const MEDIA_RE = /["'`]((?:https?:)?\/\/[^"'`\s<>\\]+?\.(?:m3u8|mp4)(?:\?[^"'`\s<>\\]*)?)["'`]/gi;
const DEMO = /big[_-]?buck[_-]?bunny|sintel|elephants?[_-]?dream|tears[_-]?of[_-]?steel|gtv-videos-bucket|commondatastorage|test-?streams|bitdash|bitmovin|mux\.dev|zencdn|flowplayer\.com|jwplatform|test-videos|\/samples?\/|(?:googleapis|gstatic|jsdelivr|cdnjs|unpkg)\./i;
const SKIP_HOST = /(google|gstatic|facebook|doubleclick|cloudflare|jsdelivr|cdnjs|jquery|bootstrap|fontawesome|yandex|adangle)/i;
// Servidores que piden verificación humana o no entregan video: no se intentan.
const USELESS = /dood|mixdrop|susanexpect|nupload|netu|waaw|hqq|fastream/i;

function normText(s) { return String(s || "").replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/&amp;/g, "&"); }

function unpackPacked(src) {
  const re = /\}\s*\(\s*(['"])((?:\\[\s\S]|(?!\1)[^\\])*)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\[\s\S]|(?!\5)[^\\])*)\5\s*\.split\(\s*['"]\|['"]\s*\)/;
  const m = re.exec(src);
  if (!m) return null;
  const payload = m[2].replace(/\\(['"\\])/g, "$1").replace(/\\n/g, "\n");
  const radix = Number(m[3]);
  let count = Number(m[4]);
  if (!(radix >= 2 && radix <= 62) || !(count > 0 && count < 100000)) return null;
  const dict = m[6].split("|");
  const code = (c) => (c < radix ? "" : code(Math.floor(c / radix))) + ((c = c % radix) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
  const map = {};
  while (count--) map[code(count)] = dict[count] || code(count);
  return payload.replace(/\b\w+\b/g, (w) => (map[w] != null ? map[w] : w));
}

function unpackAll(html) {
  const out = [];
  let i = 0;
  while (out.length < 4) {
    const k = html.indexOf("eval(function(p,a,c,k,e", i);
    if (k < 0) break;
    const u = unpackPacked(html.slice(k, k + 80000));
    if (u) out.push(u);
    i = k + 20;
  }
  return out;
}

function base64Texts(html) {
  const out = [];
  const re = /atob\(\s*["']([A-Za-z0-9+\/=_-]{16,})["']\s*\)/g;
  let m;
  while ((m = re.exec(html)) && out.length < 6) {
    try { out.push(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { /* no era base64 */ }
  }
  return out;
}

function findMedia(text, loose, origin) {
  const t = normText(text);
  const re = loose ? /((?:https?:)?\/\/[^\s"'`<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'`<>\\]*)?)/gi : new RegExp(MEDIA_RE.source, "gi");
  let m;
  while ((m = re.exec(t))) {
    const u = absUrl(m[1]);
    if (u && !DEMO.test(u)) return u;
  }
  // Rutas relativas ("/stream/abc/master.m3u8"), muy usadas por streamwish y similares.
  if (origin) {
    const rr = /["'`](\/(?!\/)[^"'`\s<>\\]+?\.(?:m3u8|mp4)(?:\?[^"'`\s<>\\]*)?)["'`]/gi;
    while ((m = rr.exec(t))) { const u = origin + m[1]; if (!DEMO.test(u)) return u; }
  }
  return "";
}

function deepMedia(html, origin) {
  let u = findMedia(html, false, origin);
  if (u) return u;
  for (const t of unpackAll(html)) { u = findMedia(t, false, origin); if (u) return u; }
  for (const t of base64Texts(html)) { u = findMedia(t, true, origin); if (u) return u; }
  return "";
}

// Otras páginas de reproductor que esta página abre (iframes): por si es solo una envoltura.
function innerLinks(html, base) {
  const out = [];
  const t = normText([html].concat(unpackAll(html), base64Texts(html)).join("\n"));
  const re = /<iframe[^>]*src=["']([^"']+)["']|["'`]((?:https?:)?\/\/[^"'`\s<>\\]+\/(?:e|embed|v|f|play|player|stream)\/[A-Za-z0-9_-]{6,})["'`]/gi;
  let m;
  while ((m = re.exec(t)) && out.length < 3) {
    const a = absUrl(m[1] || m[2]);
    if (a && a !== base && out.indexOf(a) < 0 && !SKIP_HOST.test(hostOf(a)) && !USELESS.test(hostOf(a))) out.push(a);
  }
  return out;
}


function playHeaders(pageUrl) {
  const m = /^(https?:\/\/[^\/?#]+)/i.exec(String(pageUrl || ""));
  const h = { Referer: pageUrl, "User-Agent": UA };
  if (m) h.Origin = m[1];
  return h;
}

async function fromEmbed(url, depth, referer) {
  const r = await kino.fetch(url, { headers: { Referer: referer || url, "User-Agent": UA } });
  log("reproductor " + hostOf(url) + " status=" + r.status);
  if (!r.ok) return null;
  const html = await r.text();
  const org = (/^(https?:\/\/[^\/?#]+)/i.exec(url) || [])[1] || "";
  const u = deepMedia(html, org);
  if (u) {
    log("video encontrado en " + hostOf(url));
    return { url: u, mime: /\.m3u8/i.test(u) ? "application/x-mpegurl" : "video/mp4", headers: playHeaders(url) };
  }
  if (depth === 0 || depth >= 1) {
    const inner0 = innerLinks(html, url);
    log("sin video directo en " + hostOf(url) + " largo=" + html.length + " enlaces=" + inner0.map((x) => hostOf(x) + x.replace(/^https?:\/\/[^\/]+/, "").slice(0, 30)).join(",") + " muestra=" + html.replace(/\s+/g, " ").slice(0, 160));
  }
  if (depth >= 1) return null;
  for (const l of innerLinks(html, url)) {
    try { const got = await fromEmbed(l, depth + 1, url); if (got) return got; } catch (e) { /* se prueba el siguiente */ }
  }
  return null;
}

function langRank(name) {
  const t = String(name || "").toLowerCase();
  if (/sub|vose|ingl|english|original/.test(t)) return 2;
  if (/castellano|españa|espanol|español/.test(t)) return 1;
  return 0; // latino
}

// Servidores que ofrece la página del título: data-url="..." data-name="...", iframes y rutas relativas.
function embedsOf(base, pageUrl, html) {
  const out = [];
  const seen = new Set();
  const add = (u, name) => {
    const a = abs(base, dec(u));
    if (!a || seen.has(a) || SKIP_HOST.test(hostOf(a)) || USELESS.test(hostOf(a)) || /youtube|youtu\.be/i.test(a)) return;
    seen.add(a);
    out.push({ url: a, name: name || "", rank: langRank(name) });
  };
  let m;
  const re1 = /<[^>]*\bdata-url="([^"]+)"[^>]*>/gi;
  while ((m = re1.exec(html))) { const n = /data-name="([^"]*)"/i.exec(m[0]); add(m[1], n ? dec(n[1]) : ""); }
  const re2 = /<iframe[^>]*\b(?:data-src|src)="([^"]+)"/gi;
  while ((m = re2.exec(html))) add(m[1], "");
  out.sort((x, y) => x.rank - y.rank);
  return out.slice(0, 10);
}

// kino.sleep solo acepta hasta 5 s: se espera en tandas.
async function sleepUpTo(ms, stop) {
  let left = ms;
  while (left > 0 && !(stop && stop.done)) { const c = Math.min(left, stop ? 500 : 4500); await kino.sleep(c); left -= c; }
  return null;
}

function firstSuccess(tasks) {
  return new Promise((done) => {
    let pending = tasks.length;
    if (!pending) { done(null); return; }
    tasks.forEach((t) => {
      Promise.resolve(t).then((v) => { if (v) done(v); }, () => {}).then(() => { if (--pending === 0) done(null); });
    });
  });
}

export async function resolve(ref) {
  await null;
  const url = decodeURIComponent(String(ref || "").slice(2));
  if (!/^https:\/\//i.test(url)) throw fail("not_found", "referencia desconocida", "No se encontró este título.", "Title not found.");
  const site = siteOf(url);
  const base = site ? site[2] : "";
  const h = await cached("t:" + url, 300000, () => get(url));
  if (!h.ok) throw fail("unavailable", "status " + h.status, "El sitio respondió con el error " + h.status + ".", "The site answered with error " + h.status + ".");
  const embeds = embedsOf(base, url, h.text);
  log("servidores: " + embeds.map((e) => hostOf(e.url) + (e.name ? "(" + e.name + ")" : "")).join(", "));
  if (!embeds.length) throw fail("unavailable", "sin servidores", "No se encontraron servidores de video en esta página.", "No video servers found on this page.");
  // Latino primero; los otros idiomas esperan un poco por si Latino responde.
  const tasks = embeds.map((e, i) => (async () => {
    if (e.rank > 0) await sleepUpTo(Math.min(2500, 1000 * e.rank));
    const got = await fromEmbed(e.url, 0, url);
    return got ? Object.assign(got, { label: e.name || hostOf(e.url) }) : null;
  })());
  const st = { done: false };
  const win = await Promise.race([firstSuccess(tasks), sleepUpTo(15000, st).then(() => null)]);
  st.done = true;
  if (win) return win;
  throw fail("unavailable", "sin video", "No se pudo abrir el video de este título. Prueba otro.", "Could not open this title's video. Try another.");
}
