// Sitios (prueba 0.2.0): PelisPlusHD, FlixLatam y Cinehax. Películas y series.
// Solo lee páginas públicas. No resuelve verificaciones, captchas ni cuentas.

globalThis.__kinoDropPendingFetches = true; // al terminar una llamada, Kino no espera lo que haya quedado pendiente
const UA = "Mozilla/5.0 (Linux; Android 13; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const SITES = [
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
  const f = rHome("f").catch(() => []);
  const a = rHome("a").catch(() => []);
  const res = await Promise.allSettled(SITES.map((s) => homeOf(s)));
  const rows = [];
  const fi = await f, ai = await a;
  if (fi.length) rows.push({ id: "row-f", title: "FanPelis", genre: "peliculas", ref: "f", items: fi.slice(0, 20) });
  if (ai.length) rows.push({ id: "row-a", title: "AllCalidad", genre: "peliculas", ref: "a", items: ai.slice(0, 20) });
  res.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length) rows.push({ id: "row-" + SITES[i][0], title: SITES[i][1], genre: "series", ref: SITES[i][0], items: r.value.slice(0, 20) });
    else log("inicio: falló " + SITES[i][1]);
  });
  if (!rows.length) throw fail("unavailable", "ningún sitio respondió", "No se pudo cargar el inicio. Prueba de nuevo en un momento.", "Could not load the home. Try again in a moment.");
  return rows;
}

export async function browse(ref) {
  await null;
  if (String(ref) === "f" || String(ref) === "a") return { items: await rHome(String(ref)) };
  const site = SITES.find((s) => s[0] === String(ref));
  if (!site) throw fail("not_found", "sitio desconocido", "Ese catálogo no existe.", "That catalog does not exist.");
  return { items: await homeOf(site) };
}

export async function search(query) {
  await null;
  const q = String((query && query.q) || "").trim().slice(0, 80);
  if (!q) return [];
  const rp = ["f", "a"].map((k) => cached("rq:" + k + ":" + q.toLowerCase(), 120000, () => rSearch(k, q)).catch((e) => { log("buscar " + REST[k][0] + " falló"); return []; }));
  const res = await Promise.allSettled(SITES.map(async ([id, name, base]) => {
    const s = await cached("q:" + id + ":" + q.toLowerCase(), 120000, () => get(base + "/?s=" + encodeURIComponent(q)));
    const cards = parseCards(base, s.text);
    log("buscar " + name + " status=" + s.status + " resultados=" + cards.length);
    return toItems(id, cards.slice(0, 15));
  }));
  const out = [];
  res.forEach((r) => { if (r.status === "fulfilled") out.push.apply(out, r.value); });
  const rr = await Promise.all(rp);
  rr.forEach((arr, i) => { log("buscar " + REST[["f", "a"][i]][0] + " resultados=" + arr.length); out.push.apply(out, arr.slice(0, 15)); });
  return out;
}

