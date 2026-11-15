// PelisForte - películas y series de pelisforte.se.
// Plugin ligero, hecho desde cero. Primera versión: lee el sitio como una página WordPress y deja en el registro lo que ve
// para afinar los detalles. No salta captchas ni verificaciones.

const PF = "https://www2.pelisforte.se";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HOME_ROW = 20;

// ---- Utilidades ---------------------------------------------------------------------------------
// Ajuste "Idioma preferido": "latino" (por defecto) u "original" (subtitulado). Si no se puede leer, Latino.
function wantLatino_unused() {
  try { return String(kino.config.get("audio") || "latino") !== "original"; } catch (e) { return true; }
}

// Memoria corta: si vuelves atrás o reabres lo mismo, se muestra al instante.
const memo = new Map();
function cached(key, ttl, make) {
  const hit = memo.get(key);
  if (hit && hit.at + ttl > Date.now()) return hit.p;
  const p = make();
  memo.set(key, { at: Date.now(), p });
  p.catch(() => { if (memo.get(key) && memo.get(key).p === p) memo.delete(key); });
  if (memo.size > 60) memo.delete(memo.keys().next().value);
  return p;
}
function log(...a) { try { kino.log(...a); } catch (e) { /* el registro no debe romper nada */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function enc(s) { return encodeURIComponent(String(s)); }

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}
function stripTags(s) { return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")); }
function hostOf(u) { const m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || "")); return m ? m[1] : ""; }
function absUrl(u) {
  let x = String(u || "").trim();
  if (x.startsWith("//")) x = "https:" + x;
  return /^https:\/\//i.test(x) ? x : "";
}

// kino.sleep solo acepta hasta 5 s: se espera en tandas, y se puede cortar antes.
async function sleepUpTo(ms, stop) {
  let left = ms;
  while (left > 0 && !(stop && stop.done)) {
    const c = Math.min(left, 1000);
    await kino.sleep(c);
    left -= c;
  }
}

function withTimeout(p, ms) {
  const stop = { done: false };
  const timer = sleepUpTo(ms, stop).then(() => { throw new Error("tardó demasiado"); });
  timer.catch(() => {});
  return Promise.race([Promise.resolve(p).finally(() => { stop.done = true; }), timer]);
}

function fail(code, detail, es, en) {
  return kino.error(code, detail, { userMessage: tr(es, en) });
}

async function getText(url, headers) {
  let r;
  try { r = await kino.fetch(url, { headers: headers || {} }); }
  catch (e) {
    log("fetch falló " + hostOf(url) + ": " + String((e && e.message) || e).slice(0, 60));
    throw fail("unavailable", "fetch falló", "No se pudo abrir el sitio. Prueba de nuevo en un momento.", "Could not open the site. Try again in a moment.");
  }
  if (!r.ok) {
    log("fetch " + hostOf(url) + " status=" + r.status);
    if (r.status === 404) throw fail("not_found", "404", "No se encontró lo que buscabas.", "Not found.");
    if (r.status === 429) throw fail("rate_limited", "429", "El sitio pide esperar un poco. Prueba en un momento.", "The site asks to wait a moment.");
    throw fail("unavailable", "status " + r.status, "El sitio respondió con el error " + r.status + ".", "The site answered with error " + r.status + ".");
  }
  return r.text();
}


// ---- Catálogo --------------------------------------------------------------------------------------
const SECTIONS = {
  peliculas: { base: "/todas-las-peliculas", title: ["Películas", "Movies"], genre: "peliculas" },
  series: { base: "/series-1746289646", title: ["Series", "Series"], genre: "series" },
  estrenos: { base: "/release/2026", title: ["Estrenos 2026", "New 2026"], genre: "peliculas" },
};
// Primer tramo de la dirección que NO es una ficha (géneros, años, páginas...).
const NOT_CARD = /^(peliculas|pelis|release|letter|genero|generos|category|tag|page|series|todas-las-peliculas|portal\d*|wp-content|wp-json|author|feed)$/i;

