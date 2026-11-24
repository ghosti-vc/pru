// SoloLatino para Kino — películas, series, anime y doramas en español latino.
// El sitio está detrás de Cloudflare: las páginas se leen con el navegador oculto.

const BASE = "https://sololatino.net";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---------- idioma ----------
function es() {
  return !String(kino.lang || "es-CO").toLowerCase().startsWith("en");
}
function t(esText, enText) {
  return es() ? esText : enText;
}

// ---------- red ----------
const FULL_HEADERS = {
  "user-agent": UA,
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "es-419,es;q=0.9,en;q=0.8",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};

async function rawFetch(url, opts) {
  const o = opts || {};
  const base = o.minimal
    ? { "user-agent": UA, accept: "*/*", "accept-language": "es-419,es;q=0.9" }
    : Object.assign({}, FULL_HEADERS);
  if (o.headers) for (const k in o.headers) base[k] = o.headers[k];
  const init = { headers: base, method: o.method || "GET" };
  if (o.body != null) init.body = o.body;
  const res = await kino.fetch(url, init);
  const text = await res.text();
  return { status: res.status, text, url: res.url || url };
}

// El navegador oculto primero; kino.fetch solo como respaldo.
async function pageHtml(url, timeoutMs) {
  if (kino.browser && typeof kino.browser.page === "function") {
    try {
      const p = await kino.browser.page(url, { timeoutMs: timeoutMs || 12000 });
      if (p && p.html && String(p.html).length > 500) return p.html;
    } catch (e) {}
  }
  const r = await rawFetch(url);
  if (r.status === 404) {
    throw kino.error("not_found", "http 404", {
      userMessage: t("Ese título ya no está en el sitio.", "That title is gone from the site."),
    });
  }
  if (r.status >= 400) {
    throw kino.error("unavailable", "http " + r.status, {
      userMessage: t("El sitio no respondió. Prueba más tarde.", "The site did not answer. Try later."),
    });
  }
  return r.text;
}

