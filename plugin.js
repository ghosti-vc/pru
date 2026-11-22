// TuDorama - doramas, películas y variedades de tudorama.com, con el Latino primero (motor de PelisMAX).
// Saca el video de VOE, Filemoon, StreamWish, Ok.ru y otros directamente (sin navegador) cuando se puede. No salta captchas.

const REF = "https://tudorama.com/";
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


// ====================================================================================================
//  TUDORAMA (tudorama.com): WordPress con el tema WStream. Listas en tarjetas "ipst", series en /serie/<slug>/,
//  películas en /pelicula/<slug>/, capítulos en /ver/<slug>-s<T>x<N>/. Los servidores se piden con
//  admin-ajax.php (acción corvus_get_servers) usando el id y el nonce que trae la propia página.
// ====================================================================================================
const TD = "https://tudorama.com";
const TD_AJAX = TD + "/wp-admin/admin-ajax.php";
const LANG_BY_CODE = { es: 0, lat: 0, en: 2, sub: 2 }; // "es" = Servidores Español Latino, "en" = Subtitulado (coreano con subtítulos)

async function tdGet(path) {
  return getText(path.startsWith("http") ? path : TD + path, { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "es-ES,es;q=0.9", Referer: TD + "/" });
}

async function tdPost(fields, referer) {
  let r;
  try {
    r = await kino.fetch(TD_AJAX, { method: "POST", headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest", Origin: TD, Referer: referer || TD + "/" }, body: { form: fields }, timeoutMs: 9000 });
  } catch (e) {
    throw kino.error("unavailable", "tudorama ajax falló", { userMessage: tr("No se pudo abrir el sitio. Prueba de nuevo en un momento.", "Could not open the site. Try again in a moment.") });
  }
  if (!r.ok) throw kino.error("unavailable", "tudorama ajax " + r.status);
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) {
    log("td: respuesta ajax no válida inicio=" + redact(String(t).slice(0, 100)));
    throw kino.error("unavailable", "respuesta no válida");
  }
}

// Tarjetas de lista: <article class="ipst"> ... /serie/<slug>/ o /pelicula/<slug>/
function tdCards(html, force) {
  const out = [];
  const seen = new Set();
  const re = /<article[^>]*class="[^"]*\bipst\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const b = m[1];
    const h = /href="https?:\/\/(?:www\.)?tudorama\.com\/(serie|pelicula)\/([^"\/?#]+)\/?"/i.exec(b);
    if (!h) continue;
    const kind = h[1].toLowerCase() === "pelicula" ? "movie" : "series";
    if (force && force !== kind) continue;
    if (seen.has(kind + h[2])) continue;
    seen.add(kind + h[2]);
    const title = stripTags((/ipst__title[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i.exec(b) || [])[1]) || attr((/<img\b[^>]*>/i.exec(b) || [""])[0], "alt");
    const img = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(b);
    const it = mkItem("td", kind, h[2], title, img && posterUrl(decodeEntities(img[1])), null);
    if (it) out.push(it);
  }
  return out;
}

const TD_SECTIONS = {
  latino: { path: "/genero/espanol-latino/", genre: "series", title: ["Español Latino", "Latino"] },
  emision: { path: "/genero/emision/", genre: "series", title: ["En emisión", "Airing now"] },
  kdramas: { path: "/genero/series/", genre: "series", title: ["K-Dramas", "K-Dramas"] },
  cdramas: { path: "/genero/cdrama/", genre: "series", title: ["C-Dramas", "C-Dramas"] },
  jdramas: { path: "/genero/jdrama/", genre: "series", title: ["J-Dramas", "J-Dramas"] },
  reality: { path: "/genero/reality-show/", genre: "series", title: ["Reality shows", "Reality shows"] },
  subespanol: { path: "/genero/sub-espanol/", genre: "series", title: ["Sub Español", "Spanish subs"] },
  peliculas: { path: "/genero/peliculas/", genre: "peliculas", title: ["Películas", "Movies"] },
};
const TD_ORDER = ["latino", "emision", "kdramas", "cdramas", "jdramas", "peliculas", "reality", "subespanol"];

async function tdSection(id, n) {
  const def = TD_SECTIONS[id];
  if (!def) throw kino.error("not_found", "catálogo desconocido");
  const html = await tdGet(def.path + (n > 1 ? "page/" + n + "/" : ""));
  const items = tdCards(html);
  if (!items.length) {
    if (n > 1) return { items: [], hasNext: false };
    throw kino.error("unavailable", "td sin tarjetas en " + id);
  }
  const hasNext = new RegExp("/page/" + (n + 1) + "/").test(html) || items.length >= 20;
  return { items, hasNext };
}