function humanSlug(s) {
  return decodeEntities(String(s || "").replace(/-\d{7,}$/, "").replace(/-(19|20)\d{2}$/, "").replace(/-/g, " ")).replace(/\b\w/g, (c) => c.toUpperCase());
}

// Cada ficha: un enlace /<tipo>/<nombre>-<número largo>. Se toma el bloque (<li> o <article>) que lo rodea para sacar título y póster.
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*?href=["'](?:https?:\/\/[^"'\/]*pelisforte\.se)?(\/([a-z0-9-]+)\/([^"'\/?#]+-\d{7,}))\/?["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 120) {
    const seg = m[2].toLowerCase();
    const path = m[1];
    if (NOT_CARD.test(seg) || seen.has(path)) continue;
    seen.add(path);
    let a = Math.max(html.lastIndexOf("<li", m.index), html.lastIndexOf("<article", m.index));
    if (a < 0 || m.index - a > 1800) a = Math.max(0, m.index - 500);
    let b = html.indexOf("</li>", m.index);
    const b2 = html.indexOf("</article>", m.index);
    if (b < 0 || (b2 >= 0 && b2 < b)) b = b2;
    if (b < 0 || b - m.index > 1800) b = Math.min(html.length, m.index + 900);
    const block = html.slice(a, b);
    const h = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(block);
    const ta = /title=["']([^"']{2,})["']/i.exec(m[0]);
    const im = /<img\b[^>]*>/i.exec(block);
    const alt = im ? /alt=["']([^"']*)["']/i.exec(im[0]) : null;
    let title = stripTags(h ? h[1] : ta ? ta[1] : alt ? alt[1].replace(/^Image\s+/i, "") : "");
    if (!title) title = humanSlug(m[3]);
    let poster = "";
    if (im) {
      const g = /(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/gi;
      let x;
      while ((x = g.exec(im[0]))) { if (!/^data:/i.test(x[1])) { poster = x[1]; if (!/lazy|placeholder|blank/i.test(poster)) break; } }
      if (poster.charAt(0) === "/") poster = PF + poster;
      poster = poster.replace(/-\d{2,3}x\d{2,3}(\.\w+)$/, "-185x278$1");
    }
    const ym = /-((?:19|20)\d{2})-\d{7,}$/.exec(m[3]);
    const movie = seg === "pelicula" || seg === "peliculas";
    out.push({
      id: "pf-" + m[3].slice(-14),
      ref: (movie ? "m|" : "s|") + enc(path),
      title: title.slice(0, 200),
      kind: movie ? "movie" : "series",
      genres: [movie ? "peliculas" : "series"],
      poster: /^https?:/i.test(poster) ? poster : undefined,
      year: ym ? Number(ym[1]) : undefined,
    });
  }
  return out;
}

function diag(html, tag) {
  const hrefs = [];
  const rh = /href=["'](?:https?:\/\/[^"'\/]*pelisforte\.se)?(\/[^"'?#\s]{2,80})["']/gi;
  let x;
  while ((x = rh.exec(html)) && hrefs.length < 400) {
    const f = x[1].replace(/\d{3,}/g, "#");
    if (hrefs.indexOf(f) < 0) hrefs.push(f);
  }
  log("PelisForte " + tag + " bytes=" + html.length + " <li=" + (html.split("<li").length - 1) + " <article=" + (html.split("<article").length - 1) + " <img=" + (html.split("<img").length - 1));
  log("PelisForte " + tag + " enlaces: " + hrefs.slice(0, 14).join(" , "));
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  log("PelisForte " + tag + " texto: " + body.slice(0, 160));
}

async function listPage(sec, n, per) {
  const s = SECTIONS[sec];
  const html = await getText(PF + s.base + (n > 1 ? "/page/" + n : ""), { Referer: PF + "/" });
  const items = parseCards(html);
  log("PelisForte " + sec + " p" + n + ": " + items.length + " títulos");
  if (!items.length) diag(html, sec);
  return { items: per ? items.slice(0, per) : items, hasNext: html.indexOf("/page/" + (n + 1)) !== -1 };
}

export async function home() {
  await null;
  const ids = Object.keys(SECTIONS);
  const res = await Promise.allSettled(ids.map((k) => cached("h:" + k, 120000, () => withTimeout(listPage(k, 1, HOME_ROW), 9000))));
  const rows = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled" || !r.value.items.length) { log("inicio: sin " + ids[i]); return; }
    rows.push({ id: "row-" + ids[i], title: tr(SECTIONS[ids[i]].title[0], SECTIONS[ids[i]].title[1]), genre: SECTIONS[ids[i]].genre, ref: ids[i], items: r.value.items });
  });
  if (!rows.length) throw fail("unavailable", "inicio vacío", "No se pudo cargar el inicio. Prueba de nuevo en un momento.", "Could not load the home. Try again in a moment.");
  return rows;
}