// ---- Capítulos ------------------------------------------------------------------------------------
export async function episodes(ref) {
  await null;
  if (isRest(ref)) return rEpisodes(ref);
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
    eps.push({ season: Number(sm[1]), number: Number(sm[2]), ref: "p|" + encodeURIComponent(href), title: label && label.length > 3 && label.length < 80 && !/^T\d+$/i.test(label) ? label : tr("Episodio ", "Episode ") + sm[2] });
  }
  // Las temporadas que no traen enlaces se arman con el JSON de la página (cantidad de capítulos).
  const lm = /"containsSeason":(\[[\s\S]*?\])\s*,\s*"(?:creator|genre|actor)"/.exec(t);
  if (lm) {
    let seasons = [];
    try { seasons = JSON.parse(lm[1]); } catch (e) { seasons = []; }
    const seUrl = url.replace(/\/(?:temporada|season)-\d+.*$/, "").replace(/\/$/, "");
    for (const ss of seasons) {
      const sn = Number(ss && ss.seasonNumber);
      const cnt = Number(ss && ss.numberOfEpisodes) || 0;
      if (!sn || !cnt) continue;
      for (let n = 1; n <= cnt && n <= 200; n++) {
        const href = seUrl + "/temporada-" + sn + "/episodio-" + n + "/";
        if (seen.has(href)) continue;
        seen.add(href);
        eps.push({ season: sn, number: n, ref: "p|" + encodeURIComponent(href), title: tr("Episodio ", "Episode ") + n });
      }
    }
  }
  log("capítulos " + url.slice(0, 70) + ": " + eps.length);
  if (!eps.length) {
    // Aún no se conoce la forma de esta página: se anotan pistas para la siguiente versión.
    (t.match(/href="[^"]*(?:episodio|capitulo|temporada|season|episode)[^"]*"/gi) || []).slice(0, 8).forEach((x, i) => log("pista cap" + i + " " + x.slice(0, 140)));
    const paths = {};
    const hre = /href="(?:https?:\/\/[^\/"]+)?(\/[^"#?]{3,90})"/gi;
    let hm;
    while ((hm = hre.exec(t))) { const k = hm[1].replace(/\d+/g, "#"); paths[k] = (paths[k] || 0) + 1; }
    log("pista rutas: " + Object.keys(paths).sort((x, y) => paths[y] - paths[x]).slice(0, 14).join(" , "));
    const dts = (t.match(/data-(?:season|episode|temporada|capitulo|num|id|post|serie)[^>]{0,60}/gi) || []).slice(0, 6);
    log("pista datos: " + dts.join(" ; "));
    const ajx = (t.match(/(?:admin-ajax|wp-json|\/api\/)[^"'\s)]{0,80}/gi) || []).slice(0, 5);
    log("pista api: " + ajx.join(" ; "));
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

function hintsOf(html) {
  const out = [];
  const re = /(?:<iframe[^>]+src|data-(?:src|url|embed|link|id)|\bfile|\bsource|\burl|\bsrc)\s*[=:]\s*["']([^"']{6,170})["']|((?:fetch|ajax|get|post)\s*\(\s*["'][^"']{4,120}["'])/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 8) {
    const v = m[1] || m[2];
    if (/\.(?:css|png|jpe?g|gif|svg|webp|ico|woff2?)(?:\?|$)|^data:|schema\.org|googletagmanager|google-analytics/i.test(v)) continue;
    if (out.indexOf(v) < 0) out.push(v);
  }
  return out;
}

async function captureEmbed(embedUrl, referer, ms) {
  if (typeof kino.browser !== "object" || !kino.browser || typeof kino.browser.capture !== "function") return null;
  const page = await kino.browser.capture(embedUrl, { timeoutMs: ms, headers: { Referer: referer } });
  const media = page && Array.isArray(page.media) ? page.media : [];
  const first = media.find((x) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url) && !DEMO.test(x.url));
  if (!first) return null;
  const out = { url: first.url, mime: first.mime || first.mimeType || (/\.m3u8(\?|$)/i.test(first.url) ? "application/x-mpegurl" : "video/mp4") };
  if (first.headers && typeof first.headers === "object") out.headers = first.headers;
  return out;
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
    log("sin video directo en " + hostOf(url) + " largo=" + html.length + " enlaces=" + inner0.map((x) => hostOf(x) + x.replace(/^https?:\/\/[^\/]+/, "").slice(0, 30)).join(",") + " pistas=" + hintsOf(html).join(" ; "));
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

// Prueba los servidores que ofrece una página: el primero que entregue video gana.
async function playEmbeds(embeds, pageUrl) {
  log("servidores: " + embeds.map((e) => hostOf(e.url) + (e.name ? "(" + e.name + ")" : "")).join(", "));
  if (!embeds.length) throw fail("unavailable", "sin servidores", "No se encontraron servidores de video en esta página.", "No video servers found on this page.");
  // Los servidores que casi siempre entregan video arrancan primero; los demás esperan un poco. Así, si uno gana pronto,
  // no quedan peticiones lentas pendientes (Kino no da por lista la llamada hasta que terminan).
  const hostDelay = (h) => (/videoapi|vimeos|goodstream|lamovie/i.test(h) ? 0 : /moviemaster/i.test(h) ? 1000 : /tukiplay|unlimplay/i.test(h) ? 2500 : 1200);
  const tasks = embeds.map((e) => (async () => {
    const wait = Math.max(e.rank > 0 ? Math.min(2500, 1000 * e.rank) : 0, hostDelay(hostOf(e.url)));
    if (wait) await sleepUpTo(wait);
    const got = await fromEmbed(e.url, 0, pageUrl);
    return got ? Object.assign(got, { label: e.name || hostOf(e.url) }) : null;
  })());
  // Respaldo: reproductores que se arman con JavaScript (streamwish, vidhide...) se abren en el navegador oculto.
  const JSHOST = /wish|vidhide|filelions|dhcplay|hgcloud|dintezuvio|minochinos|callistanise|vibuxer|hglink|flixlatam/i;
  const cands = embeds.filter((e) => JSHOST.test(hostOf(e.url))).slice(0, 2);
  // Solo una página oculta a la vez (si no, Kino responde "busy"): se prueban en fila.
  const capTasks = cands.length ? [(async () => {
    await sleepUpTo(700);
    for (const e of cands) {
      log("navegador oculto: " + hostOf(e.url));
      try {
        const got = await captureEmbed(e.url, pageUrl, 11000);
        if (got) { log("navegador oculto: video en " + hostOf(e.url)); return Object.assign(got, { label: e.name || hostOf(e.url) }); }
      } catch (er) { log("navegador oculto falló: " + String((er && er.message) || er).slice(0, 60)); }
    }
    return null;
  })()] : [];
  const st = { done: false };
  const win = await Promise.race([firstSuccess(tasks.concat(capTasks)), sleepUpTo(15000, st).then(() => null)]);
  st.done = true;
  if (win) return win;
  throw fail("unavailable", "sin video", "No se pudo abrir el video de este título. Prueba otro.", "Could not open this title's video. Try another.");
}

// ---- Sitios con API rest (FanPelis y AllCalidad usan el mismo motor) ---------------------------------------
const REST = { f: ["FanPelis", "https://fanpelis.to"], a: ["AllCalidad", "https://allcalidad.re"] };

async function rJson(k, path) {
  const [name, base] = REST[k];
  const r = await kino.fetch(base + "/api/rest" + path, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: base + "/" } });
  const t = await r.text();
  if (!r.ok) { log(name + " " + path.slice(0, 40) + " status=" + r.status); throw fail("unavailable", "status " + r.status, name + " respondió con el error " + r.status + ".", name + " answered with error " + r.status + "."); }
  try { return JSON.parse(t); } catch (e) { log(name + " json inválido " + path.slice(0, 40) + " inicio=" + t.slice(0, 100)); throw fail("unavailable", "respuesta no válida", name + " respondió algo inesperado.", name + " answered something unexpected."); }
}

function rImg(k, o) {
  const base = REST[k][1];
  const im = (o && o.images) || {};
  let p = String(im.poster || im.backdrop || o.poster || o.still_path || "");
  if (!p) return undefined;
  if (/^https?:\/\//i.test(p)) return p;
  if (p.charAt(0) !== "/") p = "/" + p;
  return p.indexOf("/wp-content/") === 0 ? base + p : base + "/wp-content/uploads" + p;
}

function rItem(k, o) {
  if (!o) return null;
  const id = String(o._id || o.id || "");
  if (!id) return null;
  const type = String(o.type || o.post_type || "movies");
  const m = type === "movies" ? "m" : "s";
  const title = String(o.title || o.name || "").replace(/\s*\(\d{4}\)\s*$/, "").trim();
  if (!title) return null;
  const kind = m === "m" ? "movie" : "series";
  return { id: k + "-" + id, ref: k + "|" + m + "|" + id, title: title.slice(0, 200), kind, genres: [m === "m" ? "peliculas" : "series"], poster: rImg(k, o) };
}

async function rSearch(k, q) {
  const d = await rJson(k, "/search?query=" + encodeURIComponent(q) + "&post_type=movies,tvshows,animes");
  return (((d && d.data && d.data.posts) || []).map((o) => rItem(k, o))).filter(Boolean);
}

// Catálogo del inicio: se prueban rutas conocidas de este motor y se anota cuál responde.
async function rHome(k) {
  const tries = ["/listing/movies?page=1&postsPerPage=20&orderBy=latest&order=desc", "/posts?post_type=movies&page=1&per_page=20", "/latest?post_type=movies&page=1"];
  for (const p of tries) {
    try {
      const d = await rJson(k, p);
      const posts = (d && d.data && (d.data.posts || d.data)) || [];
      const items = (Array.isArray(posts) ? posts : []).map((o) => rItem(k, o)).filter(Boolean);
      log(REST[k][0] + " inicio " + p.slice(0, 30) + " -> " + items.length);
      if (items.length) return items;
    } catch (e) { /* ya anotado */ }
  }
  return [];
}

async function rEpisodes(ref) {
  const p = String(ref).split("|");
  const k = p[0];
  const id = p[2];
  if (p[1] === "m") return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: k + "|m|" + id, title: tr("Película", "Movie") }] };
  const d = await rJson(k, "/episodes?post_id=" + encodeURIComponent(id));
  const out = [];
  for (const e of Array.isArray(d && d.data) ? d.data : []) {
    const eid = e && (e._id || e.id);
    if (!eid) continue;
    const season = parseInt(e.season_number, 10) || 1;
    const num = parseInt(e.episode_number, 10) || out.length + 1;
    out.push({ season, number: num, ref: k + "|e|" + eid, title: dec(String(e.title || "").replace(/<[^>]*>/g, " ")) || tr("Episodio ", "Episode ") + num, poster: rImg(k, e) });
  }
  log(REST[k][0] + " episodios: " + out.length);
  if (!out.length) throw fail("not_found", "sin capítulos", "No se encontró la lista de capítulos de este título.", "No episode list found for this title.");
  out.sort((x, y) => (x.season - y.season) || (x.number - y.number));
  return { series: { title: "" }, episodes: out };
}

async function rResolve(ref) {
  const p = String(ref).split("|");
  const k = p[0];
  const d = await rJson(k, "/player?post_id=" + encodeURIComponent(p[2]) + "&_any=1");
  const embeds = [];
  for (const e of (d && d.data && d.data.embeds) || []) {
    const u = absUrl(e && e.url);
    if (!u || SKIP_HOST.test(hostOf(u)) || USELESS.test(hostOf(u))) continue;
    const l = String(e.lang || "");
    embeds.push({ url: u, name: l, rank: langRank(l) });
  }
  embeds.sort((x, y) => x.rank - y.rank);
  return playEmbeds(embeds.slice(0, 10), REST[k][1] + "/");
}

const isRest = (ref) => /^[fa]\|/.test(String(ref || ""));

export async function resolve(ref) {
  await null;
  if (isRest(ref)) return rResolve(ref);
  const url = decodeURIComponent(String(ref || "").slice(2));
  if (!/^https:\/\//i.test(url)) throw fail("not_found", "referencia desconocida", "No se encontró este título.", "Title not found.");
  const site = siteOf(url);
  const base = site ? site[2] : "";
  const h = await cached("t:" + url, 300000, () => get(url));
  if (!h.ok) throw fail("unavailable", "status " + h.status, "El sitio respondió con el error " + h.status + ".", "The site answered with error " + h.status + ".");
  return playEmbeds(embedsOf(base, url, h.text), url);
}