export async function home() {
  await null;
  const res = await Promise.allSettled(TD_ORDER.map((id) => withTimeout(tdSection(id, 1), 12000)));
  const rows = [];
  res.forEach((r, i) => {
    const id = TD_ORDER[i];
    if (r.status !== "fulfilled") { log("home: falló " + id + " " + String((r.reason && r.reason.message) || r.reason).slice(0, 60)); return; }
    const items = r.value.items.slice(0, HOME_ROW);
    if (items.length) rows.push({ id: "row-" + id, title: tr(TD_SECTIONS[id].title[0], TD_SECTIONS[id].title[1]), genre: TD_SECTIONS[id].genre, ref: id, items });
  });
  log("home filas=" + rows.length);
  if (!rows.length) throw kino.error("unavailable", "inicio sin resultados");
  return rows;
}

export async function categories() {
  await null;
  return TD_ORDER.map((id) => ({ id, title: tr(TD_SECTIONS[id].title[0], TD_SECTIONS[id].title[1]), ref: id }));
}

export async function browse(ref, cursor) {
  await null;
  const id = String(ref || "");
  if (!TD_SECTIONS[id]) throw kino.error("not_found", "catálogo desconocido");
  const n = Math.max(1, parseInt(cursor, 10) || 1);
  const items = [];
  const seen = new Set();
  let p = n;
  let hasNext = true;
  let tries = 0;
  while (hasNext && items.length < PAGE_VIEW && tries < 3) {
    tries++;
    let page;
    try { page = await tdSection(id, p); } catch (e) { if (p === n) throw e; break; }
    for (const x of page.items) if (!seen.has(x.id)) { seen.add(x.id); items.push(x); }
    hasNext = page.hasNext;
    p++;
  }
  const out = { items: items.slice(0, MAX_RESULTS) };
  if (hasNext && items.length) out.next = String(p);
  return out;
}

export async function search(query) {
  await null;
  const q = stripTags(query && query.q).slice(0, 100);
  if (!q) return [];
  const html = await tdGet("/?s=" + enc(q));
  const out = tdCards(html).slice(0, MAX_RESULTS);
  log("búsqueda: " + out.length + " resultados");
  return out;
}

// ---- Capítulos ----------------------------------------------------------------------------------
const epCache = new Map();

function tdEpPush(map, season, number, o) {
  const k = season + "x" + number;
  const cur = map.get(k);
  if (cur) { if (!cur.title && o.title) cur.title = o.title; if (!cur.poster && o.poster) cur.poster = o.poster; return; }
  map.set(k, { season, number, ref: "td|e|" + o.slug, title: o.title || "", poster: o.poster });
}

