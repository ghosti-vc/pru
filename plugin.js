// DoramasFlix - doramas, películas y variedades de doramasflix.io y doramasflix.in en un solo plugin (motor de PelisMAX).
// Une el mismo título de varias fuentes, ordena los servidores con el Latino primero y saca el video de VOE,
// Fastream, StreamWish, Ok.ru y otros directamente (sin navegador) cuando se puede. No salta captchas.

const REF = "https://doramasflix.io/";
const HOME_ROW = 20;
// Orden de idiomas: Latino, Castellano, Coreano y después el resto. Pon SOLO_LATINO = true para mostrar únicamente Latino.
const SOLO_LATINO = false;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Cabeceras con las que el reproductor pide el video: muchos servidores responden 403 si falta el origen o el navegador.
function playHeaders(pageUrl) {
  const m = /^(https?:\/\/[^\/?#]+)/i.exec(String(pageUrl || ""));
  const h = { Referer: pageUrl, "User-Agent": UA };
  if (m) h.Origin = m[1];
  return h;
}
const PAGE_VIEW = 40;
const MAX_RESULTS = 100;


function log(...args) {
  try { kino.log(...args); } catch { /* el registro no debe romper nada */ }
}

// Textos que lee la persona: español por defecto, inglés si kino.lang es "en-US".
function tr(es, en) {
  return (typeof kino !== "undefined" && kino.lang === "en-US") ? en : es;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}


function attr(tag, name) {
  const a = new RegExp(name + "=([\"'])([^\"']*)\\1", "i").exec(tag);
  return a ? a[2] : "";
}

// ---- Episodios --------------------------------------------------------------------------------

// ---- DoramasYT: episodios y reproducción ------------------------------------------------------


function hostOf(u) {
  const m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || ""));
  return m ? m[1] : "";
}

// Forma de la ruta sin el código: /e/xxxx -> "/e/". Sirve para el registro sin filtrar enlaces.
function pathShape(u) {
  const m = /^https?:\/\/[^\/?#]+(\/[^?#]*)?/i.exec(String(u || ""));
  const p = m && m[1] ? m[1] : "";
  return p.replace(/[A-Za-z0-9_-]{8,}/g, "~").slice(0, 40);
}

function absUrl(u) {
  let x = String(u || "").trim();
  if (x.startsWith("//")) x = "https:" + x;
  return /^https:\/\//i.test(x) ? x : "";
}

// -- Lectura de reproductores embebidos ---------------------------------------------------------
// Muchos reproductores esconden el video: dentro de un script "empaquetado" (eval(function(p,a,c,k,e,d)...)
// o en un texto en base64 (atob). Aquí se desarman, sin ejecutar nada, para buscar el .m3u8 / .mp4.

const MEDIA_RE = /["'`]((?:https?:)?\/\/[^"'`\s<>\\]+?\.(?:m3u8|mp4)(?:\?[^"'`\s<>\\]*)?)["'`]/i;

// Videos de prueba que traen los reproductores y sus librerías (Big Buck Bunny y compañía).
// Nunca son el capítulo: se descartan para no mostrarlos por error.
const DEMO_MEDIA = /pinup_preroll|[_\/-]preroll[_.\/-]|agl00\d\.com|big[_-]?buck[_-]?bunny|\bbbb[_-]|sintel|elephants?[_-]?dream|tears[_-]?of[_-]?steel|gtv-videos-bucket|commondatastorage|test-?streams|bitdash|bitmovin|mux\.dev|zencdn|oceans\.mp4|flowplayer\.com|jwplatform|\/samples?\/|(?:googleapis|gstatic|jsdelivr|cdnjs|unpkg)\./i;
// Los enlaces de streamtape.com/e/... son la página del reproductor (no el video) y el sitio responde 403: se descartan.
const isDemo = (u) => DEMO_MEDIA.test(String(u || "")) || /streamtape\.[a-z]+\/e\//i.test(String(u || ""));

function normText(s) {
  return String(s || "").replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/&amp;/g, "&");
}