export async function browse(ref, cursor) {
  await null;
  const k = String(ref || "");
  if (!SECTIONS[k]) throw fail("not_found", "catálogo desconocido", "Ese catálogo no existe.", "That catalog does not exist.");
  const n = Math.max(1, parseInt(cursor, 10) || 1);
  const p = await cached("b:" + k + ":" + n, 120000, () => listPage(k, n));
  const out = { items: p.items };
  if (p.hasNext && p.items.length) out.next = String(n + 1);
  return out;
}

export async function search(query) {
  await null;
  const q = stripTags(query && query.q).slice(0, 100);
  if (!q) return [];
  const html = await cached("q:" + q.toLowerCase(), 120000, () => getText(PF + "/?s=" + enc(q), { Referer: PF + "/" }));
  const items = parseCards(html);
  log("PelisForte búsqueda: " + items.length);
  if (!items.length) diag(html, "búsqueda");
  return items;
}

// ---- Capítulos -------------------------------------------------------------------------------------
export async function episodes(ref) {
  await null;
  const p = String(ref || "").split("|");
  if (p[0] === "m" || p[0] === "e") return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: "m|" + p[1], title: tr("Película", "Movie") }] };
  if (p[0] !== "s" || !p[1]) throw fail("not_found", "referencia desconocida", "No se encontró este título.", "Title not found.");
  const path = decodeURIComponent(p[1]);
  const html = await cached("e:" + path, 300000, () => getText(PF + path, { Referer: PF + "/" }));
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const out = [];
  const seen = new Set();
  const add = (href, s, e, label) => {
    const k = s + "x" + e;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ season: Number(s), number: Number(e), ref: "e|" + enc(href), title: stripTags(label) || tr("Episodio ", "Episode ") + e });
  };
  let m;
  // dirección con temporada y capítulo: ...-1x2, ...temporada-1-capitulo-2, .../1/2
  const re = /<a\b[^>]*?href=["']((?:https?:\/\/[^"'\/]*pelisforte\.se)?(\/[^"'?#]*?(?:(\d{1,2})x(\d{1,3})|temporada[-\/](\d{1,2})[-\/](?:episodio|capitulo|cap)[-\/]?(\d{1,3}))[^"'?#]*))["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  while ((m = re.exec(html)) && out.length < 600) {
    const href = m[1].replace(/^https?:\/\/[^\/]+/i, "");
    add(href, m[3] ? m[2] : m[4], m[3] ? m[3] : m[5], m[6]);
  }
  log("PelisForte episodios: " + out.length);
  if (!out.length) diag(html, "serie");
  if (!out.length) throw fail("not_found", "sin capítulos", "No se encontró la lista de capítulos de este título.", "No episode list found for this title.");
  out.sort((a, b) => (a.season - b.season) || (a.number - b.number));
  return { series: { title: h1 ? stripTags(h1[1]).replace(/^ver\s+/i, "") : humanSlug(path.split("/").pop()) }, episodes: out };
}