function cookieGet(url, name) {
  try {
    if (kino.cookies && typeof kino.cookies.get === "function") {
      return kino.cookies.get(url, name) || "";
    }
  } catch (e) {}
  return "";
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

function abs(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return "https:" + u;
  return BASE + (u.startsWith("/") ? u : "/" + u);
}

function firstMatch(re, s) {
  const m = String(s).match(re);
  return m ? m[1] : "";
}

function slugOf(path) {
  return String(path).replace(/^\//, "").replace(/[^A-Za-z0-9._~-]+/g, "_").slice(0, 128);
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!x || !x.id || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

// ---------- tarjetas ----------
const GENRE_OF_BADGE = {
  "badge-movie": "peliculas",
  "badge-series": "series",
  "badge-anime": "anime",
  "badge-dorama": "doramas",
  "badge-toon": "infantil",
};

function parseCards(html) {
  const items = [];
  const chunks = String(html).split('class="card"').slice(1);
  for (const c of chunks) {
    const href = firstMatch(/href="([^"]+)"/, c);
    if (!href || !/\/(pelicula|serie)\//.test(href)) continue;
    const title = clean(firstMatch(/card__title">([\s\S]*?)<\//, c));
    if (!title) continue;
    const path = href.startsWith("http") ? new URL(href).pathname : href;
    const poster = abs(
      firstMatch(/class="card__poster"[^>]*src="([^"]+)"/, c) || firstMatch(/src="([^"]+)"/, c)
    );
    const year = parseInt(firstMatch(/card__year">\s*(\d{4})/, c), 10);
    const badge = firstMatch(/card__badge\s+(badge-[a-z]+)/, c);
    const isSeries = path.includes("/serie/") || (badge && badge !== "badge-movie");
    const genre = GENRE_OF_BADGE[badge] || (isSeries ? "series" : "peliculas");
    const item = {
      id: slugOf(path),
      ref: path,
      title,
      kind: isSeries ? "series" : "movie",
      genres: [genre],
    };
    if (poster) item.poster = poster;
    if (Number.isFinite(year)) item.year = year;
    items.push(item);
  }
  return uniq(items);
}

function hasNext(html) {
  return /rel="next"/.test(html);
}

// ---------- filas de la portada ----------
const HOME_ROWS = [
  { id: "movies", genre: "peliculas", ref: "/peliculas", title: "Películas recientes", titleEn: "Recent movies" },
  { id: "series", genre: "series", ref: "/series", title: "Series", titleEn: "Series" },
  { id: "anime", genre: "anime", ref: "/animes", title: "Anime", titleEn: "Anime" },
  { id: "doramas", genre: "doramas", ref: "/doramas", title: "Doramas", titleEn: "Dramas" },
  { id: "kids", genre: "infantil", ref: "/genero/kids", title: "Infantil", titleEn: "Kids" },
];

// ---------- home ----------
export async function home() {
  await kino.sleep(0);
  let html = "";
  try {
    html = await pageHtml(BASE + "/", 14000);
  } catch (e) {
    throw kino.error("unavailable", "portada " + ((e && e.code) || "error"), {
      userMessage: t("No pude cargar el catálogo ahora.", "Could not load the catalog now."),
    });
  }
  const items = parseCards(html);
  if (!items.length) {
    throw kino.error("unavailable", "portada sin tarjetas", {
      userMessage: t("El sitio cambió o no respondió. Prueba más tarde.", "The site changed or did not answer. Try later."),
    });
  }
  const rows = [];
  for (const row of HOME_ROWS) {
    const got = items.filter((it) => it.genres[0] === row.genre).slice(0, 30);
    if (!got.length) continue;
    rows.push({
      id: row.id,
      title: t(row.title, row.titleEn),
      genre: row.genre,
      ref: row.ref,
      items: got,
    });
  }
  if (!rows.length) {
    throw kino.error("unavailable", "sin filas", {
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
  const html = await pageHtml(abs(path), 12000);
  return { items: parseCards(html).slice(0, 100), hasNext: hasNext(html) };
}

// ---------- ver más ----------
export async function browse(ref, opts) {
  await kino.sleep(0);
  const page = Number((opts && opts.page) || 1);
  const p = String(ref || "/peliculas");
  const withPage = page > 1 ? p + (p.includes("?") ? "&" : "?") + "page=" + page : p;
  const html = await pageHtml(abs(withPage), 12000);
  return { items: parseCards(html).slice(0, 100), hasNext: hasNext(html) };
}

// ---------- episodios ----------
export async function episodes(ref) {
  await kino.sleep(0);
  const html = await pageHtml(abs(ref), 14000);
  const items = [];
  const panels = html.split(/data-season-panel="(\d+)"/);
  for (let i = 1; i < panels.length; i += 2) {
    const season = parseInt(panels[i], 10) || 1;
    const body = panels[i + 1] || "";
    const links = body.split('class="ep-item').slice(1);
    for (const l of links) {
      const href = firstMatch(/href="([^"]+)"/, l);
      if (!href) continue;
      const path = href.startsWith("http") ? new URL(href).pathname : href;
      const numText = clean(firstMatch(/class="ep-num">([\s\S]*?)<\//, l));
      const ep =
        parseInt(firstMatch(/episodio-(\d+)/, path), 10) ||
        parseInt(firstMatch(/(\d+)/, numText), 10) ||
        1;
      const label = clean(firstMatch(/text-sm font-semibold[^"]*">([\s\S]*?)<\//, l));
      items.push({
        id: slugOf(path),
        ref: path,
        title: "T" + season + "E" + String(ep).padStart(2, "0") + (label ? " · " + label : ""),
        season,
        episode: ep,
        kind: "episode",
      });
    }
  }
  if (!items.length) {
    throw kino.error("not_found", "sin episodios", {
      userMessage: t("Esta serie todavía no tiene episodios.", "This series has no episodes yet."),
    });
  }
  return { items: uniq(items) };
}

// ---------- servidores ----------
function parseServers(html) {
  const out = [];
  const chunks = String(html).split('class="server-btn').slice(1);
  for (const c of chunks) {
    const token = firstMatch(/data-player-token="([^"]+)"/, c);
    if (!token) continue;
    const label = clean(firstMatch(/>([\s\S]*?)<\//, c));
    out.push({ token, label: label || t("Servidor", "Server") });
  }
  return out;
}

function csrfOf(html) {
  return firstMatch(/name="csrf-token" content="([^"]+)"/, html);
}

async function playerUrl(token, pageUrl, csrf) {
  const origin = new URL(pageUrl).origin;
  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin,
    referer: pageUrl,
    "x-requested-with": "XMLHttpRequest",
  };
  if (csrf) headers["x-csrf-token"] = csrf;
  const body = JSON.stringify({ token, player_token: token, _token: csrf || undefined });

  let r = await rawFetch(origin + "/api/player-url", { method: "POST", headers, body });
  if (r.status === 419) {
    try {
      await rawFetch(origin + "/sanctum/csrf-cookie", { minimal: true });
    } catch (e) {}
    const xsrf = cookieGet(origin + "/", "XSRF-TOKEN");
    if (xsrf) {
      let decoded = xsrf;
      try {
        decoded = decodeURIComponent(xsrf);
      } catch (e) {}
      headers["x-xsrf-token"] = decoded;
    }
    r = await rawFetch(origin + "/api/player-url", { method: "POST", headers, body });
  }
  if (r.status >= 400) throw kino.error("unavailable", "player-url " + r.status);

  let url = "";
  try {
    const j = JSON.parse(r.text);
    url = j.url || j.embed || j.player || (j.data && (j.data.url || j.data.embed)) || "";
  } catch (e) {
    url = firstMatch(/(https?:\/\/[^\s"'\\]+)/, r.text);
  }
  if (!url) throw kino.error("unavailable", "player-url vacio");
  return abs(url);
}

// ---------- embed69: POW + AES ----------
function sha256Hex(text) {
  return String(kino.crypto.hash("sha256", text)).replace(/^0x/, "").toLowerCase();
}

async function solvePow(salt, difficulty) {
  const zeros = "0".repeat(Math.max(1, Math.min(difficulty, 6)));
  for (let n = 0; n < 3000000; n++) {
    if (sha256Hex(salt + n).startsWith(zeros)) return n;
    if (n % 20000 === 19999) await kino.sleep(0);
  }
  return null;
}

async function aesDecrypt(key, iv, dataB64) {
  const keyIsHex = /^[0-9a-f]+$/i.test(key) && key.length % 2 === 0;
  const ivIsHex = /^[0-9a-f]+$/i.test(iv) && iv.length % 2 === 0;
  return kino.crypto.decrypt("aes-cbc", {
    key,
    iv,
    data: dataB64,
    keyEncoding: keyIsHex ? "hex" : "base64",
    ivEncoding: ivIsHex ? "hex" : "base64",
    inputEncoding: "base64",
    outputEncoding: "utf8",
  });
}

// ---------- buscar el video en un embed ----------
function decodeEscapes(s) {
  return String(s)
    .replace(/\\\//g, "/")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/g, "&");
}

function unpackPacker(html) {
  const m = String(html).match(
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/
  );
  if (!m) return "";
  const payload = m[1];
  const base = parseInt(m[2], 10);
  const words = m[4].split("|");
  if (!base || base < 2) return "";
  const enc = (c) =>
    (c < base ? "" : enc(Math.floor(c / base))) +
    (c % base > 35 ? String.fromCharCode((c % base) + 29) : (c % base).toString(36));
  return payload.replace(/\b\w+\b/g, (w) => {
    const idx = parseInt(w, base);
    return Number.isFinite(idx) && words[idx] ? words[idx] : w;
  });
}

function findMedia(text, baseUrl) {
  const t2 = decodeEscapes(text);
  const all = t2.match(/https?:\/\/[^\s"'\\<>,)]+?\.(?:m3u8|mp4)(?:\?[^\s"'\\<>,)]*)?/gi) || [];
  if (all.length) {
    const hls = all.find((u) => /\.m3u8/i.test(u));
    return hls || all[0];
  }
  const rel = firstMatch(/(?:file|src|source)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i, t2);
  if (rel) {
    if (/^https?:\/\//i.test(rel)) return rel;
    try {
      return new URL(baseUrl).origin + (rel.startsWith("/") ? rel : "/" + rel);
    } catch (e) {
      return rel;
    }
  }
  return "";
}

function mimeOf(url) {
  return /\.m3u8/i.test(url) ? "application/vnd.apple.mpegurl" : "video/mp4";
}

async function fromEmbed(embedUrl, referer) {
  const r = await rawFetch(embedUrl, { headers: { referer: referer || BASE + "/" } });
  let found = findMedia(r.text, embedUrl);
  if (!found) found = findMedia(unpackPacker(r.text), embedUrl);
  return found;
}

async function fromEmbed69(embedUrl, referer) {
  const r = await rawFetch(embedUrl, { headers: { referer: referer || BASE + "/" } });
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
          const kr = await rawFetch(origin + p, { headers: { accept: "application/json" } });
          if (kr.status < 400) j = JSON.parse(kr.text);
        } catch (e) {}
        if (!j) continue;
        const key = j.key || j.aesKey || (j.data && j.data.key);
        const iv = j.iv || (j.data && j.data.iv);
        if (!key || !iv) continue;
        try {
          const plain = await aesDecrypt(key, iv, dataB64);
          const found = findMedia(plain, embedUrl);
          if (found) return found;
        } catch (e) {}
      }
    }
  }

  let found = findMedia(html, embedUrl);
  if (!found) found = findMedia(unpackPacker(html), embedUrl);
  return found;
}

// ---------- hosts de video ----------
const HOST_MAP = [
  [/morencius|mivalyo|dinisglows|dhtpre/, "vidhidepro"],
  [/hglink|swdyu|cybervynx|dumbalag/, "streamwish"],
  [/filemoon/, "filemoon"],
];

function lastSeg(p) {
  const parts = String(p).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1].replace(/\.html$/, "") : "";
}

function normalize(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    for (const [re, target] of HOST_MAP) {
      if (!re.test(host)) continue;
      const id = lastSeg(u.pathname);
      if (!id) return url;
      if (target === "filemoon") return "https://filemoon.sx/" + id;
      if (target === "vidhidepro") return "https://vidhidepro.com/v/" + id;
      if (target === "streamwish") return "https://streamwish.to/e/" + id;
    }
  } catch (e) {}
  return url;
}

// ---------- un servidor ----------
async function oneServer(token, pageUrl, csrf) {
  const target = await playerUrl(token, pageUrl, csrf);
  const referer = BASE + "/";
  let url = "";
  if (/embed69\.org/.test(target)) url = await fromEmbed69(target, referer);
  if (!url) {
    const norm = normalize(target);
    url = await fromEmbed(norm, referer);
    if (!url && norm !== target) url = await fromEmbed(target, referer);
  }
  if (!url) throw kino.error("unavailable", "sin video");
  return { url, mime: mimeOf(url), headers: { Referer: referer } };
}

// ---------- respaldo: el navegador hace todo ----------
async function captureMedia(pageUrl) {
  if (!kino.browser || typeof kino.browser.capture !== "function") return null;
  try {
    const res = await kino.browser.capture(pageUrl, {
      timeoutMs: 24000,
      autoplay: true,
      headers: { referer: BASE + "/" },
    });
    const m = res && res.media && res.media[0];
    if (!m || !m.url) return null;
    return {
      url: m.url,
      mime: m.mime || mimeOf(m.url),
      headers: m.headers || { Referer: BASE + "/" },
    };
  } catch (e) {
    return null;
  }
}

// ---------- resolve ----------
export async function resolve(ref) {
  await kino.sleep(0);
  const raw = String(ref || "");

  // alternativa: "<ruta>|<token>"
  const bar = raw.indexOf("|");
  if (bar > 0) {
    const pageUrl = abs(raw.slice(0, bar));
    const token = raw.slice(bar + 1);
    const html = await pageHtml(pageUrl, 14000);
    try {
      return await oneServer(token, pageUrl, csrfOf(html));
    } catch (e) {
      const cap = await captureMedia(pageUrl);
      if (cap) return cap;
      throw e;
    }
  }

  const pageUrl = abs(raw);
  const html = await pageHtml(pageUrl, 16000);
  const csrf = csrfOf(html);
  const servers = parseServers(html);
  if (!servers.length) {
    throw kino.error("not_found", "sin servidores", {
      userMessage: t("Este título no tiene servidores disponibles.", "This title has no servers available."),
    });
  }
  const ordered = servers.slice().sort((a, b) => {
    const score = (s) => (/latino|castellano|español|principal|⭐/i.test(s.label) ? 0 : 1);
    return score(a) - score(b);
  });

  let first = null;
  let usedToken = "";
  for (const s of ordered.slice(0, 2)) {
    try {
      first = await oneServer(s.token, pageUrl, csrf);
      usedToken = s.token;
      break;
    } catch (e) {}
  }
  if (!first) first = await captureMedia(pageUrl);
  if (!first) {
    throw kino.error("unavailable", "todos", {
      userMessage: t("Ningún servidor respondió. Prueba otro título.", "No server answered. Try another title."),
    });
  }

  const rest = ordered.filter((s) => s.token !== usedToken).slice(0, 8);
  if (rest.length) {
    first.alternatives = rest.map((s) => ({
      label: s.label.slice(0, 48),
      ref: pageUrl + "|" + s.token,
    }));
  }
  return first;
}