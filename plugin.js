// SoloLatino para Kino — películas, series, anime y doramas en español latino.
// Un solo archivo, sin import.

const BASE = "https://sololatino.co";
const ALT = "https://sololatino.net";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---------- idioma ----------
function es() {
  return !String(kino.lang || "es-CO").toLowerCase().startsWith("en");
}
function t(esText, enText) {
  return es() ? esText : enText;
}
function langHeader() {
  return es() ? "es-419,es;q=0.9,en;q=0.8" : "en-US,en;q=0.9,es;q=0.8";
}

// ---------- jar de cookies propio ----------
const jar = new Map();

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
}

function jarHeader(url) {
  const host = hostOf(url);
  if (!host) return "";
  const parts = [];
  for (const [h, m] of jar) {
    if (host === h || host.endsWith("." + h)) {
      for (const [k, v] of m) parts.push(k + "=" + v);
    }
  }
  return parts.join("; ");
}

function absorb(url, res) {
  const host = hostOf(url);
  if (!host) return;
  const h = res && res.headers;
  if (!h) return;
  const raw = h["set-cookie"] || h["Set-Cookie"];
  if (!raw) return;
  const list = Array.isArray(raw) ? raw : [raw];
  for (const line of list) {
    const first = String(line).split(";")[0];
    const i = first.indexOf("=");
    if (i < 1) continue;
    const name = first.slice(0, i).trim();
    const value = first.slice(i + 1).trim();
    if (!jar.has(host)) jar.set(host, new Map());
    jar.get(host).set(name, value);
  }
}

function cookieValue(url, name) {
  const host = hostOf(url);
  if (!host) return "";
  for (const [h, m] of jar) {
    if (host === h || host.endsWith("." + h)) {
      if (m.has(name)) return m.get(name);
    }
  }
  return "";
}

// ---------- red ----------
async function bodyOf(res) {
  try {
    if (typeof res.text === "function") return await res.text();
  } catch (e) {}
  if (typeof res.body === "string") return res.body;
  return "";
}

function statusOf(res) {
  if (!res) return 0;
  return res.status || res.statusCode || 0;
}