// Desarma un script empaquetado con el método clásico "p,a,c,k,e,d".
function unpackPacked(src) {
  const re = /\}\s*\(\s*(['"])((?:\\[\s\S]|(?!\1)[^\\])*)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\[\s\S]|(?!\5)[^\\])*)\5\s*\.split\(\s*['"]\|['"]\s*\)/;
  const m = re.exec(src);
  if (!m) return null;
  const payload = m[2].replace(/\\(['"\\])/g, "$1").replace(/\\n/g, "\n");
  const radix = Number(m[3]);
  let count = Number(m[4]);
  if (!(radix >= 2 && radix <= 62) || !(count > 0 && count < 100000)) return null;
  const dict = m[6].split("|");
  const enc = (c) => (c < radix ? "" : enc(Math.floor(c / radix))) + ((c = c % radix) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
  const map = {};
  while (count--) map[enc(count)] = dict[count] || enc(count);
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

function findMedia(text) {
  const re = new RegExp(MEDIA_RE.source, "gi");
  const t = normText(text);
  let m;
  while ((m = re.exec(t))) {
    const u = absUrl(m[1]);
    if (u && !isDemo(u)) return u;
    if (u) log("video de muestra descartado: " + hostOf(u) + pathShape(u));
  }
  return "";
}

// Igual, pero sin exigir comillas: el texto que sale de un base64 suele ser el enlace "pelado".
function findMediaLoose(text) {
  const re = /((?:https?:)?\/\/[^\s"'`<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'`<>\\]*)?)/gi;
  const t = normText(text);
  let m;
  while ((m = re.exec(t))) {
    const u = absUrl(m[1]);
    if (u && !isDemo(u)) return u;
    if (u) log("video de muestra descartado: " + hostOf(u) + pathShape(u));
  }
  return "";
}

// Busca el video escrito en la página, en sus scripts empaquetados o en sus textos base64.
function deepMedia(html) {
  let u = findMedia(html);
  if (u) return u;
  for (const t of unpackAll(html)) { u = findMedia(t); if (u) return u; }
  for (const t of base64Texts(html)) { u = findMediaLoose(t); if (u) return u; }
  return "";
}

const SKIP_HOST = /(google|gstatic|facebook|doubleclick|googletagmanager|cloudflare|jsdelivr|cdnjs|jquery|bootstrap|fontawesome|histats|yandex)/i;

// Enlaces a otras páginas de reproductor que esta página abre o inserta (iframes y textos de script).
function embedLinks(html, base) {
  const texts = [html].concat(unpackAll(html), base64Texts(html));
  const out = [];
  const add = (u) => {
    const a = absUrl(u);
    if (!a || a === base || out.indexOf(a) >= 0) return;
    if (SKIP_HOST.test(hostOf(a))) return;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)(\?|$)/i.test(a)) return;
    out.push(a);
  };
  const decoded = base64Texts(html);
  for (const raw of texts) {
    const t = normText(raw);
    const fr = /<iframe[^>]*src=["']([^"']+)["']/gi;
    let f;
    while ((f = fr.exec(t))) add(f[1]);
    const ur = /["'`]((?:https?:)?\/\/[^"'`\s<>\\]+)["'`]/g;
    let u;
    while ((u = ur.exec(t))) {
      if (/\/(?:e|embed|v|f|play|player|stream|d)\/[A-Za-z0-9_-]{6,}/i.test(u[1])) add(u[1]);
    }
  }
  // Lo que sale de un base64 suele ser el enlace "pelado", sin comillas.
  for (const raw of decoded) {
    const bare = /(?:https?:)?\/\/[^\s"'`<>\\]+/g;
    let b;
    while ((b = bare.exec(normText(raw)))) add(b[0]);
  }
  return out.slice(0, 4);
}

function redact(s) {
  return String(s || "")
    .replace(/https?:\/\/[^\s"'<>]+/g, (u) => hostOf(u) + pathShape(u))
    .replace(/[A-Za-z0-9+\/=_-]{16,}/g, "~")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

// Radiografía de una página de reproductor para el registro (sin códigos ni enlaces completos).
function diag(html, depth, found) {
  const title = /<title[^>]*>([^<]*)/i.exec(html);
  const scripts = [];
  const sre = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let s;
  while ((s = sre.exec(html))) scripts.push({ attrs: s[1], body: s[2] });
  const ext = scripts.map((x) => attr("<s " + x.attrs + ">", "src")).filter(Boolean).map((x) => hostOf(absUrl(x))).filter(Boolean);
  const inline = scripts.filter((x) => x.body.trim()).sort((a, b) => b.body.length - a.body.length);
  const links = embedLinks(html, "").map((u) => hostOf(u) + pathShape(u));
  log("embed[" + depth + "] bytes=" + html.length + " titulo=" + (title ? title[1].trim().slice(0, 40) : "-") +
    " video=" + (found ? "si" : "no") + " packed=" + unpackAll(html).length + " atob=" + base64Texts(html).length +
    " tagVideo=" + /<video[\s>]/i.test(html) + " iframes=" + (html.split("<iframe").length - 1) +
    " scriptsExt=" + ext.slice(0, 4).join(",") + " scriptsInline=" + inline.length + " enlaces=" + links.join(","));
  if (!found && inline.length) log("embed[" + depth + "] script mayor: " + redact(inline[0].body));
}

// Lee la página de un reproductor y busca el video; si no está, sigue los reproductores que esa
// página abre (hasta 2 niveles), porque el de TuDorama suele ser solo una envoltura.
const innerHosts = new Map(); // envoltura -> a qué reproductores apunta

// ok.ru guarda el video en un bloque de datos de su página ("hlsManifestUrl" o la lista de calidades).
function okruMedia(html) {
  const t = String(html || "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const clean = (u) => String(u).replace(/\\+u0026/gi, "&").replace(/\\+\//g, "/");
  for (const key of ["hlsManifestUrl", "ondemandHls", "hlsMasterPlaylistUrl"]) {
    const m = new RegExp('\\\\*"' + key + '\\\\*"\\s*:\\s*\\\\*"(https?:[^"]*?)\\\\*"').exec(t);
    if (m) return clean(m[1]);
  }
  const order = ["ultra", "quad", "full", "hd", "sd", "low", "lowest", "mobile"];
  let best = "", bestRank = 99;
  const re = /\\*"name\\*"\s*:\s*\\*"([a-z]+)\\*"\s*,\s*\\*"url\\*"\s*:\s*\\*"(https?:[^"]*?)\\*"/g;
  let m;
  while ((m = re.exec(t))) { const i = order.indexOf(m[1]); const rk = i < 0 ? 50 : i; if (rk < bestRank) { bestRank = rk; best = clean(m[2]); } }
  return best;
}

async function embedFromHtml(embedUrl, depth, referer) {
  const d = depth || 0;
  if (isHoster(embedUrl)) {
    try {
      const hm = await hosterMedia(embedUrl, referer);
      if (hm) { log("hoster directo: " + hostOf(embedUrl) + " -> " + hostOf(hm.url)); return hm; }
      log("hoster " + hostOf(embedUrl) + ": sin video directo, sigo con el método normal");
    } catch (e) { log("hoster " + hostOf(embedUrl) + " falló: " + String((e && e.message) || e).slice(0, 60)); }
  }
  const r = await kino.fetch(embedUrl, { headers: { Referer: referer || REF } });
  log("embed[" + d + "] " + hostOf(embedUrl) + pathShape(embedUrl) + " status=" + r.status);
  if (!r.ok) return null;
  let html = await r.text();
  let u = deepMedia(html);
  if (!u && /(^|\.)ok\.ru$/i.test(hostOf(embedUrl))) { u = okruMedia(html); if (u) log("ok.ru: video encontrado"); }
  if (d === 0) innerHosts.set(embedUrl, embedLinks(html, embedUrl).map(hostOf));
  // Una página diminuta, sin video ni enlaces, suele ser una pantalla de comprobación del servidor:
  // con la cookie que acaba de dejar, el segundo intento trae la página real. Un solo reintento.
  if (!u && d >= 1 && html.length < 3000 && !/byse/i.test(hostOf(embedUrl)) && !embedLinks(html, embedUrl).length) {
    log("embed[" + d + "] página diminuta (" + html.length + " bytes): reintento");
    if (typeof kino.sleep === "function") await kino.sleep(900);
    const r2 = await kino.fetch(embedUrl, { headers: { Referer: referer || REF } });
    if (r2.ok) {
      const h2 = await r2.text();
      if (h2.length > html.length) { html = h2; u = deepMedia(html); }
    }
  }
  diag(html, d, !!u);
  if (u) {
    log("embed[" + d + "] video elegido: " + hostOf(u) + pathShape(u));
    return { url: u, mime: /\.m3u8/i.test(u) ? "application/x-mpegurl" : "video/mp4", headers: playHeaders(embedUrl) };
  }
  if (d >= 2) return null;
  const links = embedLinks(html, embedUrl).filter((l) => !/byse/i.test(hostOf(l))).slice(0, d === 0 ? 3 : 2);
  for (const l of links) {
    try {
      const got = await embedFromHtml(l, d + 1, embedUrl);
      if (got) return got;
    } catch (e) {
      log("embed[" + (d + 1) + "] falló: " + String((e && e.message) || e).slice(0, 60));
    }
  }
  return null;
}

async function captureEmbed(embedUrl, ms, referer) {
  if (typeof kino === "undefined" || !kino.browser || typeof kino.browser.capture !== "function") return null;
  const page = await kino.browser.capture(embedUrl, { timeoutMs: ms, headers: { Referer: referer || REF } });
  const media = page && Array.isArray(page.media) ? page.media : [];
  const first = media.find((x) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url) && !isDemo(x.url));
  if (!first) return null;
  const out = { url: first.url, mime: first.mime || first.mimeType || (/\.m3u8(\?|$)/i.test(first.url) ? "application/x-mpegurl" : "video/mp4") };
  // Si el navegador no entrega cabeceras, el reproductor pedía el video sin Referer/Origin y el servidor respondía 403.
  const hd = playHeaders(embedUrl);
  if (first.headers && typeof first.headers === "object") Object.assign(hd, first.headers);
  out.headers = hd;
  return out;
}


// ---- Extractores directos por servidor (tomados de Kino Resolver) --------------------------------
// Para los servidores más comunes se saca el video leyendo la página (o la API del servidor), sin
// abrir el navegador. Si no logran nada, se sigue con el método de siempre.

const H_VOE = /voe\.sx|voe-unblock|voeunbl|voeun|edwardarriveoften|yodelswartlike|nathanfromsubject|reputationsheriff|fittingcentermondaysunday|tinycat-voe-fashion|scatch176duplicities|arianathankspecial|cloudwindow-route/i;
const H_WISH = /stream.?wish|strwish|embedwish|wishembed|awish|dwish|mwish|wishfast|sfastwish|flaswish|obeywish|cdnwish|asnwish|flastwish|jodwish|swhoi|swdyu|wishonly|playerwish|hlswish|iplayerhls|hlsflast|ghbrisk|cybervynx|streamhg|hlsflex|hglink|hgplaycdn|vibuxer|yuguaab/i;
const H_TAPE = /streamtape|strtape|strcloud|stape|tapewithadblock|streamadblock|watchadsontape|shavetape|strtpe/i;
const H_HIDE = /streamhide|playhide|guccihide|moviesm4u|louishide|ahvsh|movhide/i;
const H_LARE = /streamlare|slmaxed|slwatch|sltube|streamlure/i;
const H_VIMEOS = /\bvimeos\.(net|zip|to|sx|cc|xyz|lol|art|fun)\b/i;

const hx = (re, s, i) => { const m = re.exec(String(s || "")); return m ? m[i === undefined ? 1 : i] : ""; };
const rot13 = (s) => s.replace(/[a-zA-Z]/g, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode(b + ((c.charCodeAt(0) - b + 13) % 26)); });
const b64 = (s) => { try { return atob(String(s).replace(/[^A-Za-z0-9+\/=_-]/g, "").replace(/-/g, "+").replace(/_/g, "/")); } catch (e) { return ""; } };

function voeDecode(html) {
  try {
    const raw = hx(/<script type="application\/json">(\[".*?"\])<\/script>/s, html);
    if (!raw) return null;
    let s = rot13(JSON.parse(raw)[0]);
    for (const j of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) s = s.split(j).join("");
    const d1 = b64(s);
    let sh = "";
    for (let i = 0; i < d1.length; i++) sh += String.fromCharCode((d1.charCodeAt(i) - 3 + 256) % 256);
    return JSON.parse(b64(sh.split("").reverse().join("")));
  } catch (e) { return null; }
}

function packedOf(html) {
  const outs = [];
  let i = 0;
  while (outs.length < 4) {
    const k = html.indexOf("eval(function(p,a,c,k,e", i);
    if (k < 0) break;
    const u = unpackPacked(html.slice(k, k + 80000));
    if (u) outs.push(u);
    i = k + 20;
  }
  return outs;
}
const fileOfPacked = (html) => {
  for (const t of packedOf(html)) {
    const f = hx(/(?:file|"hls\d?")\s*:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/i, t) || hx(/(?:file|"hls\d?")\s*:\s*"(https?:[^"]+)"/i, t) || hx(/sources\s*:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/i, t) || hx(/src\s*:\s*"(https?:[^"]+)"/i, t);
    if (f) return f;
  }
  return "";
};
const fixU = (u) => String(u || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
const okU = (u) => /^https?:\/\//i.test(u || "") && !isDemo(u);

// Devuelve { url, mime, headers } o null.
async function hosterMedia(url, refer) {
  const h = hostOf(url);
  const RF = refer || REF;
  const page = async (u, hdr) => {
    const r = await kino.fetch(u, { headers: hdr || { Referer: RF } });
    if (!r.ok) { log("hoster " + hostOf(u) + " status=" + r.status); return ""; }
    return await r.text();
  };
  const out = (u, referer, extra) => {
    u = fixU(u);
    if (!okU(u)) return null;
    const hd = referer ? playHeaders(referer) : undefined;
    const o = { url: u, mime: /\.m3u8/i.test(u) ? "application/x-mpegurl" : "video/mp4" };
    if (hd || extra) o.headers = Object.assign({}, hd || {}, extra || {});
    return o;
  };
  let html, u;

  if (H_VOE.test(h)) {
    const id = hx(/voe\.sx\/(?:e\/)?([A-Za-z0-9]+)/i, url);
    const first = id ? "https://voe.sx/e/" + id : url;
    html = await page(first, { Referer: RF });
    if (/permanentToken|Redirecting/.test(html)) {
      const r = hx(/window\.location\.href\s*=\s*'(https?:\/\/[^']+)'/, html);
      if (r) html = await page(r, { Referer: "https://voe.sx/" });
    }
    if (/File not found|no longer available|Error 404/i.test(html)) return null;
    const d = voeDecode(html);
    if (d) { u = d.source || d.direct_access_url; if (u) return out(u, "https://voe.sx/"); }
    u = hx(/(?:mp4|hls)'\s*:\s*'([^']+)'/, html);
    if (u && u.startsWith("aHR0")) u = b64(u);
    if (!u) { try { const v = hx(/let\s+[0-9a-f]+\s*=\s*'(.*?)'/i, html); const j = JSON.parse(b64(v).split("").reverse().join("")); u = j.file; } catch (e) { /* nada */ } }
    return u ? out(u, "https://voe.sx/") : null;
  }

  if (H_VIMEOS.test(h)) {
    const ref = "https://" + h + "/";
    html = await page(url, { Referer: ref });
    if (/File not found|deleted|no longer available/i.test(html)) return null;
    for (const t of packedOf(html)) {
      u = hx(/file\s*:\s*["']([^"']+\.m3u8[^"']*)/i, t) || hx(/(https?:\/\/[^"']+\.m3u8[^"']*)/i, t) || hx(/file\s*:\s*["'](https?:[^"']+)["']/i, t);
      if (u) return out(u, ref);
    }
    return null;
  }

  if (H_TAPE.test(h)) {
    const tok = async (p) => {
      const t = await page(p, { Referer: p });
      if (/Video not found/i.test(t)) return null;
      return hx(/getElementById\('\w+link'\)\.innerHTML\s*=\s*"[^"]+"\s*.*?\('[^']*?\/([^']+)'\)/s, t);
    };
    const norm = url.replace("/v/", "/e/").replace(/\/e\/e\//, "/e/");
    let t = await tok(norm);
    if (!t) t = await tok(norm.replace("/e/", "/v/"));
    return t ? out("https://streamtape.com/" + t + "&stream=1", norm) : null;
  }

  if (H_LARE.test(h)) {
    const id = hx(/\/[ev]\/(\w+)/, url);
    if (!id) return null;
    const r = await kino.fetch("https://streamlare.com/api/video/stream/get", { method: "POST", body: { form: { id } } });
    let j = null;
    try { j = JSON.parse(await r.text()); } catch (e) { /* nada */ }
    u = j && j.result && j.result.file;
    return u ? out(u, url) : null;
  }

  if (/(^|\.)ok\.ru$|okru\.link|odnoklassniki/i.test(h)) {
    if (/okru\.link\/v2/.test(url)) {
      const v = hx(/t=([\w.]+)/, url);
      const r = await kino.fetch("https://apizz.okru.link/decoding", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: url }, body: { form: { video: v } } });
      const d = await r.text();
      u = hx(/"url":"(.*?)"/, d);
      return u ? out(u) : null;
    }
    if (/okru\.link/.test(url)) {
      const d = await page("https://okru.link/details.php?v=" + hx(/t=(\w+)/, url), { Referer: REF });
      u = hx(/"file":"(.*?)"/, d);
      return u ? out(u) : null;
    }
    html = await page(url, { Referer: "https://ok.ru/" });
    u = okruMedia(html);
    return u ? out(u, "https://ok.ru/") : null;
  }

  if (H_WISH.test(h) || H_HIDE.test(h) || /streamvid|vidstreamz|fastream|supervideo|vidmoly|mp4upload|uqload|vidoza|videzz|lulu(?:stream|vdo)/i.test(h)) {
    let ref = RF, extra;
    let p = url;
    if (/uqload/i.test(h)) { ref = "https://uqload.com/"; }
    if (/supervideo/i.test(h)) { ref = "https://supervideo.cc/"; if (!/\/e\//.test(p)) p = p.replace("supervideo.cc/", "supervideo.cc/e/"); }
    if (/mp4upload/i.test(h) && !/embed-/.test(p)) p = p.replace(/mp4upload\.com\//, "mp4upload.com/embed-") + (/\.html/.test(p) ? "" : ".html");
    const hdr = { Referer: ref };
    if (/uqload/i.test(h)) hdr.Origin = ref;
    if (/vidmoly/i.test(h)) {
      p = p.replace("/embed-", "/").replace(/\/[dwv]\//, "/");
      if (!/\.html/.test(p)) p += ".html";
      hdr.cookie = "cf_turnstile_demo_pass_" + p.replace(/^https?:\/\/[^\/]+\//, "").replace(".html", "") + "=1";
      hdr.Referer = RF;
    }
    html = await page(p, hdr);
    if (!html || /File (?:was )?(?:not found|deleted)|no longer available|Video not found|>Security Check</i.test(html)) return null;
    u = "";
    if (/vidoza|videzz|lulu(?:stream|vdo)/i.test(h)) {
      const s = hx(/sourcesCode\s*:\s*(\[\{.*?\}\])/s, html).replace(/(\w+):/g, '"$1":');
      try { const arr = JSON.parse(s); u = (arr[arr.length - 1] || {}).src || (arr[arr.length - 1] || {}).file; } catch (e) { /* nada */ }
    }
    if (!u) u = fileOfPacked(html);
    if (!u) u = hx(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/, html) || hx(/sources\s*:\s*\[\s*["'](https?:[^"']+)["']/, html);
    if (!u && /mp4upload/i.test(h)) u = hx(/"(https[^"]+\.mp4)"/, html) || hx(/"file":"([^"]+)/, html) || hx(/src:"([^"]+)/, html);
    if (!u) return null;
    if (/uqload|supervideo/i.test(h)) extra = { Origin: ref.replace(/\/$/, "") };
    return out(u, /mp4upload/i.test(h) ? p : ref === RF ? p : ref, extra);
  }
  return null;
}

const HOSTER_RE = new RegExp([H_VOE, H_WISH, H_TAPE, H_HIDE, H_LARE, H_VIMEOS].map((r) => r.source).join("|") + "|(?:^|\\.)ok\\.ru$|okru\\.link|streamvid|vidstreamz|fastream|supervideo|vidmoly|mp4upload|uqload|vidoza|videzz|lulu(?:stream|vdo)", "i");
const isHoster = (u) => HOSTER_RE.test(hostOf(u));

// Devuelve el primer resultado que llegue (no el último): { v, i } o null si ninguno entrega nada.
function firstSuccess(tasks) {
  return new Promise((resolveAll) => {
    let pending = tasks.length;
    if (!pending) { resolveAll(null); return; }
    tasks.forEach((t, i) => {
      Promise.resolve(t).then((v) => { if (v) resolveAll({ v, i }); }, () => {}).then(() => {
        pending--;
        if (pending === 0) resolveAll(null);
      });
    });
  });
}

// ---- Lectura de los sitios ----------------------------------------------------------------------

async function getText(url, headers) {
  let r;
  try {
    r = await kino.fetch(url, headers ? { headers } : undefined);
  } catch (e) {
    log("fetch falló " + hostOf(url) + ": " + String((e && e.message) || e).slice(0, 80));
    throw kino.error("unavailable", "fetch falló", {
      userMessage: tr("No se pudo abrir el sitio. Prueba de nuevo en un momento.", "Could not open the site. Try again in a moment."),
    });
  }
  if (!r.ok) {
    log("fetch " + hostOf(url) + pathShape(url) + " status=" + r.status);
    const um = { userMessage: tr("El sitio respondió con el error " + r.status + ".", "The site answered with error " + r.status + ".") };
    if (r.status === 404) throw kino.error("not_found", "el sitio respondió 404", um);
    if (r.status === 429) throw kino.error("rate_limited", "el sitio respondió 429", um);
    throw kino.error("unavailable", "el sitio respondió " + r.status, um);
  }
  return r.text();
}

async function getJson(url, referer) {
  const t = await getText(url, { Accept: "application/json, text/plain, */*", Referer: referer || REF });
  try { return JSON.parse(t); } catch (e) {
    log("json inválido " + hostOf(url) + pathShape(url) + " inicio=" + redact(t.slice(0, 120)));
    throw kino.error("unavailable", "respuesta no válida", { userMessage: tr("El sitio respondió algo inesperado.", "The site answered something unexpected.") });
  }
}

const enc = encodeURIComponent;
const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return String(s || ""); } };

function tmdbPoster(p) {
  if (!p) return undefined;
  p = String(p);
  if (p.charAt(0) === "/") return "https://image.tmdb.org/t/p/w342" + p;
  return /^https?:\/\//i.test(p) ? p : undefined;
}

function mkItem(src, kind, key, title, poster, year) {
  const t = stripTags(title);
  if (!t) return null;
  return {
    id: src + "-" + String(key).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80),
    ref: src + "|" + (kind === "movie" ? "m" : kind === "anime" ? "a" : "s") + "|" + key,
    title: t.slice(0, 200),
    kind: kind === "movie" ? "movie" : "series",
    genres: [kind === "movie" ? "peliculas" : "series"],
    poster: poster || undefined,
    year: /^\d{4}$/.test(String(year || "")) ? Number(year) : undefined,
  };
}

// ====================================================================================================
//  FUENTES: PelisGO (pg), Reypelis (ry), Pelis182 (pe), OnlyPelis (op)
// ====================================================================================================
const PG = "https://pelisgo.online";
const RY = "https://reypelis.net";
const PE = "https://pelis182.net";
const OP = "https://onlypelis.com";

const A = (base, u) => { u = decodeEntities(u); return u.startsWith("//") ? "https:" + u : u.charAt(0) === "/" ? base + u : u; };
const LANG_NAME = ["Latino", "Castellano", "Coreano", "Subtitulado"];
function langRank(s) {
  s = String(s || "").toLowerCase();
  if (/latino|lat\b/.test(s)) return 0;
  if (/castellano|espa[nñ]ol|cast\b|espa/.test(s)) return 1;
  if (/coreano|korean|\bkor\b|\bkr\b/.test(s)) return 2;
  return 3;
}
const jsonStr = (s) => { try { return JSON.parse('"' + s + '"'); } catch (e) { return String(s || ""); } };
const posterUrl = (p) => { p = String(p || ""); return p.startsWith("//") ? "https:" + p : /^https?:\/\//i.test(p) ? p : undefined; };

// Prueba varias direcciones y devuelve la primera lista con resultados.
async function firstCards(urls, parse, referer) {
  let lastErr = null;
  for (const u of urls) {
    try {
      const cards = parse(await getText(u, { Referer: referer || u }));
      if (cards.length) return cards;
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return [];
}

// ---- Reypelis --------------------------------------------------------------------------------------
function ryCards(h) {
  const out = [];
  const re = /<article class="post[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(h))) {
    const b = m[1];
    const href = /href="https?:\/\/reypelis\.net\/(pelicula|serie)\/([^\/"?#]+)\/?"/.exec(b);
    if (!href) continue;
    const title = stripTags((/<h2 class="entry-title">([\s\S]*?)<\/h2>/.exec(b) || [])[1]);
    const img = /<img[^>]+src="([^"]+)"/.exec(b);
    const yr = /class="year">\s*(\d{4})/.exec(b);
    const it = mkItem("ry", href[1] === "pelicula" ? "movie" : "series", enc(href[2]), title, img ? posterUrl(decodeEntities(img[1])) : undefined, yr && yr[1]);
    if (it) out.push(it);
  }
  return out;
}
async function ryPage(kind, n) {
  const base = kind === "movie" ? "/pelicula/" : "/serie/";
  const alt = kind === "movie" ? "/cartelera-peliculas/" : "/cartelera-series/";
  const urls = n === 1 ? [RY + base, RY + alt] : [RY + base + "page/" + n + "/", RY + alt + "page/" + n + "/", RY + alt + "?paged=" + n];
  const items = await firstCards(urls, ryCards, RY + "/");
  return { items, hasNext: items.length >= 12 };
}
async function rySearch(q) { return ryCards(await getText(RY + "/?s=" + enc(q), { Referer: RY + "/" })); }

function ryEpList(h, season) {
  const out = [];
  const re = /<li>\s*<article class="post[^"]*episodes[\s\S]*?<\/article>/g;
  let m;
  while ((m = re.exec(h))) {
    const b = m[0];
    const href = /href="https?:\/\/reypelis\.net\/capitulo\/([^\/"?#]+)\/?"/.exec(b);
    if (!href) continue;
    const ne = /num-epi">\s*(\d+)x(\d+)/.exec(b);
    const s = ne ? Number(ne[1]) : season;
    const n = ne ? Number(ne[2]) : out.length + 1;
    const img = /<img[^>]+src="([^"]+)"/.exec(b);
    out.push({ season: s, number: n, ref: "ry|e|" + enc(href[1]), title: stripTags((/<h2 class="entry-title">([\s\S]*?)<\/h2>/.exec(b) || [])[1]) || tr("Episodio ", "Episode ") + n, poster: img ? posterUrl(decodeEntities(img[1])) : undefined });
  }
  return out;
}
async function ryEpisodes(slug) {
  const url = RY + "/serie/" + slug + "/";
  const h = await getText(url, { Referer: RY + "/" });
  const title = stripTags((/<h1 class="entry-title">([\s\S]*?)<\/h1>/.exec(h) || [])[1]) || slug.replace(/-/g, " ");
  const postId = (/data-post="(\d+)"/.exec(h) || /postid-(\d+)/.exec(h) || [])[1];
  const seasons = [];
  h.replace(/data-season="(\d+)"/g, (_, s) => { if (seasons.indexOf(Number(s)) < 0) seasons.push(Number(s)); return ""; });
  if (!seasons.length) seasons.push(1);
  let eps = ryEpList(h, 1);
  const first = eps.length ? eps[0].season : 1;
  const others = seasons.filter((s) => s !== first).slice(0, 12);
  const got = await Promise.allSettled(others.map(async (s) => {
    let l = [];
    if (postId) {
      try {
        const r = await kino.fetch(RY + "/wp-admin/admin-ajax.php", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", Referer: url }, body: { form: { action: "action_select_season", season: String(s), post: String(postId) } } });
        if (r.ok) l = ryEpList(await r.text(), s);
      } catch (e) { log("ry: ajax temporada " + s + " falló"); }
    }
    if (!l.length) {
      try { l = ryEpList(await getText(RY + "/capitulo/" + slug + "-temporada-" + s + "-capitulo-1/", { Referer: url }), s); } catch (e) { /* sin esa temporada */ }
    }
    l.forEach((e) => { e.season = s; });
    return l;
  }));
  got.forEach((g) => { if (g.status === "fulfilled") eps = eps.concat(g.value); });
  log("ry episodios: " + eps.length + " (temporadas " + seasons.join(",") + ")");
  return { series: { title }, episodes: eps };
}
async function ryCandidates(spec) {
  const p = spec.split("|");
  const page = RY + (p[0] === "m" ? "/pelicula/" : "/capitulo/") + dec(p[1]) + "/";
  const h = await getText(page, { Referer: RY + "/" });
  const tabs = {};
  h.replace(/href="#options-(\d+)"[^>]*>([\s\S]*?)<\/a>/g, (_, i, t) => { tabs[i] = stripTags(t); return ""; });
  const cands = [];
  const re = /<div id="options-(\d+)"[\s\S]*?<iframe[^>]*?(?:data-src|src)="([^"]+)"/g;
  let m;
  while ((m = re.exec(h))) {
    const lang = langRank(tabs[m[1]]);
    cands.push({ url: A(RY, m[2]), lang, label: "Reypelis · " + LANG_NAME[lang], referer: page });
  }
  return cands;
}

// ---- Pelis182 --------------------------------------------------------------------------------------
const SEASON_TAIL = /\s*[-–—:]?\s*temporada\s*\d+\s*$/i;
function peCards(h) {
  const out = [];
  const re = /<article class="p182-card"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(h))) {
    const b = m[1];
    const href = /href="https?:\/\/pelis182\.net\/([^\/"?#]+)\/?"/.exec(b);
    if (!href) continue;
    const slug = href[1];
    const isSeason = /-temporada-\d+$/.test(slug);
    const t = stripTags((/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(b) || [])[1]).replace(SEASON_TAIL, "");
    const img = /<img[^>]+src="([^"]+)"/.exec(b);
    const yr = /<span>\s*(\d{4})\s*<\/span>/.exec(b);
    const it = mkItem("pe", isSeason ? "series" : "movie", enc(slug), t, img ? posterUrl(decodeEntities(img[1])) : undefined, yr && yr[1]);
    if (it) out.push(it);
  }
  return out;
}
async function pePage(kind, n) {
  let urls;
  if (kind === "anime") urls = [PE + "/category/anime/" + (n > 1 ? "page/" + n + "/" : "")];
  else if (kind === "series") urls = [PE + "/category/series/" + (n > 1 ? "page/" + n + "/" : "")];
  else urls = n === 1 ? [PE + "/catalogo/"] : [PE + "/catalogo/page/" + n + "/", PE + "/catalogo/?paged=" + n, PE + "/catalogo/?pagina=" + n];
  let items = await firstCards(urls, peCards, PE + "/");
  if (kind === "movie") items = items.filter((x) => x.kind === "movie");
  return { items, hasNext: items.length >= 8 };
}
async function peSearch(q) { return peCards(await getText(PE + "/?s=" + enc(q), { Referer: PE + "/" })); }

function peButtons(h) {
  const out = [];
  const re = /<button[^>]*class="server-button[^"]*"[^>]*data-iframe="([^"]*)"[^>]*>([^<]*)<\/button>/g;
  let m;
  while ((m = re.exec(h))) {
    const src = /src=["']([^"']+)/i.exec(decodeEntities(m[1]));
    if (src) out.push({ url: src[1], label: m[2].trim() });
  }
  return out;
}
async function peEpisodes(slug) {
  const base = slug.replace(/-temporada-\d+$/, "");
  const res = [];
  const one = async (s) => {
    const sl = base + "-temporada-" + s;
    const h = await getText(PE + "/" + sl + "/", { Referer: PE + "/" });
    const btns = peButtons(h);
    const title = stripTags((/<h1 class="watch-title">([\s\S]*?)<\/h1>/.exec(h) || [])[1]).replace(SEASON_TAIL, "");
    return { s, sl, btns, title };
  };
  let seasons = [];
  const r1 = await Promise.allSettled([1, 2, 3, 4, 5, 6].map(one));
  r1.forEach((r) => { if (r.status === "fulfilled" && r.value.btns.length) seasons.push(r.value); });
  if (seasons.length >= 6) {
    const r2 = await Promise.allSettled([7, 8, 9, 10, 11, 12].map(one));
    r2.forEach((r) => { if (r.status === "fulfilled" && r.value.btns.length) seasons.push(r.value); });
  }
  seasons.sort((a, b) => a.s - b.s);
  const eps = [];
  seasons.forEach((se) => se.btns.forEach((b, i) => {
    const mm = /x\s*(\d+)/i.exec(b.label);
    const n = mm ? Number(mm[1]) : i + 1;
    eps.push({ season: se.s, number: n, ref: "pe|e|" + enc(se.sl) + "|" + i, title: tr("Episodio ", "Episode ") + n });
  }));
  log("pe episodios: " + eps.length + " (" + seasons.length + " temporadas)");
  return { series: { title: (seasons[0] && seasons[0].title) || base.replace(/-/g, " ") }, episodes: eps };
}
async function peCandidates(spec) {
  const p = spec.split("|");
  const page = PE + "/" + dec(p[1]) + "/";
  const h = await getText(page, { Referer: PE + "/" });
  let url = "";
  if (p[0] === "e") { const b = peButtons(h)[Number(p[2]) || 0]; url = b ? b.url : ""; }
  else {
    const f = /<iframe[^>]+src=["']([^"']+)/i.exec(h);
    url = f ? f[1] : "";
  }
  if (!url) return [];
  return [{ url: A(PE, url), lang: 0, label: "Pelis182", referer: PE + "/", page }];
}

// ---- OnlyPelis -------------------------------------------------------------------------------------
function opCards(h) {
  const out = [];
  const re = /<article class="dpm-card[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(h))) {
    const b = m[1];
    const href = /href="https?:\/\/onlypelis\.com\/(pelicula|serie|series)\/([^\/"?#]+)\/?"/.exec(b);
    if (!href) continue;
    const t = stripTags((/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(b) || [])[1]).replace(/\s*\(\d{4}\)\s*$/, "");
    const img = /<img[^>]+src="([^"]+)"/.exec(b);
    const yr = /<span>\s*(\d{4})\s*<\/span>/.exec(b);
    const it = mkItem("op", href[1] === "pelicula" ? "movie" : "series", enc(href[2]), t, img ? posterUrl(decodeEntities(img[1])) : undefined, yr && yr[1]);
    if (it && it.kind === "movie") out.push(it);
  }
  return out;
}
async function opPage(n, path) {
  const base = path || "/pelicula/";
  const items = await firstCards([OP + base + (n > 1 ? "page/" + n + "/" : "")], opCards, OP + "/");
  return { items, hasNext: items.length >= 12 };
}
async function opSearch(q) { return opCards(await getText(OP + "/?s=" + enc(q), { Referer: OP + "/" })); }
async function opCandidates(spec) {
  const p = spec.split("|");
  const page = OP + "/pelicula/" + dec(p[1]) + "/";
  const h = await getText(page, { Referer: OP + "/" });
  const opts = [];
  const re = /<li[^>]*class=['"]dooplay_player_option['"][^>]*data-type=['"](\w+)['"][^>]*data-post=['"](\d+)['"][^>]*data-nume=['"](\w+)['"][^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(h))) opts.push({ type: m[1], post: m[2], nume: m[3], title: stripTags(m[4]) });
  const cands = [];
  for (const o of opts.slice(0, 6)) {
    let embed = "";
    try {
      const r = await kino.fetch(OP + "/wp-admin/admin-ajax.php", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", Referer: page }, body: { form: { action: "doo_player_ajax", post: o.post, nume: o.nume, type: o.type } } });
      const t = r.ok ? await r.text() : "";
      embed = embedOf(t);
      if (!embed) log("op: admin-ajax sin enlace (" + String(t).slice(0, 60).replace(/\s+/g, " ") + ")");
    } catch (e) { log("op: admin-ajax falló " + String((e && e.message) || e).slice(0, 50)); }
    if (!embed) {
      try { embed = embedOf(await getText(OP + "/wp-json/dooplayer/v2/" + o.post + "/" + o.type + "/" + o.nume, { Referer: page })); } catch (e) { /* sin REST */ }
    }
    if (embed) {
      const lang = langRank(o.title);
      cands.push({ url: embed, lang: /ver/i.test(o.title) && lang === 3 ? 0 : lang, label: "OnlyPelis" + (o.title ? " · " + o.title : ""), referer: page });
    }
  }
  return cands;
}
// La respuesta de DooPlay es JSON {embed_url, type}; embed_url puede ser un <iframe ...>.
function embedOf(t) {
  let u = "";
  try { const j = JSON.parse(t); u = String((j && (j.embed_url || j.url)) || ""); } catch (e) { u = String(t || ""); }
  const f = /<iframe[^>]+src=["']([^"']+)/i.exec(u);
  if (f) u = f[1];
  u = u.replace(/\\\//g, "/");
  return /^(https?:)?\/\//i.test(u) ? A(OP, u) : "";
}

// ---- PelisGO ---------------------------------------------------------------------------------------
// El sitio (Next.js) guarda sus datos en "self.__next_f.push([1,\"...\"])": se juntan y se desescapan.
function rscText(h) {
  let t = "";
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\[\s\S])*)"\]\)/g;
  let m;
  while ((m = re.exec(h))) t += jsonStr(m[1]);
  return t;
}
const PG_LANG = { cmm5jys20000d12uxchnk1lg7: 0, cmm5jys2d000e12ux0nymuwh4: 1 };
function pgCards(h) {
  const t = rscText(h);
  const out = [];
  const seen = new Set();
  const re = /\{"id":"([a-z0-9]+)","title":"((?:[^"\\]|\\.)*)","slug":"([^"]+)","poster":(?:"([^"]*)"|null),"year":(\d+|null)[^{}]*?"type":"(movie|serie)"/g;
  let m;
  while ((m = re.exec(t))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const isMovie = m[6] === "movie";
    const it = mkItem("pg", isMovie ? "movie" : "series", enc(m[3]) + (isMovie ? "|" + m[1] : ""), jsonStr(m[2]), m[4] || undefined, m[5] === "null" ? "" : m[5]);
    if (it) out.push(it);
  }
  return out;
}
async function pgPage(kind, n) {
  const items = pgCards(await getText(PG + (kind === "movie" ? "/movies" : "/series") + (n > 1 ? "?page=" + n : ""), { Referer: PG + "/" }));
  return { items, hasNext: items.length >= 20 };
}
async function pgSearch(q) {
  const want = normTitle(q);
  try {
    const r = await kino.fetch(PG + "/api/search?q=" + enc(q) + "&limit=24", { headers: pgHeaders(), timeoutMs: 7000 });
    if (r.ok) {
      const j = JSON.parse(await r.text());
      const res = j && Array.isArray(j.results) ? j.results : [];
      const apiOut = [];
      for (const x of res) {
        if (!x || !x.id || !x.slug) continue;
        const isMovie = !(x.type === "serie" || x.type === "series" || x.type === "tv");
        const it = mkItem("pg", isMovie ? "movie" : "series", enc(x.slug) + (isMovie ? "|" + x.id : ""), x.title, x.poster, x.year);
        if (it) apiOut.push(it);
      }
      log("pg: búsqueda por API -> " + apiOut.length);
      if (apiOut.length) return apiOut;
    }
  } catch (e) { log("pg: búsqueda por API falló " + String((e && e.message) || e).slice(0, 40)); }
  const urls = [PG + "/search?q=" + enc(q), PG + "/movies?search=" + enc(q), PG + "/movies?q=" + enc(q), PG + "/series?search=" + enc(q), PG + "/search?query=" + enc(q)];
  const res = await Promise.allSettled(urls.map(async (u) => pgCards(await getText(u, { Referer: PG + "/" }))));
  const out = [];
  const seen = new Set();
  res.forEach((r) => {
    if (r.status !== "fulfilled") return;
    for (const it of r.value) if (!seen.has(it.id) && normTitle(it.title).indexOf(want) >= 0) { seen.add(it.id); out.push(it); }
  });
  return out;
}
// Busca una lista JSON ("seasons":[...]) dentro del texto del sitio.
function jsonArrayAfter(t, key) {
  const i = t.indexOf(key);
  if (i < 0) return null;
  const s = t.indexOf("[", i);
  if (s < 0) return null;
  let depth = 0, inStr = false;
  for (let k = s; k < t.length; k++) {
    const c = t.charAt(k);
    if (inStr) { if (c === "\\") k++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { try { return JSON.parse(t.slice(s, k + 1)); } catch (e) { return null; } } }
  }
  return null;
}
async function pgEpisodes(slug) {
  const h = await getText(PG + "/series/" + slug + "/temporada/1/episodio/1", { Referer: PG + "/" });
  const t = rscText(h);
  const title = jsonStr((/"serieTitle":"((?:[^"\\]|\\.)*)"/.exec(t) || [])[1] || "") || slug.replace(/-/g, " ");
  const seasons = jsonArrayAfter(t, '"seasons":');
  const eps = [];
  if (seasons) {
    for (const s of seasons) for (const e of (s.episodes || [])) {
      eps.push({ season: Number(s.number) || 1, number: Number(e.number) || eps.length + 1, ref: "pg|e|" + enc(slug) + "|" + (Number(s.number) || 1) + "|" + (Number(e.number) || 1), title: stripTags(e.title) || tr("Episodio ", "Episode ") + e.number, poster: e.poster || undefined });
    }
  }
  if (!eps.length) {
    const re = new RegExp("/series/" + slug.replace(/[^\w-]/g, "") + "/temporada/(\\d+)/episodio/(\\d+)", "g");
    const seen = new Set();
    let m;
    while ((m = re.exec(h))) { const k = m[1] + "x" + m[2]; if (seen.has(k)) continue; seen.add(k); eps.push({ season: Number(m[1]), number: Number(m[2]), ref: "pg|e|" + enc(slug) + "|" + m[1] + "|" + m[2], title: tr("Episodio ", "Episode ") + m[2] }); }
  }
  log("pg episodios: " + eps.length);
  return { series: { title }, episodes: eps };
}
// Saca los enlaces {url, languageId, isBroken...} de los datos del sitio.
function pgLinks(t, ownId) {
  const out = [];
  const re = /\{"id":"[a-z0-9]+","name":[^{}]*?"url":"(https?:[^"]+)"[^{}]*?\}/g;
  let m;
  while ((m = re.exec(t))) {
    const o = m[0];
    if (/"isBroken":true/.test(o)) continue;
    const ep = /"episodeId":(?:null|"(\w+)")/.exec(o);
    if (ownId && ep && ep[1] && ep[1] !== ownId) continue;
    const lg = /"languageId":"(\w+)"/.exec(o);
    const lang = lg && PG_LANG[lg[1]] !== undefined ? PG_LANG[lg[1]] : 3;
    out.push({ url: jsonStr(m[1]), lang, label: "PelisGO · " + LANG_NAME[lang], referer: PG + "/" });
  }
  return out;
}
function walkLinks(o, out, lang) {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { o.forEach((x) => walkLinks(x, out, lang)); return; }
  let l = lang;
  const lg = o.languageId || (o.language && (typeof o.language === "string" ? o.language : o.language.id || o.language.name)) || o.lang;
  if (lg) l = PG_LANG[lg] !== undefined ? PG_LANG[lg] : langRank(lg);
  const u = o.url || o.embedUrl || o.embed_url || o.link;
  if (typeof u === "string" && /^https?:\/\//i.test(u) && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u) && !o.isBroken) out.push({ url: u, lang: l === undefined ? 0 : l, label: "PelisGO · " + LANG_NAME[l === undefined ? 0 : l], referer: PG + "/" });
  Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === "object") walkLinks(o[k], out, l); });
}
// Cabeceras de la app web de PelisGO (copiadas del plugin que sí reproduce).
function pgHeaders(referer) {
  return { Origin: PG, Accept: "*/*", "Accept-Language": "es-ES,es;q=0.9", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin", "X-Requested-With": "XMLHttpRequest", Referer: referer || PG + "/", "User-Agent": UA };
}
let pgTok = { token: null, exp: 0 };
async function pgToken() {
  const now = Date.now();
  if (pgTok.token && now < pgTok.exp) return pgTok.token;
  try {
    const r = await kino.fetch(PG + "/api/session/sync", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, pgHeaders()), timeoutMs: 8000 });
    const txt = await r.text();
    log("pg: session/sync status=" + r.status + " bytes=" + txt.length);
    if (!r.ok) return null;
    const j = JSON.parse(txt);
    const tok = j && (j.sid || j.sessionId || j.token);
    if (tok) { pgTok = { token: String(tok), exp: now + 9 * 60 * 1000 }; return pgTok.token; }
  } catch (e) { log("pg: session/sync falló " + String((e && e.message) || e).slice(0, 50)); }
  return null;
}
// Lista de servidores de una película o capítulo: sesión anónima + cabecera x-session-id; un reintento si la sesión no vale.
async function pgStream(kind, id, referer) {
  const url = PG + (kind === "episode" ? "/api/series/episode/" + enc(id) + "/stream" : "/api/movies/" + enc(id) + "/stream");
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await pgToken();
    const h = pgHeaders(referer);
    if (token) h["x-session-id"] = token;
    const r = await kino.fetch(url, { headers: h, timeoutMs: 8000 });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { j = null; }
    log("pg: stream " + kind + " intento " + (attempt + 1) + " status=" + r.status + " bytes=" + txt.length + (r.ok ? "" : " cuerpo=" + redact(txt.slice(0, 80))));
    if (r.status === 401 || r.status === 403 || (j && typeof j.error === "string" && /sesi[oó]n/i.test(j.error))) { pgTok = { token: null, exp: 0 }; continue; }
    if (!r.ok || !j) return [];
    const out = [];
    walkLinks(j, out, undefined);
    return out;
  }
  return [];
}
async function pgCandidates(spec) {
  const p = spec.split("|");
  if (p[0] === "e") {
    const slug = dec(p[1]);
    const page = PG + "/series/" + slug + "/temporada/" + p[2] + "/episodio/" + p[3];
    const t = rscText(await getText(page, { Referer: PG + "/" }));
    const own = (/"episodeId":"(\w+)","episodeTitle"/.exec(t) || [])[1];
    let found = pgLinks(t, own);
    if (!found.length && own) {
      try { found = await pgStream("episode", own, page); } catch (e) { log("pg: stream de capítulo falló " + String((e && e.message) || e).slice(0, 50)); }
    }
    return found;
  }
  const slug = dec(p[1]);
  const id = p[2];
  const page = PG + "/movies/" + slug;
  let cands = [];
  try {
    cands = await pgStream("movie", id, page);
  } catch (e) { log("pg: api stream falló " + String((e && e.message) || e).slice(0, 50)); }
  if (!cands.length) {
    try { cands = pgLinks(rscText(await getText(page, { Referer: PG + "/" })), null); } catch (e) { /* sin página */ }
  }
  if (!cands.length) cands = [{ url: page, page, cap: true, lang: 0, label: "PelisGO (navegador)", referer: PG + "/" }];
  return cands;
}

// ====================================================================================================
//  CATÁLOGO, BÚSQUEDA, CAPÍTULOS
// ====================================================================================================

// Páginas por ruta (géneros, tendencias, colecciones). Cada fuente que falla simplemente no aporta títulos.
async function ryPath(path, n) {
  const items = await firstCards([RY + path + (n > 1 ? "page/" + n + "/" : "")], ryCards, RY + "/");
  return { items, hasNext: items.length >= 12 };
}
async function pePath(path, n) {
  const items = await firstCards([PE + path + (n > 1 ? "page/" + n + "/" : "")], peCards, PE + "/");
  return { items, hasNext: items.length >= 8 };
}
async function peTrend(n) {
  const urls = n === 1 ? [PE + "/catalogo/?orden=tendencias"] : [PE + "/catalogo/page/" + n + "/?orden=tendencias", PE + "/catalogo/?orden=tendencias&paged=" + n];
  const items = (await firstCards(urls, peCards, PE + "/")).filter((x) => x.kind === "movie");
  return { items, hasNext: items.length >= 8 };
}
async function pgGenre(slug, n) {
  const items = pgCards(await getText(PG + "/genre/" + slug + (n > 1 ? "?page=" + n : ""), { Referer: PG + "/" }));
  return { items, hasNext: items.length >= 20 };
}
function genreParts(slug) {
  return [(n) => opPage(n, "/genero/" + slug + "/"), (n) => ryPath("/category/" + slug + "/", n), (n) => pePath("/category/" + slug + "/", n), (n) => pgGenre(slug, n)];
}
const dfParts = (kind, extra) => [(n) => dfPage("fi", kind, n, extra), (n) => dfPage("fn", kind, n, extra)].concat(extra ? [] : kind === "s" ? [(n) => fbPage("s", n)] : kind === "m" ? [(n) => fbPage("m", n)] : []);
const SECTIONS = {
  doramas: { genre: "series", parts: dfParts("s") },
  peliculas: { genre: "peliculas", parts: dfParts("m") },
  variedades: { genre: "series", parts: dfParts("a") },
  comedia: { genre: "series", parts: dfParts("s", "/generos/comedia") },
  drama: { genre: "series", parts: dfParts("s", "/generos/drama") },
  romance: { genre: "series", parts: dfParts("s", "/generos/romance") },
};
const SRC_PRIO = { fi: 0, fn: 1, fb: 2 };

function normTitle(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(\d{4}\)/g, "").replace(/[^a-z0-9]+/g, "");
}

// Une el mismo título de fuentes distintas en una sola tarjeta (ref "mx|a||b||c").
function mergeDupes(items) {
  const byKey = new Map();
  const out = [];
  for (const it of items) {
    const k = normTitle(it.title) + (it.kind === "movie" ? "m" : "s");
    const prev = byKey.get(k);
    if (!k.replace(/[ms]$/, "")) { out.push(it); continue; }
    if (!prev) { byKey.set(k, it); out.push(it); continue; }
    const refs = prev.ref.startsWith("mx|") ? prev.ref.slice(3).split("||") : [prev.ref];
    if (refs.length < 8 && refs.indexOf(it.ref) < 0) refs.push(it.ref);
    refs.sort((a, b) => (SRC_PRIO[a.slice(0, 2)] || 0) - (SRC_PRIO[b.slice(0, 2)] || 0));
    prev.ref = refs.length > 1 ? "mx|" + refs.join("||") : refs[0];
    if (!prev.poster && it.poster) prev.poster = it.poster;
    if (!prev.year && it.year) prev.year = it.year;
  }
  // Cada tarjeta recuerda su título: al abrirla se buscan las demás fuentes por ese título.
  for (const it of out) {
    const refs = it.ref.startsWith("mx|") ? it.ref.slice(3).split("||") : [it.ref];
    it.ref = "mx|" + refs.join("||") + "||tt:" + enc(it.title) + ":" + (it.kind === "movie" ? "m" : "s");
  }
  return out;
}

async function sectionPage(sec, n) {
  const def = SECTIONS[sec];
  if (!def) throw kino.error("not_found", "catálogo desconocido");
  const res = await Promise.allSettled(def.parts.map((p) => withTimeout(p(n), 9000)));
  const lists = [];
  let hasNext = false;
  let ok = 0;
  res.forEach((r, i) => {
    if (r.status === "fulfilled") { ok++; lists.push(r.value.items); if (r.value.hasNext) hasNext = true; }
    else log("sección " + sec + " p" + n + ": falló la fuente " + i + " " + String((r.reason && r.reason.message) || r.reason).slice(0, 60));
  });
  if (!ok) throw (res[0].reason || kino.error("unavailable", "ninguna fuente respondió"));
  const mixed = [];
  const max = Math.max(...lists.map((l) => l.length), 0);
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
  return { items: mergeDupes(mixed), hasNext };
}

export async function home() {
  await null;
  const defs = [
    { id: "row-doramas", ref: "doramas", title: tr("Doramas", "Dramas") },
    { id: "row-peliculas", ref: "peliculas", title: tr("Películas", "Movies") },
    { id: "row-variedades", ref: "variedades", title: tr("Variedades", "Variety shows") },
    { id: "row-comedia", ref: "comedia", title: tr("Comedia", "Comedy") },
    { id: "row-drama", ref: "drama", title: tr("Drama", "Drama") },
    { id: "row-romance", ref: "romance", title: tr("Romance", "Romance") },
  ];
  const res = await Promise.allSettled(defs.map((d) => sectionPage(d.ref, 1)));
  const rows = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("home: falló " + defs[i].id); return; }
    const items = r.value.items.slice(0, HOME_ROW);
    if (items.length) rows.push({ id: defs[i].id, title: defs[i].title, genre: SECTIONS[defs[i].ref].genre, ref: defs[i].ref, items });
  });
  log("home filas=" + rows.length);
  if (!rows.length) throw kino.error("unavailable", "inicio sin resultados");
  return rows;
}