// ---- Reproducción ----------------------------------------------------------------------------------
// Desarma los scripts "empaquetados" y los textos base64 de la página del reproductor (sin ejecutar nada).
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

function findMedia(text, loose) {
  const t = normText(text);
  const re = loose ? /((?:https?:)?\/\/[^\s"'`<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'`<>\\]*)?)/gi : new RegExp(MEDIA_RE.source, "gi");
  let m;
  while ((m = re.exec(t))) {
    const u = absUrl(m[1]);
    if (u && !DEMO.test(u)) return u;
  }
  return "";
}

function deepMedia(html) {
  let u = findMedia(html);
  if (u) return u;
  for (const t of unpackAll(html)) { u = findMedia(t); if (u) return u; }
  for (const t of base64Texts(html)) { u = findMedia(t, true); if (u) return u; }
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
  const r = await kino.fetch(url, { headers: { Referer: referer || LM + "/" } });
  log("reproductor " + hostOf(url) + " status=" + r.status);
  if (!r.ok) return null;
  const html = await r.text();
  const u = deepMedia(html);
  if (u) {
    log("video encontrado en " + hostOf(url));
    return { url: u, mime: /\.m3u8/i.test(u) ? "application/x-mpegurl" : "video/mp4", headers: playHeaders(url) };
  }
  if (depth >= 1) return null;
  for (const l of innerLinks(html, url)) {
    try { const got = await fromEmbed(l, depth + 1, url); if (got) return got; } catch (e) { /* se prueba el siguiente */ }
  }
  return null;
}

// 0 = el idioma que pide el ajuste, 1 = castellano, 2 = el otro.
function langOf_unused(t) {
  t = String(t || "").toLowerCase();
  const orig = /sub|vose|ingl|english|japon|corean|chin|portug|original/.test(t);
  const cast = /castellano|españa|espanol|español/.test(t);
  if (wantLatino()) return orig ? 2 : cast ? 1 : 0;
  return orig ? 0 : cast ? 1 : 2;
}
function langName(t) {
  t = String(t || "").toLowerCase();
  if (/sub|vose/.test(t)) return tr("Subtitulado", "Subbed");
  if (/ingl|english|japon|corean|chin|portug|original/.test(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  if (/castellano|españa|espanol|español/.test(t)) return "Castellano";
  return "Latino";
}
// Orden de servidores: los que mejor funcionan primero.
function rankOf(host) {
  if (/vimeos/i.test(host)) return 0;
  if (/goodstream/i.test(host)) return 1;
  if (/voe/i.test(host)) return 6;
  return 3;
}

// Devuelve el primer resultado que llegue (no el último).
function firstSuccess(tasks) {
  return new Promise((done) => {
    let pending = tasks.length;
    if (!pending) { done(null); return; }
    tasks.forEach((t) => {
      Promise.resolve(t).then((v) => { if (v) done(v); }, () => {}).then(() => { if (--pending === 0) done(null); });
    });
  });
}


const HOSTS = /voe|vimeos|goodstream|filemoon|streamwish|hlswish|embedwish|wishembed|vidhide|streamhg|streamtape|uqload|upstream|luluvdo|lulustream|vidguard|mp4upload|yourupload|sendvid|ok\.ru|fembed|wolfstream|doodstream|dood|mixdrop|netu|waaw|hqq|streamlare|vtube|veev|bigwarp|savefiles|streamruby|rubystm|vkvideo/i;

// Reproductores que la página muestra: iframes, atributos data-*, textos base64 y direcciones de servidores conocidos.
function pagePlayers(html) {
  const out = [];
  const seen = new Set();
  const push = (u, label) => {
    const a = absUrl(decodeEntities(String(u || "")).replace(/\\\//g, "/"));
    if (!a || seen.has(a) || SKIP_HOST.test(hostOf(a)) || /youtube|youtu\.be|pelisforte\.se\/(?:wp-|aviso)/i.test(a) || /\.(?:jpg|jpeg|png|gif|webp|svg|css|js)(\?|$)/i.test(a)) return;
    seen.add(a);
    out.push({ url: a, label: label || hostOf(a) });
  };
  const texts = [html].concat(base64Texts(html));
  for (const t of texts) {
    let m;
    const ri = /<iframe\b[^>]*?(?:data-src|data-lazy-src|src)=["']([^"']+)["']/gi;
    while ((m = ri.exec(t))) push(m[1], "");
    const rd = /data-(?:src|url|video|embed|player|link|iframe|href)=["']((?:https?:)?\/\/[^"']+)["']/gi;
    while ((m = rd.exec(t))) push(m[1], "");
    const rh = /["']((?:https?:)?(?:\\?\/){2}[^"'\s<>\\]*\\?\/[^"'\s<>]*)["']/gi;
    while ((m = rh.exec(t)) && out.length < 30) if (HOSTS.test(hostOf(absUrl(String(m[1]).replace(/\\\//g, "/"))))) push(m[1], "");
  }
  return out;
}

export async function resolve(ref) {
  await null;
  const p = String(ref || "").split("|");
  if ((p[0] !== "m" && p[0] !== "e") || !p[1]) throw fail("not_found", "referencia desconocida", "No se encontró este título.", "Title not found.");
  const path = decodeURIComponent(p[1]);
  const html = await getText(PF + path, { Referer: PF + "/" });
  let players = pagePlayers(html);
  log("PelisForte reproductores en la página: " + players.length + (players.length ? " (" + players.map((x) => hostOf(x.url)).join(",") + ")" : ""));
  if (!players.length) {
    log("PelisForte sin reproductores: iframes=" + (html.split("<iframe").length - 1) + " atob=" + (html.split("atob(").length - 1) + " trembed=" + (/trembed|trid=/i.test(html) ? "si" : "no") + " data-=" + (html.match(/data-(?:src|url|video|embed|player)=/gi) || []).length);
    const aj = /(admin-ajax\.php|wp-json\/[a-z0-9\/_-]+|\/api\/[a-z0-9\/_-]+)/gi;
    const found = [];
    let x;
    while ((x = aj.exec(html)) && found.length < 6) if (found.indexOf(x[1]) < 0) found.push(x[1]);
    log("PelisForte rutas de api vistas: " + found.join(" , "));
  }
  // páginas intermedias del propio sitio (por ejemplo ?trembed=0): se abren para sacar el reproductor real
  const inner = players.filter((x) => /pelisforte\.se/i.test(hostOf(x.url)));
  if (inner.length) {
    const more = await Promise.allSettled(inner.slice(0, 4).map(async (x) => pagePlayers(await getText(x.url, { Referer: PF + "/" }))));
    more.forEach((r) => { if (r.status === "fulfilled") players = players.concat(r.value); });
    players = players.filter((x) => !/pelisforte\.se/i.test(hostOf(x.url)));
  }
  const cands = players.filter((x) => !USELESS.test(hostOf(x.url))).map((x) => ({ url: x.url, rank: rankOf(hostOf(x.url)) }));
  cands.sort((a, b) => a.rank - b.rank);
  log("PelisForte servidores a probar: " + cands.map((c) => hostOf(c.url)).join(","));
  if (!cands.length) throw fail("unavailable", "sin servidores", "Este título no trae servidores disponibles por ahora.", "This title has no servers available right now.");
  const stop = { done: false };
  const tasks = cands.slice(0, 5).map(async (c, i) => {
    if (i > 1) await sleepUpTo(1500 * (i - 1), stop);
    if (stop.done) return null;
    const v = await withTimeout(fromEmbed(c.url, 0, PF + "/"), 11000);
    return v ? Object.assign(v, { label: hostOf(c.url) }) : null;
  });
  const got = await firstSuccess(tasks);
  stop.done = true;
  if (got) return got;
  throw fail("unavailable", "ningún servidor entregó el video", "Ningún servidor entregó el video. Prueba otra vez o elige otro título.", "No server delivered the video. Try again or pick another title.");
}