async function req(url, opts) {
  const o = opts || {};
  const headers = {
    "user-agent": UA,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": langHeader(),
    "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };
  if (o.headers) for (const k in o.headers) headers[k] = o.headers[k];
  const ck = jarHeader(url);
  if (ck) headers.cookie = ck;
  const init = { headers, method: o.method || "GET" };
  if (o.body != null) init.body = o.body;
  const res = await kino.fetch(url, init);
  absorb(url, res);
  const text = await bodyOf(res);
  return { status: statusOf(res), text, url };
}

function abs(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return "https:" + u;
  return BASE + (u.startsWith("/") ? u : "/" + u);
}

function altOf(u) {
  if (/sololatino\.co/i.test(u)) return u.replace(/sololatino\.co/i, "sololatino.net");
  if (/sololatino\.net/i.test(u)) return u.replace(/sololatino\.net/i, "sololatino.co");
  return u;
}

// ---------- lectura de páginas ----------
function hasBrowser() {
  return typeof kino.browser !== "undefined" && kino.browser && typeof kino.browser.page === "function";
}

const CHECK_RE = /just a moment|cf-chl|challenge-platform|cf-turnstile|g-recaptcha|h-captcha|checking your browser|verifying you are human|attention required/i;

function isCheck(html) {
  const h = String(html || "");
  return h.length < 60000 && CHECK_RE.test(h);
}

async function readPage(pathOrUrl, opts) {
  const o = opts || {};
  const first = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : abs(pathOrUrl);
  const urls = [first];
  const alt = altOf(first);
  if (alt !== first) urls.push(alt);
  const trail = [];
  let checked = false;
  // 1) petición normal (rápida) a cada dirección; 2) navegador solo si hace falta.
  for (const u of urls) {
    try {
      const r = await req(u);
      if (r.status === 404) { trail.push(hostOf(u) + ":404"); continue; }
      if (r.status < 400 && r.text && r.text.length > 500 && !isCheck(r.text)) {
        return { html: r.text, url: u, how: "fetch" };
      }
      if (isCheck(r.text) || r.status === 403 || r.status === 503) checked = true;
      trail.push(hostOf(u) + ":http " + r.status + (isCheck(r.text) ? " verificación" : ""));
    } catch (e) {
      trail.push(hostOf(u) + ":net " + ((e && e.code) || "error"));
    }
  }
  if (hasBrowser()) {
    for (const u of urls) {
      try {
        const pg = await kino.browser.page(u, { timeoutMs: o.timeoutMs || 12000 });
        if (pg && pg.html && pg.html.length > 500 && !isCheck(pg.html)) {
          return { html: pg.html, url: pg.finalUrl || u, how: "browser" };
        }
        trail.push(hostOf(u) + ":nav vacío");
      } catch (e) {
        const code = (e && e.code) || "error";
        if (/block|check/i.test(String((e && e.message) || "") + code)) checked = true;
        trail.push(hostOf(u) + ":nav " + code);
      }
    }
  }
  kino.log("sololatino: no se pudo abrir " + first.slice(0, 60) + " -> " + trail.join(" | "));
  throw kino.error("unavailable", trail.join(" | "), {
    userMessage: checked
      ? t("El sitio está pidiendo una verificación (captcha) que Kino no puede resolver. Prueba más tarde.", "The site is asking for a human check that Kino cannot solve. Try later.")
      : t("El sitio no respondió. Prueba más tarde.", "The site did not answer. Try later."),
  });
}

// ---------- texto ----------
function clean(s) {
  if (!s) return "";
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(re, s) {
  const m = String(s).match(re);
  return m ? m[1] : "";
}

function lastSeg(p) {
  const parts = String(p).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1].replace(/\.html$/, "") : "";
}

function idOf(path) {
  return String(path).replace(/^\/+/, "").replace(/[\/?#]/g, "-");
}

function hasNext(html) {
  return /rel="next"/.test(String(html));
}

// ---------- tarjetas ----------
function parseCards(html) {
  const items = [];
  const seen = new Set();
  const re = /<a\b[^>]*href="([^"]*\/(?:pelicula|serie)\/[^"\/?#]+)"[^>]*>([\s\S]{0,1500}?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const href = m[1];
    const inner = m[2];
    let path = href;
    if (/^https?:\/\//i.test(href)) {
      try {
        path = new URL(href).pathname;
      } catch (e) {
        continue;
      }
    }
    if (seen.has(path)) continue;
    const poster = firstMatch(/data-src="([^"]+)"/, inner) || firstMatch(/\bsrc="([^"]+)"/, inner);
    let text = clean(inner);
    let kind = /\/serie\//.test(path) ? "series" : "movie";
    if (/^(Anime|Dorama|Dibujos)\b/i.test(text)) kind = "series";
    text = text.replace(/^(Pel[íi]cula(\s+de\s+TV)?|Serie|Anime|Dorama|Dibujos)\s*/i, "");
    text = text.replace(/★\s*[\d.,]+/g, " ").replace(/\bNUEVO\b/gi, " ");
    const yearM = text.match(/(\d{4})\s*$/);
    const year = yearM ? parseInt(yearM[1], 10) : NaN;
    if (yearM) text = text.slice(0, yearM.index);
    const title = text.replace(/\s+/g, " ").trim();
    if (!title || title.length > 200) continue;
    seen.add(path);
    const item = { id: idOf(path), title, kind, ref: path };
    if (poster) item.poster = abs(poster);
    if (Number.isFinite(year)) item.year = year;
    items.push(item);
  }
  return items;
}

// ---------- portada ----------
const SECTIONS = [
  [/pel[íi]culas?\s*recientes/i, "peliculas", "Películas recientes", "Recent movies"],
  [/series?\s*recientes/i, "series", "Series recientes", "Recent series"],
  [/^animes?\b/i, "anime", "Anime", "Anime"],
  [/doramas?\b/i, "doramas", "Doramas", "Dramas"],
  [/reci[eé]n\s*a[ñn]adidos?/i, "nuevo", "Recién añadido", "Just added"],
  [/netflix/i, "netflix", "Netflix", "Netflix"],
  [/amazon|prime/i, "amazon", "Amazon Prime", "Amazon Prime"],
  [/disney/i, "disney", "Disney+", "Disney+"],
  [/apple/i, "apple", "Apple TV+", "Apple TV+"],
  [/tokyo\s*mx/i, "tokyomx", "Tokyo Mx", "Tokyo Mx"],
  [/tv\s*tokyo/i, "tvtokyo", "Tv Tokyo", "Tv Tokyo"],
];

export async function home() {
  await kino.sleep(0);
  let html = "";
  try {
    const pg = await readPage("/", { timeoutMs: 12000 });
    html = pg.html;
  } catch (e) {
    throw kino.error("unavailable", "portada " + ((e && e.detail) || (e && e.code) || "error"), {
      userMessage: t("El sitio no respondió. Prueba más tarde.", "The site did not answer. Try later."),
    });
  }
  const rows = [];
  const parts = String(html).split(/<h[23][^>]*>/i);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const heading = clean(part.slice(0, 200)).slice(0, 70);
    let genre = "";
    let esTitle = "";
    let enTitle = "";
    for (const s of SECTIONS) {
      if (s[0].test(heading)) {
        genre = s[1];
        esTitle = s[2];
        enTitle = s[3];
        break;
      }
    }
    if (!genre) continue;
    if (rows.some((r) => r.genre === genre)) continue;
    const items = parseCards(part).slice(0, 60);
    if (!items.length) continue;
    rows.push({ id: genre, genre, title: t(esTitle, enTitle), items });
    if (rows.length >= 20) break;
  }
  if (!rows.length) {
    const all = parseCards(html);
    const movies = all.filter((x) => x.kind === "movie").slice(0, 60);
    const series = all.filter((x) => x.kind === "series").slice(0, 60);
    if (movies.length) rows.push({ id: "peliculas", genre: "peliculas", title: t("Películas", "Movies"), items: movies });
    if (series.length) rows.push({ id: "series", genre: "series", title: t("Series", "Series"), items: series });
  }
  if (!rows.length) {
    throw kino.error("unavailable", "portada sin filas", {
      userMessage: t("No pude cargar el catálogo ahora.", "Could not load the catalog now."),
    });
  }
  return rows;
}

// ---------- búsqueda ----------
export async function search(query, opts) {
  await kino.sleep(0);
  const q = String(query || "").trim();
  if (!q) return { items: [] };
  const page = Number((opts && opts.page) || 1);
  const path = "/buscar?q=" + encodeURIComponent(q) + (page > 1 ? "&page=" + page : "");
  const r = await readPage(path, { timeoutMs: 12000 });
  return { items: parseCards(r.html).slice(0, 100), hasNext: hasNext(r.html) };
}

// ---------- navegar ----------
export async function browse(path, opts) {
  await kino.sleep(0);
  const page = Number((opts && opts.page) || 1);
  const p = String(path || "/peliculas");
  const withPage = page > 1 ? p + (p.includes("?") ? "&" : "?") + "page=" + page : p;
  const r = await readPage(withPage, { timeoutMs: 12000 });
  return { items: parseCards(r.html).slice(0, 100), hasNext: hasNext(r.html) };
}

// ---------- episodios ----------
export async function episodes(ref) {
  await kino.sleep(0);
  const r = await readPage(abs(ref), { timeoutMs: 12000 });
  const html = r.html;
  const items = [];
  const seen = new Set();
  const re = /<a\b[^>]*href="([^"]*\/temporada-(\d+)\/episodio-(\d+))"[^>]*>([\s\S]{0,400}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const path = m[1].startsWith("http") ? new URL(m[1]).pathname : m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const season = parseInt(m[2], 10) || 1;
    const ep = parseInt(m[3], 10) || 1;
    const label = clean(m[4])
      .replace(/^(T\d+E\d+|Episodio\s*\d+|\d+)\s*[·:.\-–]?\s*/i, "")
      .slice(0, 90);
    items.push({
      id: idOf(path),
      title: "T" + season + "E" + String(ep).padStart(2, "0") + (label ? " · " + label : ""),
      season,
      episode: ep,
      kind: "episode",
      ref: path,
    });
  }
  return { items };
}