async function tdSeriesEpisodes(slug) {
  const html = await tdGet("/serie/" + slug + "/");
  const eps = new Map();
  // 1) los que ya vienen en la página (<li class="lep" data-episode data-season>)
  for (const m of html.matchAll(/<li\b[^>]*class="[^"]*\blep\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)) {
    const tag = m[0].slice(0, m[0].indexOf(">") + 1);
    const n = parseInt(attr(tag, "data-episode"), 10);
    const s = parseInt(attr(tag, "data-season"), 10);
    const link = /href="https?:\/\/[^"\/]+\/ver\/([^"\/?#]+)\/?"/i.exec(m[1]);
    if (!link || !n || !s) continue;
    const t = stripTags((/lep__title[^>]*>([\s\S]*?)<\//i.exec(m[1]) || [])[1]);
    const img = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(m[1]);
    tdEpPush(eps, s, n, { slug: link[1], title: t, poster: img && posterUrl(decodeEntities(img[1])) });
  }
  // 2) cualquier enlace /ver/<serie>-s<T>x<N>/
  for (const m of html.matchAll(/href="https?:\/\/[^"\/]+\/ver\/([a-z0-9._-]+?)-s(\d+)x(\d+)\/?"/gi)) tdEpPush(eps, +m[2], +m[3], { slug: m[1] + "-s" + m[2] + "x" + m[3] });
  // 3) las demás temporadas y páginas, con la misma llamada AJAX que usa la página (corvus_get_episodes)
  const box = (/<[^>]*class="[^"]*\beps\b(?![-_])[^"]*"[^>]*>/i.exec(html) || [""])[0];
  const nonce = attr(box, "data-nonce");
  const tmdb = attr(box, "data-tmdb-id");
  const results = attr(box, "data-results") || "20";
  const order = attr(box, "data-order") || "asc";
  const seasons = new Map();
  for (const m of html.matchAll(/<button\b[^>]*data-season="(\d+)"[^>]*>/gi)) seasons.set(+m[1], attr(m[0], "data-series-id") || tmdb);
  if (!seasons.size && attr(box, "data-season-number")) seasons.set(+attr(box, "data-season-number"), tmdb);
  if (nonce && seasons.size) {
    const fetchSeason = async ([sn, sid]) => {
      let offset = 0;
      for (let page = 0; page < 12; page++) {
        const j = await withTimeout(tdPost({ action: "corvus_get_episodes", nonce, post_id: sid || tmdb, season: String(sn), results, offset: String(offset), order }, TD + "/serie/" + slug + "/"), 8000);
        const list = j && j.success && j.data && Array.isArray(j.data.results) ? j.data.results : [];
        for (const e of list) {
          const link = /\/ver\/([^"\/?#]+)\/?/i.exec(String(e.permalink || ""));
          const s = +e.season_number || sn;
          const n = +e.episode_number;
          if (!link || !n) continue;
          tdEpPush(eps, s, n, { slug: link[1], title: stripTags(e.title), poster: posterUrl(e.episode_image) });
        }
        if (!(j && j.success && j.data && j.data.hasMore) || !list.length) break;
        offset += Number(results) || list.length;
      }
    };
    const rs = await Promise.allSettled([...seasons].slice(0, 20).map(fetchSeason));
    rs.forEach((r) => { if (r.status === "rejected") log("td: temporada falló " + String((r.reason && r.reason.message) || r.reason).slice(0, 60)); });
  }
  const out = [...eps.values()].sort((a, b) => (a.season - b.season) || (a.number - b.number)).map((e) => ({ season: e.season, number: e.number, ref: e.ref, title: e.title || tr("Episodio ", "Episode ") + e.number, poster: e.poster }));
  const title = stripTags((/<h1[^>]*class="[^"]*hero__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1]) || "";
  log("td: episodios " + slug + " = " + out.length + " (temporadas=" + seasons.size + ", ajax=" + (nonce ? "sí" : "no") + ")");
  if (!out.length) throw kino.error("not_found", "td sin capítulos", { userMessage: tr("Esta serie aún no tiene capítulos.", "This series has no episodes yet.") });
  return { series: { title: title.slice(0, 200) }, episodes: out };
}

export async function episodes(ref) {
  await null;
  const p = String(ref || "").split("|");
  if (p[0] !== "td") throw kino.error("not_found", "referencia desconocida");
  if (p[1] === "m") return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: String(ref), title: tr("Película", "Movie") }] };
  const hit = epCache.get(p[2]);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.value;
  const value = await withTimeout(tdSeriesEpisodes(p[2]), 18000);
  epCache.set(p[2], { t: Date.now(), value });
  return value;
}

// ---- Servidores de un capítulo o película --------------------------------------------------------
async function tdCandidates(spec) {
  const p = spec.split("|"); // e|<slug-del-capítulo>  o  m|<slug>
  const page = TD + (p[0] === "e" ? "/ver/" : "/pelicula/") + p[1] + "/";
  const html = await tdGet(page);
  const box = (/<[^>]*class="[^"]*\b(?:ep__dropdown|servers)\b[^"]*"[^>]*data-id=[^>]*>/i.exec(html) || /<[^>]*data-id="\d+"[^>]*data-nonce="[^"]+"[^>]*>/i.exec(html) || [""])[0];
  const id = attr(box, "data-id");
  const nonce = attr(box, "data-nonce");
  if (!id || !nonce) throw kino.error("not_found", "td sin id de servidores", { userMessage: tr("Este capítulo aún no tiene servidores.", "No servers for this episode yet.") });
  const j = await tdPost({ action: "corvus_get_servers", nonce, post_id: id }, page);
  const list = Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : []);
  const cands = [];
  for (const s of list) {
    const u = A(TD, String(s.link || s.url || "").trim());
    if (!/^https?:\/\//i.test(u)) continue;
    const code = String(s.lang || "").toLowerCase();
    const nm = String(s.name || "");
    let lang = LANG_BY_CODE[code] !== undefined ? LANG_BY_CODE[code] : langRank(nm);
    if (LANG_BY_CODE[code] === undefined && lang === 3 && /sub/i.test(nm)) lang = 2;
    const [server, extra] = nm.split(":");
    cands.push({ url: u, lang, label: "TuDorama · " + (server || hostOf(u)).trim() + (extra ? " · " + extra.trim() : "") + " · " + (lang === 0 ? "Latino" : lang === 1 ? "Castellano" : lang === 2 ? "Sub Español" : "Otro"), referer: page, type: String(s.type || "embed") });
  }
  log("td: " + p[0] + "/" + p[1].slice(0, 40) + " servidores=" + cands.length + " " + cands.map((c) => hostOf(c.url) + ":" + c.lang).join(","));
  if (!cands.length) throw kino.error("not_found", "td sin servidores", { userMessage: tr("Este capítulo aún no tiene servidores.", "No servers for this episode yet.") });
  return cands;
}

// ---- Reproducción -------------------------------------------------------------------------------
const HOST_RANK = [/goodstream/i, /vimeos|unlimplay/i, /fastream|ok\.ru/i, /mp4upload/i, /streamwish|hgcloud|vidhide|dhcplay|hlswish|iplayerhls/i, /lulu/i, /voe|uqload|streamtape|streamlare|vidoza|supervideo|vidmoly/i, /paulinito|keki|tnmr/i, /filemoon|byse|mixdrop|mdy|netu|waaw|mega/i];
const rank = (u) => { const h = hostOf(u); const i = HOST_RANK.findIndex((r) => r.test(h)); return i < 0 ? 5 : i; };

async function candidatesOf(src, spec) {
  if (src === "td") return tdCandidates(spec);
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
  const backupP = null;
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
