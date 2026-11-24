// SoloLatino para Kino — películas, series, anime y doramas en español latino.
// Un solo archivo, sin import.

const BASE = "https://sololatino.net";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---------- idioma ----------
function t(es, en) {
  return String(kino.lang || "es-CO").toLowerCase().startsWith("en") ? en : es;
}

// ---------- jar de cookies propio ----------
const jar = new Map();

function jarHeader(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch (e) {
    return "";
  }
  const parts = [];
  for (const [h, m] of jar) {
    if (host === h || host.endsWith("." + h)) {
      for (const [k, v] of m) parts.push(k + "=" + v);
    }
  }
  return parts.join("; ");
}

function absorb(url, res) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch (e) {
    return;
  }
  const h = res && res.headers;
  if (!h) return;
  let raw = h["set-cookie"] || h["Set-Cookie"];
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
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch (e) {
    return "";
  }
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
    "accept-language": "es-419,es;q=0.9,en;q=0.8",
    accept: "text/html,application/json,*/*",
    ...(o.headers || {}),
  };
  const ck = jarHeader(url);
  if (ck) headers.cookie = ck;
  let res;
  try {
    res = await kino.fetch({ url, method: o.method || "GET", headers, body: o.body });
  } catch (e) {
    res = await kino.fetch(url, { method: o.method || "GET", headers, body: o.body });
  }
  absorb(url, res);
  const text = await bodyOf(res);
  return { status: statusOf(res), text, url };
}

async function getHtml(url) {
  const r = await req(url, { headers: { accept: "text/html,*/*" } });
  if (r.status === 403) throw kino.error("unavailable", "403", { userMessage: t("El sitio no respondió. Prueba más tarde.", "The site did not answer. Try later.") });
  if (r.status === 404) throw kino.error("not_found", "404", { userMessage: t("Ese título ya no está en el sitio.", "That title is gone from the site.") });
  if (r.status >= 400) throw kino.error("unavailable", String(r.status));
  return r;
}

// ---------- utilidades de texto ----------
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