export async function browse(ref, cursor) {
  await null;
  const r = String(ref || "");
  if (!SECTIONS[r]) throw kino.error("not_found", "catálogo desconocido");
  const n = Math.max(1, parseInt(cursor, 10) || 1);
  const items = [];
  const seen = new Set();
  let p = n;
  let hasNext = true;
  let tries = 0;
  while (hasNext && items.length < PAGE_VIEW && tries < 3) {
    tries++;
    let page;
    try { page = await sectionPage(r, p); } catch (e) { if (p === n) throw e; break; }
    for (const x of page.items) if (!seen.has(x.id)) { seen.add(x.id); items.push(x); }
    hasNext = page.hasNext;
    p++;
  }
  const out = { items: items.slice(0, MAX_RESULTS) };
  if (hasNext && items.length) out.next = String(p);
  return out;
}

export async function categories() {
  await null;
  const defs = [
    { id: "doramas", title: tr("Doramas", "Dramas") },
    { id: "peliculas", title: tr("Películas", "Movies") },
    { id: "variedades", title: tr("Variedades", "Variety shows") },
    { id: "comedia", title: tr("Comedia", "Comedy") },
    { id: "drama", title: tr("Drama", "Drama") },
    { id: "romance", title: tr("Romance", "Romance") },
  ];
  const first = await Promise.allSettled(defs.map((d) => sectionPage(d.id, 1)));
  return defs.map((d, i) => {
    const r = first[i];
    const art = r.status === "fulfilled" && r.value.items[0] ? r.value.items[0].poster : undefined;
    return art ? { id: d.id, title: d.title, ref: d.id, art } : { id: d.id, title: d.title, ref: d.id };
  });
}