// ---------- servidores ----------
function parseServers(html) {
  const out = [];
  const seen = new Set();
  const re = /<[^>]*data-player-token="([^"]+)"[^>]*>([\s\S]{0,300}?)<\/(?:button|a|div|span)>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const token = m[1];
    if (seen.has(token)) continue;
    seen.add(token);
    const tag = m[0].slice(0, m[0].indexOf(">") + 1);
    const label =
      clean(firstMatch(/data-(?:server|name|label)="([^"]+)"/, tag)) ||
      clean(m[2]).slice(0, 40) ||
      t("Servidor", "Server");
    const lang = clean(firstMatch(/data-lang="([^"]+)"/, tag));
    out.push({ token, label, lang });
  }
  return out;
}

async function playerUrl(token, pageUrl) {
  const origin = new URL(pageUrl).origin;
  const cookieUrl = origin + "/sanctum/csrf-cookie";
  try {
    await req(cookieUrl, { headers: { accept: "*/*" } });
  } catch (e) {}
  let xsrf = cookieValue(origin + "/", "XSRF-TOKEN");
  if (!xsrf) xsrf = cookieValue(cookieUrl, "XSRF-TOKEN");
  let decoded = xsrf;
  try {
    decoded = decodeURIComponent(xsrf);
  } catch (e) {}

  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin,
    referer: pageUrl,
    "x-requested-with": "XMLHttpRequest",
    "x-xsrf-token": decoded,
    "x-sl-render": "1",
  };
  const r = await req(origin + "/api/player-url", {
    method: "POST",
    headers,
    body: JSON.stringify({ token, player_token: token }),
  });
  if (r.status >= 400) throw kino.error("unavailable", "player-url " + r.status);
  let url = "";
  try {
    const j = JSON.parse(r.text);
    url = j.url || j.embed || j.player || (j.data && (j.data.url || j.data.embed)) || "";
  } catch (e) {
    url = firstMatch(/https?:\/\/[^\s"'\\]+/, r.text);
  }
  if (!url) throw kino.error("unavailable", "player-url vacio");
  return url;
}

// ---------- cripto ----------
function bytesToHex(b) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return s;
}