function abs(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return "https:" + u;
  return BASE + (u.startsWith("/") ? u : "/" + u);
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!x || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

function firstMatch(re, s) {
  const m = String(s).match(re);
  return m ? m[1] : "";
}

// ---------- tarjetas ----------
function parseCards(html) {
  const items = [];
  const chunks = String(html).split(/class="[^"]*\bcard\b[^"]*"/).slice(1);
  for (const c of chunks) {
    const href = firstMatch(/href="([^"]+)"/, c);
    if (!href || href.startsWith("#")) continue;
    const title = clean(firstMatch(/card__title[^>]*>([\s\S]*?)<\//, c));
    if (!title) continue;
    const path = href.startsWith("http") ? new URL(href).pathname : href;
    const poster = abs(
      firstMatch(/data-src="([^"]+)"/, c) ||
        firstMatch(/data-original="([^"]+)"/, c) ||
        firstMatch(/src="([^"]+)"/, c)
    );
    const year = parseInt(firstMatch(/card__year[^>]*>\s*(\d{4})/, c), 10);
    const typeLabel = clean(firstMatch(/card__type[^>]*>([\s\S]*?)<\//, c)).toLowerCase();
    const isSeries =
      path.includes("/serie/") ||
      /serie|anime|dorama/.test(typeLabel) ||
      /serie|anime|dorama/.test(c.slice(0, 1200).toLowerCase());
    items.push({
      id: path,
      title,
      kind: isSeries ? "series" : "movie",
      poster,
      year: Number.isFinite(year) ? year : undefined,
      genres: isSeries ? ["series"] : ["peliculas"],
    });
  }
  return uniq(items);
}

function hasNext(html) {
  return /rel="next"/.test(html);
}

async function listPage(path) {
  const r = await getHtml(abs(path));
  const items = parseCards(r.text);
  return { items, hasNext: hasNext(r.text) };
}

// ---------- home ----------
const ROWS = [
  { title: "Recién agregado", genre: "peliculas", path: "/peliculas?orden=recientes" },
  { title: "Películas", genre: "peliculas", path: "/peliculas" },
  { title: "Series", genre: "series", path: "/series" },
  { title: "Anime", genre: "anime", path: "/genero/anime" },
  { title: "Doramas", genre: "drama", path: "/genero/dorama" },
  { title: "Acción", genre: "accion", path: "/genero/accion" },
  { title: "Comedia", genre: "comedia", path: "/genero/comedia" },
  { title: "Ciencia ficción", genre: "ciencia-ficcion", path: "/genero/ciencia-ficcion" },
  { title: "Terror", genre: "terror", path: "/genero/terror" },
  { title: "Romance", genre: "romance", path: "/genero/romance" },
];

export async function home() {
  await kino.sleep(0);
  const rows = [];
  for (const row of ROWS) {
    try {
      const page = await listPage(row.path);
      if (!page.items.length) continue;
      rows.push({
        title: row.title,
        genre: row.genre,
        items: page.items.slice(0, 60),
      });
    } catch (e) {}
    if (rows.length >= 20) break;
  }
  if (!rows.length) throw kino.error("unavailable", "home", { userMessage: t("No pude cargar el catálogo ahora.", "Could not load the catalog now.") });
  return { rows };
}

// ---------- búsqueda ----------
export async function search(query, opts) {
  await kino.sleep(0);
  const q = String(query || "").trim();
  if (!q) return { items: [] };
  const page = Number((opts && opts.page) || 1);
  const path = "/buscar?q=" + encodeURIComponent(q) + (page > 1 ? "&page=" + page : "");
  const r = await getHtml(abs(path));
  return { items: parseCards(r.text).slice(0, 100), hasNext: hasNext(r.text) };
}

export async function browse(path, opts) {
  await kino.sleep(0);
  const page = Number((opts && opts.page) || 1);
  const p = String(path || "/peliculas");
  const withPage = page > 1 ? p + (p.includes("?") ? "&" : "?") + "page=" + page : p;
  const r = await getHtml(abs(withPage));
  return { items: parseCards(r.text).slice(0, 100), hasNext: hasNext(r.text) };
}

// ---------- detalle ----------
async function detail(ref) {
  const r = await getHtml(abs(ref));
  const html = r.text;
  const title = clean(firstMatch(/<h1[^>]*>([\s\S]*?)<\/h1>/, html));
  const poster = abs(
    firstMatch(/class="[^"]*w-44[^"]*"[^>]*src="([^"]+)"/, html) ||
      firstMatch(/<img[^>]*class="[^"]*w-44[^"]*"[^>]*src="([^"]+)"/, html) ||
      firstMatch(/og:image"\s+content="([^"]+)"/, html)
  );
  const plot = clean(firstMatch(/class="[^"]*leading-relaxed[^"]*"[^>]*>([\s\S]*?)<\//, html));
  const year = parseInt(firstMatch(/\((\d{4})\)/, title) || firstMatch(/"datePublished":"(\d{4})/, html), 10);
  return { title, poster, plot, year, html };
}

export async function episodes(ref) {
  await kino.sleep(0);
  const url = abs(ref);
  const r = await getHtml(url);
  const html = r.text;
  const items = [];
  const panels = html.split(/data-season-panel/).slice(1);
  let season = 1;
  for (const panel of panels) {
    const sn = parseInt(firstMatch(/temporada-(\d+)/, panel), 10);
    if (Number.isFinite(sn)) season = sn;
    const links = panel.split(/class="[^"]*\bep-item\b[^"]*"/).slice(1);
    for (const l of links) {
      const href = firstMatch(/href="([^"]+)"/, l);
      if (!href) continue;
      const numText = clean(firstMatch(/ep-num[^>]*>([\s\S]*?)<\//, l));
      const ep = parseInt(firstMatch(/episodio-(\d+)/, href) || firstMatch(/(\d+)/, numText), 10);
      const label = clean(firstMatch(/<p[^>]*class="[^"]*(?!ep-num)[^"]*"[^>]*>([\s\S]*?)<\//, l));
      items.push({
        id: href.startsWith("http") ? new URL(href).pathname : href,
        title: "T" + season + "E" + String(Number.isFinite(ep) ? ep : 1).padStart(2, "0") + (label ? " · " + label : ""),
        season,
        episode: Number.isFinite(ep) ? ep : undefined,
        kind: "episode",
      });
    }
  }
  return { items };
}

// ---------- servidores ----------
function parseServers(html) {
  const out = [];
  const chunks = String(html).split(/class="[^"]*\bserver-btn\b[^"]*"/).slice(1);
  for (const c of chunks) {
    const token = firstMatch(/data-player-token="([^"]+)"/, c);
    if (!token) continue;
    const label = clean(firstMatch(/data-server(?:-name)?="([^"]+)"/, c)) || clean(firstMatch(/>([\s\S]*?)<\//, c));
    const lang = clean(firstMatch(/data-lang="([^"]+)"/, c));
    out.push({ token, label: label || t("Servidor", "Server"), lang });
  }
  return out;
}

async function playerUrl(token, pageUrl) {
  const origin = new URL(pageUrl).origin;
  const cookieUrl = origin + "/sanctum/csrf-cookie";
  await req(cookieUrl, { headers: { accept: "*/*" } });
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
    url = firstMatch(/(https?:\/\/[^\s"'\\]+)/, r.text);
  }
  if (!url) throw kino.error("unavailable", "sin url");
  return abs(url);
}

// ---------- embed69: POW + AES ----------
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += (x < 16 ? "0" : "") + x.toString(16);
  return s;
}

function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function b64ToBytes(s) {
  const bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToText(b) {
  try {
    return new TextDecoder().decode(b);
  } catch (e) {
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return s;
  }
}

async function sha256Hex(text) {
  const c = kino.crypto;
  let out;
  try {
    out = await c.hash("sha256", text);
  } catch (e) {
    out = await c.hash(text);
  }
  if (typeof out === "string") return out.replace(/^0x/, "").toLowerCase();
  if (out && out.hex) return String(out.hex).toLowerCase();
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
  for (let n = 0; n < 400000; n++) {
    const h = await sha256Hex(salt + n);
    if (h.startsWith(target)) return n;
    if (n % 3000 === 2999) await kino.sleep(0);
  }
  return null;
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

const HOST_MAP = [
  [/morencius|mivalyo|dinisglows|dhtpre/, "vidhidepro"],
  [/hglink|swdyu|cybervynx|dumbalag/, "streamwish"],
  [/filemoon/, "filemoon"],
];

function pickFromPayload(text) {
  const candidates = [];
  const re = /https?:\/\/[^\s"'\\<>]+/g;
  let m;
  while ((m = re.exec(String(text)))) {
    let u = m[0].replace(/\\\//g, "/").replace(/[),]+$/, "");
    if (/\.(m3u8|mp4)(\?|$)/i.test(u)) return { url: u, mime: /m3u8/i.test(u) ? "application/vnd.apple.mpegurl" : "video/mp4" };
    if (/embed69\.org\/(video|f|e)\//.test(u) && !candidates.includes(u)) candidates.push(u);
    else if (/\/f\/[A-Za-z0-9_-]+/.test(u) && !candidates.includes(u)) candidates.push(u);
  }
  return candidates.length ? { embed: candidates[0] } : null;
}

// ---------- hosts de video ----------
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
  const srcs = [];
  const re = /(?:file|src|source|url)\s*[:=]\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) {
    const u = m[1].replace(/\\\//g, "/");
    if (/\.(m3u8|mp4)(\?|$)/i.test(u)) srcs.push(u);
  }
  if (!srcs.length) {
    const packed = firstMatch(/sources\s*:\s*\[([\s\S]*?)\]/, html);
    if (packed) {
      const f = firstMatch(/"file"\s*:\s*"([^"]+)"/, packed);
      if (f) srcs.push(f.replace(/\\\//g, "/"));
    }
  }
  if (srcs.length) {
    const u = abs(srcs[0]);
    return { url: u, mime: /m3u8/i.test(u) ? "application/vnd.apple.mpegurl" : "video/mp4", headers: { Referer: referer } };
  }
  return { url, mime: "video/mp4", headers: { Referer: referer } };
}

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

function lastSeg(p) {
  const parts = String(p).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1].replace(/\.html$/, "") : "";
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
  const pageUrl = abs(ref);
  const r = await getHtml(pageUrl);
  const servers = parseServers(r.text);
  if (!servers.length) {
    throw kino.error("not_found", "sin servidores", {
      userMessage: t("Este título no tiene servidores disponibles.", "This title has no servers available."),
    });
  }
  const ordered = servers.slice().sort((a, b) => {
    const score = (s) => (/latino|castellano|español|sub/i.test(s.label + " " + s.lang) ? 0 : 1);
    return score(a) - score(b);
  });
  const used = [];
  let first = null;
  for (const s of ordered.slice(0, 4)) {
    try {
      const st = await oneServer(s, pageUrl);
      if (!first) first = st;
      used.push(s);
      if (first) break;
    } catch (e) {
      used.push(s);
    }
  }
  if (!first) {
    throw kino.error("unavailable", "todos", {
      userMessage: t("Ningún servidor respondió. Prueba otro título.", "No server answered. Try another title."),
    });
  }
  const rest = ordered.filter((s) => !used.includes(s)).slice(0, 8);
  if (rest.length) {
    first.alternatives = rest.map((s) => ({ label: s.label, ref: pageUrl + "|" + s.token }));
  }
  return first;
}

export async function resolveAlternative(ref) {
  await kino.sleep(0);
  const [pageUrl, token] = String(ref).split("|");
  const server = { token, label: t("Alternativa", "Alternative") };
  return oneServer(server, pageUrl);
}

// ---------- prepare ----------
export async function prepare(ref) {
  await kino.sleep(0);
  try {
    const r = await req(abs(ref), { headers: { accept: "text/html,*/*" } });
    if (r.status < 400) parseServers(r.text);
  } catch (e) {}
}