const deadUntil = {};
// ====================================================================================================
//  ALLCALIDAD (motor con API: /api/rest/search, /episodes y /player)
// ====================================================================================================
const AC = "https://allcalidad.re";
async function acJson(path) {
  const r = await kino.fetch(AC + "/api/rest" + path, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: AC + "/" }, timeoutMs: 8000 });
  const t = await r.text();
  if (!r.ok) { log("ac: " + path.slice(0, 40) + " status=" + r.status); throw kino.error("unavailable", "ac status " + r.status); }
  try { return JSON.parse(t); } catch (e) { log("ac: json inválido " + path.slice(0, 40) + " inicio=" + redact(t.slice(0, 80))); throw kino.error("unavailable", "ac respuesta no válida"); }
}
function acImg(o) {
  const im = (o && o.images) || {};
  let p = String(im.poster || im.backdrop || (o && (o.poster || o.still_path)) || "");
  if (!p) return undefined;
  if (/^https?:\/\//i.test(p)) return p;
  if (p.charAt(0) !== "/") p = "/" + p;
  return p.indexOf("/wp-content/") === 0 ? AC + p : AC + "/wp-content/uploads" + p;
}
function acItem(o) {
  const id = String((o && (o._id || o.id)) || "");
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const type = String(o.type || o.post_type || "movies");
  const title = String(o.title || o.name || "").replace(/\s*\(\d{4}\)\s*$/, "").trim();
  const yr = /\b(19|20)\d{2}\b/.exec(String(o.year || o.release_date || ""));
  return mkItem("ac", type === "movies" ? "movie" : "series", id, title, acImg(o), yr && yr[0]);
}
async function acSearch(q, postType) {
  const types = "&post_type=" + (postType || "movies%2Ctvshows%2Canimes");
  const run = async (w) => {
    const d = await acJson("/search?query=" + enc(w) + "&page=1" + types + "&posts_per_page=16");
    return (((d && d.data && d.data.posts) || []).map(acItem)).filter(Boolean);
  };
  let out = await run(q);
  const want = normTitle(q);
  const words = String(q).split(/\s+/).filter((w) => w.length > 3).sort((x, y) => y.length - x.length);
  // La búsqueda del sitio a veces falla con varias palabras: se reintenta con la palabra más larga.
  if (words.length && want.length > 4 && !out.some((it) => normTitle(it.title).indexOf(want) >= 0)) {
    try { const more = await run(words[0]); const seen = new Set(out.map((x) => x.id)); more.forEach((x) => { if (!seen.has(x.id)) out.push(x); }); } catch (e) { /* nada */ }
  }
  if (want.length > 4 && out.some((it) => normTitle(it.title).indexOf(want) >= 0)) out = out.filter((it) => normTitle(it.title).indexOf(want) >= 0);
  log("ac: búsqueda '" + String(q).slice(0, 30) + "' -> " + out.length + (out[0] ? " (" + String(out[0].title).slice(0, 30) + ")" : ""));
  return out;
}
// El sitio no publica un listado conocido: el catálogo se arma buscando por año (como en el plugin FanPelis).
const acCache = new Map();
async function acPage(postType, n) {
  if (n > 1) return { items: [], hasNext: false };
  const hit = acCache.get(postType);
  if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.p;
  const p = acPageGo(postType);
  acCache.set(postType, { t: Date.now(), p });
  p.catch(() => { acCache.delete(postType); });
  return p;
}
async function acPageGo(postType) {
  const res = await Promise.allSettled([2026, 2025, 2024].map((y) => acSearch(String(y), postType)));
  const seen = new Set();
  const items = [];
  res.forEach((r) => { if (r.status === "fulfilled") r.value.forEach((it) => { if (!seen.has(it.id)) { seen.add(it.id); items.push(it); } }); });
  if (!items.length) throw kino.error("unavailable", "ac sin catálogo");
  return { items, hasNext: false };
}
async function acEpisodes(id) {
  const d = await acJson("/episodes?post_id=" + enc(id));
  const out = [];
  for (const e of Array.isArray(d && d.data) ? d.data : []) {
    const eid = e && (e._id || e.id);
    if (!eid || !/^[A-Za-z0-9_-]+$/.test(String(eid))) continue;
    const season = parseInt(e.season_number, 10) || 1;
    const num = parseInt(e.episode_number, 10) || out.length + 1;
    out.push({ season, number: num, ref: "ac|e|" + eid, title: stripTags(String(e.title || "")) || tr("Episodio ", "Episode ") + num, poster: acImg(e) });
  }
  log("ac: episodios " + out.length);
  if (!out.length) throw kino.error("not_found", "ac sin capítulos");
  out.sort((x, y) => (x.season - y.season) || (x.number - y.number));
  return { series: { title: "" }, episodes: out };
}
async function acCandidates(spec) {
  const p = spec.split("|");
  const d = await acJson("/player?post_id=" + enc(p[1]) + "&_any=1");
  const cands = [];
  for (const e of (d && d.data && d.data.embeds) || []) {
    const u = A(AC, e && e.url);
    if (!u || !/^https:\/\//i.test(u)) continue;
    const lang = langRank(String(e.lang || ""));
    if (cands.some((x) => x.url === u)) continue;
    cands.push({ url: u, lang, label: "AllCalidad · " + hostOf(u) + " · " + LANG_NAME[lang], referer: AC + "/" });
  }
  log("ac: servidores " + cands.length + " " + cands.map((c) => hostOf(c.url)).join(","));
  return cands;
}

// ====================================================================================================
//  DORAMASFLIX (.io y .in): mismo motor, rutas distintas. Los enlaces salen en el HTML de cada capítulo.
// ====================================================================================================
const DF = {
  fi: { base: "https://doramasflix.io", s: "/doramas", a: "/variedades", m: "/peliculas", e: "/capitulos", name: "DoramasFlix.io" },
  fn: { base: "https://doramasflix.in", s: "/doramas-online", a: "/variedades-online", m: "/peliculas-online", e: "/episodios", name: "DoramasFlix.in" },
};
const DF_LIST = { s: "/doramas", a: "/variedades", m: "/peliculas" };
const dfFlat = (h) => String(h || "").replace(/\\"/g, '"');
async function dfGet(src, path) {
  const d = DF[src];
  const r = await kino.fetch(d.base + path, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "es-ES,es;q=0.9", Referer: d.base + "/" }, timeoutMs: 9000 });
  if (r.status === 404) throw kino.error("not_found", "df 404");
  if (!r.ok) { log("df: " + src + path.slice(0, 40) + " status=" + r.status); throw kino.error(r.status === 403 ? "geo_blocked" : "unavailable", "df status " + r.status); }
  return await r.text();
}
// Tarjetas: <a href="/doramas/slug">…<img src=poster alt=título>…<h3>título</h3></a>
function dfCards(src, html) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*?href="\/(doramas|peliculas|variedades)(?:-online)?\/([a-z0-9][a-z0-9._-]*)"[^>]*>([\s\S]{0,2200}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[2];
    if (seen.has(slug)) continue;
    const inner = m[3];
    const img = /<img\b[^>]*>/i.exec(inner);
    const h3 = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/i.exec(inner);
    let title = h3 ? stripTags(h3[1]) : "";
    if (!title && img) title = decodeEntities(((/alt="([^"]*)"/i.exec(img[0])) || [])[1] || "");
    if (!title) { const al = /aria-label="([^"]*)"/i.exec(m[0].slice(0, 400)); if (al) title = decodeEntities(al[1]).replace(/^Ver\s+/i, ""); }
    title = String(title || "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    let poster;
    if (img) {
      const s = (/\bsrc="([^"]*)"/i.exec(img[0]) || [])[1] || "";
      const u = /[?&]url=([^&"]+)/.exec(s);
      poster = posterUrl(u ? dec(u[1]) : decodeEntities(s));
    }
    seen.add(slug);
    const kind = m[1] === "peliculas" ? "movie" : m[1] === "variedades" ? "anime" : "series";
    out.push(mkItem(src, kind, slug, title, poster, null));
  }
  return out.filter(Boolean);
}
const dfFirst = {};
async function dfPage(src, kind, n, extra) {
  const list = extra || DF_LIST[kind];
  const key = src + list;
  const html = await dfGet(src, list + (n > 1 ? "?page=" + n : ""));
  const items = dfCards(src, html);
  if (!items.length) throw kino.error("unavailable", "df sin tarjetas");
  const sig = items.map((x) => x.id).join(",");
  if (n === 1) dfFirst[key] = sig;
  else if (dfFirst[key] === sig) { log("df: la página " + n + " repite la primera, se detiene"); return { items: [], hasNext: false }; }
  log("df: " + src + " " + list + " p" + n + " -> " + items.length);
  return { items, hasNext: items.length >= 12 && n < 10 };
}
async function dfSearch(src, q) {
  const tries = ["/buscar?q=", "/buscar?query=", "/buscar?s=", "/search?q="];
  for (const t of tries) {
    try {
      const html = await dfGet(src, t + enc(q));
      const items = dfCards(src, html);
      if (items.length) { log("df: búsqueda " + src + " " + t + " -> " + items.length); return items; }
    } catch (e) { /* siguiente ruta */ }
  }
  log("df: búsqueda " + src + " sin resultados (rutas probadas: " + tries.join(" ") + ")");
  return [];
}
function dfSlugKind(kind) { return kind === "m" ? "m" : kind === "a" ? "a" : "s"; }
async function dfEpisodes(src, slug, kindLetter) {
  const d = DF[src];
  const html = await dfGet(src, d[dfSlugKind(kindLetter)] + "/" + slug);
  const s = dfFlat(html);
  const eps = new Map();
  const add = (season, num, title, poster) => {
    const k = season + "x" + num;
    if (!eps.has(k)) eps.set(k, { season, number: num, ref: src + "|e|" + slug + "-" + k, title: title || tr("Episodio ", "Episode ") + num, poster });
  };
  // 1) los que ya vienen con título
  const re1 = /"slug":"([a-z0-9._-]+)-(\d+)x(\d+)","episode_number":\d+,"season_number":\d+,"title":"([^"]*)"(?:,"stillUrl":"([^"]*)")?/g;
  let m;
  while ((m = re1.exec(s))) if (m[1] === slug) add(+m[2], +m[3], stripTags(jsonStr(m[4])), posterUrl(m[5]));
  // 2) enlaces visibles
  const re2 = /href="\/(?:capitulos|episodios)\/([a-z0-9._-]+)-(\d+)x(\d+)"/g;
  while ((m = re2.exec(s))) if (m[1] === slug) add(+m[2], +m[3]);
  // 3) todos los capítulos de cada temporada: la dirección es <serie>-<temporada>x<capítulo>
  const re3 = /"season_number":(\d+),"number_of_episodes":(\d+)/g;
  while ((m = re3.exec(s))) { const sn = +m[1]; const cnt = Math.min(+m[2], 400); for (let i = 1; i <= cnt; i++) add(sn, i); }
  const out = [...eps.values()].sort((a, b) => (a.season - b.season) || (a.number - b.number));
  let title = (/<title>([^<]*)/i.exec(html) || [])[1] || "";
  title = decodeEntities(title).replace(/^Ver\s+/i, "").replace(/\s+(sub|dorama|serie|pel[ií]cula|⚜|💖|-|\|).*$/i, "").replace(/\s*\(\d{4}\)\s*$/, "").trim();
  log("df: episodios " + src + " " + slug + " = " + out.length);
  if (!out.length) throw kino.error("not_found", "df sin capítulos");
  return { series: { title: title.slice(0, 200) }, episodes: out };
}
// Sigue el enlace corto de un servidor hasta la página del reproductor (sin descifrar nada).
async function dfFollow(url, referer) {
  try {
    const r = await kino.fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*", Referer: referer }, timeoutMs: 6500 });
    const fin = String(r.url || "");
    if (fin && fin !== url && !/embedshortener/i.test(hostOf(fin))) return fin;
    const t = await r.text();
    const pick = (re) => { const x = re.exec(t); return x ? A(url, x[1]) : ""; };
    const found = pick(/<iframe[^>]+src=["']([^"']+)["']/i) || pick(/http-equiv=["']refresh["'][^>]*url=([^"'>\s]+)/i) || pick(/location(?:\.href|\.replace)?\s*(?:=|\()\s*["'](https?:[^"']+)["']/i);
    if (found && /^https?:\/\//i.test(found) && !/embedshortener/i.test(hostOf(found))) return found;
    log("df: el enlace corto no mostró destino status=" + r.status + " bytes=" + t.length + " inicio=" + redact(t.slice(0, 100).replace(/\s+/g, " ")));
  } catch (e) { log("df: seguir enlace falló " + String((e && e.message) || e).slice(0, 50)); }
  return url;
}
async function dfCandidates(src, spec) {
  const p = spec.split("|"); // e|<slug>-<t>x<n>  o  m|<slug>
  const d = DF[src];
  const isEp = p[0] === "e";
  const path = isEp ? d.e + "/" + p[1] : d.m + "/" + p[1];
  const html = await dfGet(src, path);
  const s = dfFlat(html);
  const servers = {};
  for (const m of s.matchAll(/"name":"([^"]+)","code_flix":"(\d+)"/g)) servers[m[2]] = m[1];
  const langs = {};
  const li = s.indexOf('"listLanguages":[');
  if (li >= 0) for (const m of s.slice(li, li + 8000).matchAll(/"name":"([^"]+)","name_pt"[\s\S]{0,400}?"code_flix":"(\d+)"/g)) langs[m[2]] = m[1];
  const raw = [];
  for (const m of s.matchAll(/"server":"(\d+)","lang":"(\d+)","link":"(https?:\/\/[^"]+)"/g)) raw.push({ server: m[1], lang: m[2], link: m[3] });
  log("df: " + src + " " + path.slice(0, 50) + " enlaces=" + raw.length + " servidores=" + [...new Set(raw.map((x) => servers[x.server] || x.server))].join(","));
  if (!raw.length) throw kino.error("not_found", "df sin enlaces", { userMessage: tr("Este capítulo aún no tiene servidores.", "No servers for this episode yet.") });
  const ref = d.base + "/";
  const lim = raw.slice(0, 10);
  const final = await Promise.all(lim.map((x) => withTimeout(dfFollow(x.link, ref), 7500).catch(() => x.link)));
  const cands = [];
  lim.forEach((x, i) => {
    const ln = langs[x.lang] || (x.lang === "38" ? "Latino" : x.lang === "13109" ? "Coreano" : "");
    const lang = langRank(ln);
    const url = final[i];
    if (cands.some((c) => c.url === url)) return;
    cands.push({ url, lang, label: "DoramasFlix · " + (servers[x.server] || hostOf(url)) + " · " + (ln || "Sub"), referer: ref });
  });
  log("df: destinos " + cands.map((c) => hostOf(c.url)).join(","));
  return cands;
}

// ====================================================================================================
//  DORAMASFLIX.BEER (WordPress): otra fuente.
// ====================================================================================================
const FB = "https://doramasflix.beer";
async function webGet(base, path) {
  const r = await kino.fetch(base + path, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "es-ES,es;q=0.9", Referer: base + "/" }, timeoutMs: 9000 });
  if (r.status === 404) throw kino.error("not_found", "404");
  if (!r.ok) { log("web: " + base.slice(8) + path.slice(0, 40) + " status=" + r.status); throw kino.error(r.status === 403 ? "geo_blocked" : "unavailable", "status " + r.status); }
  return await r.text();
}
// ---- doramasflix.beer: tarjetas <a href=".../series/slug/" class="v6-arch-card"><img><h3>título</h3></a>
function fbCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href="https:\/\/doramasflix\.beer\/(series|peliculas)\/([^"\/]+)\/"[^>]*>([\s\S]{0,1800}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[2];
    if (seen.has(slug)) continue;
    const h = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/i.exec(m[3]);
    const title = h ? stripTags(h[1]).replace(/\s*\((\d{4})\)\s*$/, "").trim() : "";
    if (!title) continue;
    const yr = h && /\((\d{4})\)\s*$/.exec(stripTags(h[1]));
    const img = /<img\b[^>]*\bsrc="([^"]*)"/i.exec(m[3]);
    seen.add(slug);
    out.push(mkItem("fb", m[1] === "peliculas" ? "movie" : "series", slug, title, img ? posterUrl(decodeEntities(img[1])) : undefined, yr && yr[1]));
  }
  return out.filter(Boolean);
}
async function fbPage(kind, n) {
  const list = kind === "m" ? "/peliculas/" : "/series/";
  const html = await webGet(FB, list + (n > 1 ? "page/" + n + "/" : ""));
  const items = fbCards(html);
  if (!items.length) throw kino.error("unavailable", "fb sin tarjetas");
  log("fb: " + list + " p" + n + " -> " + items.length);
  return { items, hasNext: /rel="next"|class="next page-numbers"/i.test(html) };
}
async function fbSearch(q) {
  const items = fbCards(await webGet(FB, "/?s=" + enc(q)));
  log("fb: búsqueda -> " + items.length);
  return items;
}
const DF_SKIP = /(^|\.)(doramasflix|youtube|youtu|google|googletagmanager|gstatic|facebook|twitter|instagram|gravatar|w|wp|schema|tmdb|themoviedb|cloudflare|cloudflareinsights|jquery|jsdelivr|cdnjs|unpkg|fonts|image\.tmdb)\./i;
// Servidores en una página: iframes, atributos data-* y listas desplegables con direcciones https.
function genericEmbeds(html, ownHost) {
  const urls = [];
  const push = (u) => {
    u = decodeEntities(String(u || "")).trim();
    if (u.startsWith("//")) u = "https:" + u;
    if (!/^https:\/\/[^\/]+\/./.test(u)) return;
    const h = hostOf(u);
    if (!h || h === ownHost || DF_SKIP.test(h + ".") || /\.(css|js|png|jpe?g|webp|svg|gif|ico|woff2?)(\?|$)/i.test(u)) return;
    if (urls.indexOf(u) < 0) urls.push(u);
  };
  for (const m of html.matchAll(/<iframe[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/\bdata-(?:src|url|link|embed|video|player|iframe)=["'](https?:[^"']+|\/\/[^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/<option[^>]+value=["'](https?:[^"']+)["']/gi)) push(m[1]);
  return urls;
}
async function fbEpisodes(slug, kind) {
  if (kind === "m") return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: "fb|m|" + slug, title: tr("Película", "Movie") }] };
  const html = await webGet(FB, "/series/" + slug + "/");
  const eps = new Map();
  for (const m of html.matchAll(/href="https:\/\/doramasflix\.beer\/episodios\/([a-z0-9._-]+?)-(\d+)x(\d+)\/?"/gi)) {
    const k = (+m[2]) + "x" + (+m[3]);
    if (!eps.has(k)) eps.set(k, { season: +m[2], number: +m[3], ref: "fb|e|" + m[1] + "-" + m[2] + "x" + m[3], title: tr("Episodio ", "Episode ") + (+m[3]) });
  }
  const out = [...eps.values()].sort((a, b) => (a.season - b.season) || (a.number - b.number));
  const t = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  log("fb: episodios " + slug + " = " + out.length);
  if (!out.length) throw kino.error("not_found", "fb sin capítulos");
  return { series: { title: t ? stripTags(t[1]).replace(/\s*\(\d{4}\)\s*$/, "").slice(0, 200) : "" }, episodes: out };
}
async function fbCandidates(spec) {
  const p = spec.split("|");
  const path = (p[0] === "e" ? "/episodios/" : "/peliculas/") + p[1] + "/";
  const html = await webGet(FB, path);
  const urls = genericEmbeds(html, "doramasflix.beer");
  log("fb: " + path.slice(0, 50) + " servidores=" + urls.length + " " + urls.map(hostOf).join(","));
  if (!urls.length) {
    const head = html.slice(html.indexOf("<body"), html.indexOf("<body") + 5).length;
    log("fb: sin servidores visibles; bytes=" + html.length + " player=" + /player|playeroptions|dooplay/i.test(html) + " ajax=" + /admin-ajax|wp-json/i.test(html));
    throw kino.error("not_found", "fb sin servidores", { userMessage: tr("No se encontraron servidores en este capítulo.", "No servers found for this episode.") });
  }
  return urls.slice(0, 10).map((u) => ({ url: u, lang: 3, label: "DoramasFlix.beer · " + hostOf(u), referer: FB + "/" }));
}
async function searchAll(qa, ms) {
  const jobs = [["fi", (q) => dfSearch("fi", q)], ["fn", (q) => dfSearch("fn", q)], ["fb", fbSearch]].filter(([n]) => !(deadUntil[n] > Date.now()));
  const res = await Promise.allSettled(jobs.map(([, f]) => withTimeout(f(qa), Math.min(ms || 9000, 7000))));
  const all = [];
  res.forEach((r, i) => {
    if (r.status === "fulfilled") all.push.apply(all, r.value);
    else { deadUntil[jobs[i][0]] = Date.now() + 5 * 60 * 1000; log("búsqueda: falló " + jobs[i][0] + " (se salta 5 min) " + String((r.reason && r.reason.message) || r.reason).slice(0, 50)); }
  });
  return all;
}

export async function search(query) {
  await null;
  const q = stripTags(query && query.q).slice(0, 100);
  if (!q) return [];
  const qa = q.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¡!¿?:,.]/g, " ").replace(/\s+/g, " ").trim() || q;
  const out = mergeDupes(await searchAll(qa, 12000)).slice(0, MAX_RESULTS);
  log("búsqueda: " + out.length + " resultados");
  return out;
}