function hexToBytes(h) {
  const out = new Uint8Array(Math.floor(String(h).length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(String(h).substr(i * 2, 2), 16);
  return out;
}

function b64ToBytes(s) {
  const bin = atob(String(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToText(b) {
  return new TextDecoder().decode(b);
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  let out;
  try {
    out = await kino.crypto.hash("sha256", bytes);
  } catch (e) {
    out = await kino.crypto.hash("sha256", text);
  }
  if (typeof out === "string") return out;
  if (out instanceof Uint8Array) return bytesToHex(out);
  if (out && out.bytes) return bytesToHex(out.bytes);
  return bytesToHex(out);
}

async function aesDecrypt(keyBytes, ivBytes, dataBytes) {
  const c = kino.crypto;
  const tries = [
    () => c.decrypt({ algo: "aes-cbc", key: keyBytes, iv: ivBytes, data: dataBytes }),
    () => c.decrypt("aes-cbc", keyBytes, ivBytes, dataBytes),
    () => c.decrypt({ algorithm: "AES-CBC", key: keyBytes, iv: ivBytes, data: dataBytes }),
    () => c.decrypt("AES-CBC", keyBytes, ivBytes, dataBytes),
  ];
  let last;
  for (const fn of tries) {
    try {
      const out = await fn();
      if (out) return out;
    } catch (e) {
      last = e;
    }
  }
  throw last || kino.error("unavailable", "aes");
}

async function solvePow(salt, difficulty) {
  const target = "0".repeat(Math.max(1, Math.min(difficulty, 6)));
  for (let n = 0; n < 200000; n++) {
    const h = await sha256Hex(salt + n);
    if (h.startsWith(target)) return n;
    if (n % 3000 === 2999) await kino.sleep(0);
  }
  return null;
}

function pickFromPayload(text) {
  const candidates = [];
  const re = /https?:\/\/[^\s"'\\<>]+/g;
  let m;
  while ((m = re.exec(String(text)))) {
    const u = m[0].replace(/\\\//g, "/").replace(/[),]+$/, "");
    if (/\.(m3u8|mp4)(\?|$)/i.test(u)) {
      return { url: u, mime: /m3u8/i.test(u) ? "application/vnd.apple.mpegurl" : "video/mp4" };
    }
    if (/embed69\.org\/(video|f|e)\//.test(u) && !candidates.includes(u)) candidates.push(u);
    else if (/\/f\/[A-Za-z0-9_-]+/.test(u) && !candidates.includes(u)) candidates.push(u);
  }
  return candidates.length ? { embed: candidates[0] } : null;
}

async function embedStream(embedUrl) {
  const r = await req(embedUrl, { headers: { referer: BASE + "/" } });
  const html = r.text;

  const dataB64 = firstMatch(/dataLink\s*[:=]\s*["']([A-Za-z0-9+/=]{16,})["']/, html);
  const salt = firstMatch(/POW_SALT\s*[:=]\s*["']([^"']+)["']/, html);
  const challenge = firstMatch(/POW_CHALLENGE\s*[:=]\s*["']([^"']+)["']/, html);
  const difficulty = parseInt(firstMatch(/POW_DIFFICULTY\s*[:=]\s*(\d+)/, html), 10) || 4;

  if (dataB64 && salt && challenge) {
    const nonce = await solvePow(salt, difficulty);
    if (nonce !== null) {
      const origin = new URL(embedUrl).origin;
      const q = "challenge=" + encodeURIComponent(challenge) + "&nonce=" + nonce;
      const paths = ["/api/pow?" + q, "/api/pow/verify?" + q, "/pow?" + q];
      for (const p of paths) {
        let j = null;
        try {
          const kr = await req(origin + p, { headers: { accept: "application/json" } });
          if (kr.status < 400) j = JSON.parse(kr.text);
        } catch (e) {}
        if (!j) continue;
        const key = j.key || j.aesKey || (j.data && j.data.key);
        const iv = j.iv || (j.data && j.data.iv);
        if (!key) continue;
        try {
          const keyBytes = /^[0-9a-f]{32,64}$/i.test(key) ? hexToBytes(key) : b64ToBytes(key);
          const ivBytes = /^[0-9a-f]{32}$/i.test(iv) ? hexToBytes(iv) : b64ToBytes(iv);
          const plain = bytesToText(await aesDecrypt(keyBytes, ivBytes, b64ToBytes(dataB64)));
          const found = pickFromPayload(plain);
          if (found) return found;
        } catch (e) {}
      }
    }
  }

  const direct = pickFromPayload(html);
  if (direct) return direct;
  throw kino.error("unavailable", "embed");
}

// ---------- hosts de video ----------
const HOST_MAP = [
  [/morencius|mivalyo|dinisglows|dhtpre|minochinos|sblona/, "vidhidepro"],
  [/hglink|swdyu|cybervynx|dumbalag|lulu/, "streamwish"],
  [/filemoon/, "filemoon"],
];

function normalize(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    for (const [re, target] of HOST_MAP) {
      if (re.test(host)) {
        if (target === "filemoon") return "https://filemoon.sx" + u.pathname + u.search;
        if (target === "vidhidepro") return "https://vidhidepro.com/v/" + lastSeg(u.pathname);
        if (target === "streamwish") return "https://streamwish.to/e/" + lastSeg(u.pathname);
      }
    }
  } catch (e) {}
  return url;
}

async function unpackHost(url) {
  if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
    return { url, mime: /m3u8/i.test(url) ? "application/vnd.apple.mpegurl" : "video/mp4" };
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch (e) {}
  const referer = "https://" + host + "/";
  let html = "";
  try {
    const r = await req(url, { headers: { referer } });
    html = r.text;
  } catch (e) {
    return { url, mime: "video/mp4", headers: { Referer: referer } };
  }
  const found = pickFromPayload(html);
  if (found && found.url) {
    return {
      url: found.url,
      mime: found.mime,
      headers: { Referer: referer },
    };
  }
  const srcs = [];
  const re = /(?:file|src|source|url)\s*[:=]\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) {
    const u = m[1].replace(/\\\//g, "/");
    if (/\.(m3u8|mp4)(\?|$)/i.test(u)) srcs.push(u);
  }
  if (srcs.length) {
    const u = abs(srcs[0]);
    return { url: u, mime: /m3u8/i.test(u) ? "application/vnd.apple.mpegurl" : "video/mp4", headers: { Referer: referer } };
  }
  return { url, mime: "video/mp4", headers: { Referer: referer } };
}

// ---------- resolve ----------
async function oneServer(server, pageUrl) {
  const target = await playerUrl(server.token, pageUrl);
  let url = target;
  let referer = pageUrl;
  if (/embed69\.org/.test(target)) {
    const step = await embedStream(target);
    if (step.embed) {
      const r2 = await req(step.embed, { headers: { referer: target } });
      const inner = pickFromPayload(r2.text);
      if (inner && inner.url) {
        url = inner.url;
      } else if (inner && inner.embed) {
        const step2 = await embedStream(inner.embed);
        url = step2.url || "";
        referer = inner.embed;
      }
    } else {
      url = step.url || "";
      referer = target;
    }
  }
  if (!url) throw kino.error("unavailable", "sin video");
  const stream = await unpackHost(normalize(url));
  return { url: stream.url, mime: stream.mime, headers: stream.headers || { Referer: referer } };
}

export async function resolve(ref) {
  await kino.sleep(0);
  const parts = String(ref).split("|");
  const pageUrl = abs(parts[0]);
  const forced = parts[1] || "";

  let html = "";
  try {
    const pg = await readPage(pageUrl, { timeoutMs: 15000 });
    html = pg.html;
  } catch (e) {
    html = "";
  }

  const servers = parseServers(html);
  const ordered = servers.slice().sort((a, b) => {
    const score = (s) => (/latino|castellano|español|sub/i.test(s.label + " " + s.lang) ? 0 : 1);
    return score(a) - score(b);
  });
  const pool = forced ? ordered.filter((s) => s.token === forced) : ordered;

  const used = [];
  let first = null;
  for (const s of pool.slice(0, 3)) {
    try {
      const st = await oneServer(s, pageUrl);
      used.push(s);
      first = st;
      break;
    } catch (e) {
      used.push(s);
    }
  }

  if (!first && !forced && typeof kino.browser !== "undefined" && kino.browser && typeof kino.browser.capture === "function") {
    try {
      const cap = await kino.browser.capture(pageUrl, { timeoutMs: 25000, autoplay: true });
      const media = (cap && cap.media) || [];
      if (media.length && media[0].url) {
        first = { url: media[0].url, mime: media[0].mime || "video/mp4", headers: media[0].headers || {} };
      }
    } catch (e) {}
  }

  if (!first) {
    throw kino.error("unavailable", "servidores " + used.length + "/" + servers.length, {
      userMessage: t("Ningún servidor respondió. Prueba otro título.", "No server answered. Try another title."),
    });
  }

  const rest = forced ? [] : ordered.filter((s) => !used.includes(s)).slice(0, 6);
  const alternatives = rest.map((s) => ({
    label: String(s.label || t("Servidor", "Server")).slice(0, 40) + (s.lang ? " · " + s.lang : ""),
    ref: parts[0] + "|" + s.token,
  }));

  const out = { url: first.url, mime: first.mime, headers: first.headers };
  if (alternatives.length) out.alternatives = alternatives;
  return out;
}