async function episodesOne(raw) {
  const p = raw.split("|");
  const src = p[0];
  const kind = p[1]; // m | s | e
  if (kind === "m") return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: raw, title: tr("Película", "Movie") }] };
  if (src === "fi" || src === "fn") return dfEpisodes(src, p[2], kind);
  if (src === "fb") return fbEpisodes(p[2], kind);
  throw kino.error("not_found", "referencia desconocida");
}

function splitRefs(raw) {
  const parts = (raw.startsWith("mx|") ? raw.slice(3) : raw).split("||").filter(Boolean);
  const refs = parts.filter((x) => x.indexOf("tt:") !== 0);
  const tt = parts.find((x) => x.indexOf("tt:") === 0);
  if (!tt) return { refs, tt: null, kind: refs[0] && refs[0].split("|")[1] === "m" ? "m" : "s" };
  return { refs, tt, kind: tt.split(":")[2] === "m" ? "m" : "s" };
}

// Busca el mismo título en las fuentes que aún no están; devuelve solo las referencias nuevas.
async function findMoreRefs(tt, refs, kind, ms) {
  const out = [];
  const have = new Set(refs.map((r) => r.slice(0, 2)));
  try {
    const title = dec(tt.split(":")[1] || "");
    const qa = title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¡!¿?:,.]/g, " ").replace(/\s+/g, " ").trim();
    const want = normTitle(title);
    if (qa && want) {
      const found = await searchAll(qa, ms);
      for (const it of found) {
        const src = it.ref.slice(0, 2);
        if (have.has(src) || (it.kind === "movie") !== (kind === "m")) continue;
        if (normTitle(it.title) !== want && loose(it.title) !== loose(title)) { log("otras fuentes: " + src + " no coincide '" + String(it.title).slice(0, 40) + "' con '" + title.slice(0, 40) + "'"); continue; }
        have.add(src);
        out.push(it.ref);
      }
    }
  } catch (e) { log("buscar en otras fuentes falló: " + String((e && e.message) || e).slice(0, 60)); }
  return out;
}

const loose = (t) => normTitle(String(t || "").replace(/\([^)]*\)|\[[^\]]*\]/g, " "));
const epCache = new Map();

export async function episodes(ref) {
  await null;
  const raw = String(ref || "");
  const hit = epCache.get(raw);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) { log("episodios: lista en caché"); return hit.value; }
  const { refs: known, tt, kind } = splitRefs(raw);
  if (!known.length && !tt) throw kino.error("not_found", "referencia desconocida");

  // Película: un solo capítulo que recuerda todas las fuentes.
  if (kind === "m" || (known.length && known.every((r) => r.split("|")[1] === "m"))) {
    const more = tt ? await findMoreRefs(tt, known, "m", 3500) : [];
    const all = known.concat(more).sort((a, b) => (SRC_PRIO[a.slice(0, 2)] || 0) - (SRC_PRIO[b.slice(0, 2)] || 0)).slice(0, 8);
    if (!all.length) throw kino.error("not_found", "referencia desconocida");
    return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: "mx|" + all.join("||") + (tt ? "||" + tt : ""), title: tr("Película", "Movie") }] };
  }

  // Serie: las fuentes conocidas cargan YA mientras se buscan las demás.
  const jobs = [];
  const launch = (r) => {
    const j = { ref: r, done: false, value: null };
    j.p = withTimeout(episodesOne(r), 14000).then((v) => { j.value = v; }, (e) => { log("episodios: falló " + r.slice(0, 2) + " " + String((e && e.message) || e).slice(0, 40)); }).then(() => { j.done = true; });
    jobs.push(j);
  };
  known.forEach(launch);
  let searching = !!tt;
  if (tt) findMoreRefs(tt, known, "s", 3500).then((more) => { more.forEach(launch); }).catch(() => {}).then(() => { searching = false; });
  const okJob = (j) => j.done && j.value && j.value.episodes && j.value.episodes.length;
  const t0 = Date.now();
  let firstAt = 0;
  while (Date.now() - t0 < 19000) {
    const pend = jobs.some((j) => !j.done) || searching;
    if (!pend) break;
    if (!firstAt && jobs.some(okJob)) firstAt = Date.now();
    if (firstAt && Date.now() - firstAt > (searching ? 9000 : 2500)) break;
    await kino.sleep(150);
  }
  const ok = jobs.filter(okJob);
  let best = null;
  let bestI = -1;
  ok.forEach((j, i) => {
    log("episodios: " + j.ref.slice(0, 2) + "=" + j.value.episodes.length);
    if (!best || j.value.episodes.length > best.episodes.length) { best = j.value; bestI = i; }
  });
  if (!best) throw kino.error("not_found", "sin capítulos", { userMessage: tr("No se encontró la lista de capítulos de este título.", "No episode list found for this title.") });
  const byKey = ok.map((j) => {
    const m = new Map();
    for (const e of j.value.episodes) m.set(e.season + "x" + e.number, e.ref);
    return m;
  });
  const eps = best.episodes.map((e) => {
    const alts = [e.ref];
    byKey.forEach((m, i) => { if (i !== bestI) { const o = m.get(e.season + "x" + e.number); if (o && alts.indexOf(o) < 0) alts.push(o); } });
    alts.sort((x, y) => (SRC_PRIO[x.slice(0, 2)] || 0) - (SRC_PRIO[y.slice(0, 2)] || 0));
    return alts.length > 1 ? Object.assign({}, e, { ref: "mx|" + alts.slice(0, 8).join("||") }) : e;
  });
  eps.sort((x, y) => (x.season - y.season) || (x.number - y.number));
  const value = Object.assign({}, best, { episodes: eps });
  epCache.set(raw, { t: Date.now(), value });
  log("episodios: lista en " + (Date.now() - t0) + " ms (" + ok.length + " fuentes)");
  return value;
}

// ---- Reproducción -------------------------------------------------------------------------------
const HOST_RANK = [/goodstream/i, /vimeos|unlimplay/i, /fastream|ok\.ru/i, /mp4upload/i, /streamwish|hgcloud|vidhide|dhcplay|hlswish|iplayerhls/i, /lulu/i, /voe|uqload|streamtape|streamlare|vidoza|supervideo|vidmoly/i, /paulinito|keki|tnmr/i, /filemoon|byse|mixdrop|mdy|netu|waaw|mega/i];
const rank = (u) => { const h = hostOf(u); const i = HOST_RANK.findIndex((r) => r.test(h)); return i < 0 ? 5 : i; };

async function candidatesOf(src, spec) {
  if (src === "fi" || src === "fn") return dfCandidates(src, spec);
  if (src === "fb") return fbCandidates(spec);
  throw kino.error("not_found", "referencia desconocida");
}

async function sleepUpTo(ms) {
  let left = ms;
  while (left > 0) { const t = Math.min(left, 4500); await kino.sleep(t); left -= t; }
  return null;
}
function withTimeout(p, ms) {
  if (typeof kino.sleep !== "function") return p;
  const stop = sleepUpTo(ms).then(() => { throw new Error("tardó demasiado"); });
  stop.catch(() => {});
  return Promise.race([Promise.resolve(p), stop]);
}

const isDirect = (c) => /\.(m3u8|mp4)(\?|$)/i.test(c.url) && !isDemo(c.url);
const asDirect = (c) => ({ url: c.url, mime: /\.m3u8/i.test(c.url) ? "application/x-mpegurl" : "video/mp4", label: c.label, headers: playHeaders(c.referer || REF) });

async function verifyMedia(m) {
  if (!/mpegurl/i.test(String(m && m.mime))) return true;
  try {
    const r = await withTimeout(kino.fetch(m.url, { headers: m.headers || {} }), 4500);
    if (!r.ok) return false;
    const t = await r.text();
    return /#EXTM3U/.test(String(t).slice(0, 400));
  } catch (e) { return false; }
}

async function directWorks(c) {
  const org = (/^(https?:\/\/[^\/?#]+)/i.exec(c.url) || [])[1] || "";
  const refs = [c.referer || REF, "https://lulustream.com/", "https://luluvdo.com/", org + "/"].filter((x, i, a) => x && a.indexOf(x) === i);
  const tries = refs.map((r) => {
    const m = { url: c.url, mime: /\.m3u8/i.test(c.url) ? "application/x-mpegurl" : "video/mp4", label: c.label, headers: playHeaders(r) };
    return verifyMedia(m).then((ok) => (ok ? { m, r } : null), () => null);
  });
  const res = await Promise.all(tries);
  const hit = res.find(Boolean);
  if (hit) log("resolve: directo abre con referer " + hostOf(hit.r));
  return hit ? hit.m : null;
}
export async function resolve(ref) {
  await null;
  const t0 = Date.now();
  const raw = String(ref || "");
  const refs = (raw.startsWith("mx|") ? raw.slice(3) : raw).split("||").filter((x) => x && x.indexOf("tt:") !== 0).slice(0, 8);
  if (!refs.length) throw kino.error("not_found", "referencia desconocida");
  const ttRef = (raw.startsWith("mx|") ? raw.slice(3) : raw).split("||").find((x) => x.indexOf("tt:") === 0) || null;
  const total = 20000;
  const left = () => total - (Date.now() - t0);

  // 1) servidores de todas las fuentes, a la vez
  const got = await Promise.allSettled(refs.map((r) => withTimeout(candidatesOf(r.slice(0, 2), r.slice(3)), 8000)));
  let cands = [];
  let lastErr = null;
  got.forEach((g, i) => {
    if (g.status === "fulfilled") cands = cands.concat(g.value);
    else { lastErr = g.reason; log("resolve: " + refs[i].slice(0, 2) + " sin servidores (" + String((g.reason && g.reason.message) || g.reason).slice(0, 40) + ")"); }
  });
  // Respaldo: si la fuente no dio servidores reales, se busca el mismo título en las demás fuentes.
  let didBackup = false;
  if (ttRef && (!cands.length || cands.every((c) => c.cap)) && left() > 9000) {
    didBackup = true;
    log("resolve: sin servidores reales, busco el título en otras fuentes");
    const more = await findMoreRefs(ttRef, refs, ttRef.split(":")[2] === "m" ? "m" : "s", 6000);
    log("resolve: otras fuentes encontradas=" + more.length);
    const extra = await Promise.allSettled(more.map((r) => withTimeout(candidatesOf(r.slice(0, 2), r.slice(3)), 6000)));
    extra.forEach((g) => { if (g.status === "fulfilled") cands = cands.concat(g.value); });
  }
  // Respaldo en paralelo: mientras se prueban estos servidores, se busca el mismo título en las demás fuentes.
  let backupP = null;
  if (ttRef && !didBackup && left() > 8000) {
    const kindB = ttRef.split(":")[2] === "m" ? "m" : "s";
    backupP = findMoreRefs(ttRef, refs, kindB, 5000)
      .then((more) => { log("resolve: respaldo, otras fuentes encontradas=" + more.length); return Promise.allSettled(more.map((r) => withTimeout(candidatesOf(r.slice(0, 2), r.slice(3)), 6000))); })
      .then((rs) => { const o = []; rs.forEach((g) => { if (g.status === "fulfilled") g.value.forEach((c) => o.push(c)); }); return o; })
      .catch(() => []);
  }
  cands = cands.filter((c, i) => cands.findIndex((x) => x.url === c.url) === i);
  if (SOLO_LATINO) {
    const lat = cands.filter((c) => (c.lang || 0) === 0);
    log("resolve: filtro Latino " + lat.length + " de " + cands.length);
    if (!lat.length) throw kino.error("not_found", "sin audio latino", { userMessage: tr("Este capítulo no tiene audio Latino.", "No Latino audio for this episode.") });
    cands = lat;
  }
  const useless = (c) => /dood|pinup|agl00\d\.com|playmogo|doodstream|mixdrop|susanexpect|nupload|netu|waaw|hqq/i.test(hostOf(c.url));
  const usable = cands.filter((c) => !useless(c));
  if (usable.length) cands = usable;
  cands.sort((a, b) => ((a.lang || 0) * 10 + rank(a.url)) - ((b.lang || 0) * 10 + rank(b.url)));
  log("resolve: " + cands.length + " servidores de " + refs.length + " fuentes: " + cands.slice(0, 8).map((c) => hostOf(c.url).replace(/^www\./, "")).join(","));

  // 2) enlaces directos del mejor idioma
  const minLang = cands.length ? Math.min(...cands.map((c) => c.lang || 0)) : 0;
  const bd = cands.find((c) => isDirect(c) && (c.lang || 0) === minLang);
  if (bd) {
    // Un enlace directo no vale si el servidor lo rechaza (403): se prueba con las cabeceras de su reproductor y, si no abre, se sigue con los demás.
    const ok = await directWorks(bd);
    if (ok) { log("resolve: ganó (directo) " + hostOf(bd.url) + " · " + (bd.label || "")); return ok; }
    log("resolve: el enlace directo de " + hostOf(bd.url) + " no abre, sigo con los demás servidores");
  }

  // 3) reproductores: de 4 en 4 sin soltar los anteriores; gana el primero que entregue video que abra.
  const embeds = cands.filter((c) => !isDirect(c) && !c.cap);
  const allEmbeds = embeds.slice();
  const capCands = cands.filter((c) => c.cap);
  const BAD = /dood|playmogo|mixdrop|susanexpect|waaw|hqq|netu|nupload/i;
  const browserOk = typeof kino.browser === "object" && kino.browser && typeof kino.browser.capture === "function";
  let winner = null;
  let fallback = null;
  let pending = 0;
  let captureStarted = false;
  const pendLang = new Map();
  const accept = async (v, c) => {
    v.label = c.label;
    const l = c.lang || 0;
    if (await verifyMedia(v)) { if (!winner || l < winner.l) { winner = { v, l }; log("resolve: ganó " + hostOf(c.url) + " · " + (c.label || "")); } }
    else { log("resolve: el video de " + hostOf(c.url) + " no abre, se descarta"); if (!fallback && !BAD.test(hostOf(c.url))) fallback = v; }
  };
  const start = (c) => {
    pending++;
    pendLang.set(c, c.lang || 0);
    embedFromHtml(c.url, 0, c.referer || REF).then((v) => (v ? accept(v, c) : null))
      .catch((e) => log("resolve: " + hostOf(c.url) + " falló " + String((e && e.message) || e).slice(0, 40)))
      .then(() => { pending--; pendLang.delete(c); });
  };
  const startCapture = () => {
    if (captureStarted || !browserOk || winner) return;
    const fe = capCands[0] || allEmbeds.find((c) => !BAD.test(hostOf(c.url))) || allEmbeds[0];
    if (!fe || left() < 5000) return;
    captureStarted = true;
    pending++;
    log("resolve: sin video aún, el navegador oculto arranca en paralelo (" + hostOf(fe.page || fe.url) + ")");
    captureEmbed(fe.page || fe.url, Math.min(14000, left() - 1500), fe.referer)
      .then((s) => (s ? accept(s, fe) : log("resolve: el navegador no vio video")))
      .catch((e) => log("resolve: captura falló " + String((e && e.message) || e).slice(0, 60)))
      .then(() => { pending--; });
  };
  const waitFor = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end && pending > 0) {
      if (winner && !Array.from(pendLang.values()).some((l) => l < winner.l)) return;
      await kino.sleep(200);
    }
  };
  let backupDone = !backupP;
  const mergeBackup = async (ms) => {
    if (backupDone || ms < 300) return;
    let extra;
    try { extra = await withTimeout(backupP, ms); } catch (e) { return; }
    backupDone = true;
    const fresh = (extra || []).filter((c) => !useless(c) && !cands.some((x) => x.url === c.url) && (!SOLO_LATINO || (c.lang || 0) === 0));
    fresh.sort((x, y) => ((x.lang || 0) * 10 + rank(x.url)) - ((y.lang || 0) * 10 + rank(y.url)));
    log("resolve: respaldo aporta " + fresh.length + " servidores");
    for (const c of fresh) {
      if (c.cap) continue;
      cands.push(c);
      if (!isDirect(c)) { embeds.push(c); allEmbeds.push(c); continue; }
      if (!winner && left() > 3000) {
        const ok = await directWorks(c);
        if (ok) { winner = { v: ok, l: c.lang || 0 }; log("resolve: ganó (respaldo directo) " + hostOf(c.url) + " · " + (c.label || "")); }
      }
    }
  };
  const rounds = async () => {
    while (embeds.length && left() > 4500 && !winner) {
      embeds.splice(0, 4).forEach(start);
      await waitFor(Math.min(3500, left() - 3500));
      if (!winner) await mergeBackup(Math.min(2500, left() - 3500));
      if (!winner && !embeds.length) startCapture();
    }
  };
  await rounds();
  if (!winner) { await mergeBackup(Math.min(4000, left() - 3000)); await rounds(); }
  if (!winner) startCapture();
  if (!winner && pending > 0 && left() > 1500) await waitFor(Math.max(1500, left() - 2500));
  if (winner) {
    if (Array.from(pendLang.values()).some((l) => l < winner.l)) await waitFor(1500);
    return winner.v;
  }
  const ld = cands.find(isDirect);
  if (ld) return asDirect(ld);
  if (fallback) return fallback;
  throw lastErr && lastErr.code ? lastErr : kino.error("unavailable", "ningún servidor entregó el video", {
    userMessage: tr("Ningún servidor de este título se pudo abrir desde aquí. Prueba otro título.", "No server for this title could be opened from here. Try another title."),
  });
}