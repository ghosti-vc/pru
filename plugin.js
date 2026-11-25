/* Pelistube: catálogo de TubePelis y resolución de sus dos reproductores. */
const BASE = "https://www.tubepelis.com";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const en = () => kino.lang === "en-US";
const T = (es, txt) => (en() ? txt : es);

/* ---------- red ---------- */

async function get(url, extra) {
  const headers = {
    "User-Agent": UA,
    "Accept-Language": en() ? "en-US,en;q=0.9" : "es-CO,es;q=0.9",
    Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    ...(extra || {}),
  };
  return kino.fetch(url, { headers, timeoutMs: 12000 });
}

async function getText(url, extra) {
  const r = await get(url, extra);
  return r.ok ? r.text() : null;
}

async function postJson(url, headers, body) {
  const r = await kino.fetch(url, {
    method: "POST",
    headers: { "User-Agent": UA, Accept: "application/json", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body || {}),
    timeoutMs: 12000,
  });
  const raw = await r.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    json = null;
  }
  return { ok: r.ok, status: r.status, json, raw };
}

/* ---------- utilidades ---------- */

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function b64url(s) {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(s) {
  return new TextEncoder().encode(s);
}

const YEAR = /\b(19[5-9]\d|20[0-4]\d)\b/;

function cards(html, genre, adult) {
  const out = [];
  const seen = new Set();
  const re = /<a\s[^>]*href="https:\/\/www\.tubepelis\.com\/(pelicula|serie)\/(\d+)\/([^"#?]+)\.html"[^>]*>([\s\S]{0,900}?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const kind = m[1] === "serie" ? "series" : "movie";
    const num = m[2];
    const id = (kind === "series" ? "s" : "m") + num;
    if (seen.has(id)) continue;
    const block = m[4];
    const img = block.match(/src="(https:\/\/www\.tubepelis\.com\/files\/uploads\/[^"]+)"/);
    if (!img) continue;
    let title = "";
    const alt = block.match(/alt="([^"]*)"/);
    if (alt) title = decodeEntities(alt[1]);
    if (!title) {
      const b = block.match(/<b[^>]*>([\s\S]*?)<\/b>/) || block.match(/<h4[^>]*>([\s\S]*?)<\/h4>/);
      if (b) title = decodeEntities(b[1].replace(/<[^>]+>/g, ""));
    }
    title = title.replace(/^Póster de\s+/i, "").replace(/\s*\(\d{4}\)\s*$/, "");
    if (!title) continue;
    seen.add(id);
    const y = block.match(YEAR);
    const item = {
      id,
      ref: (kind === "series" ? "s|/serie/" : "m|/pelicula/") + num + "/" + m[3] + ".html|0",
      title,
      kind,
      poster: img[1],
      genres: genre ? [genre] : [],
    };
    if (y) item.year = Number(y[1]);
    if (adult) item.adult = true;
    out.push(item);
    if (out.length >= 60) break;
  }
  return out;
}

async function mapLimit(list, size, fn) {
  const out = new Array(list.length);
  let i = 0;
  async function worker() {
    for (;;) {
      const k = i++;
      if (k >= list.length) return;
      try {
        out[k] = await fn(list[k]);
      } catch (e) {
        out[k] = null;
      }
    }
  }
  const workers = [];
  for (let w = 0; w < size; w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

/* ---------- filas de Inicio ---------- */

const ROWS = [
  { id: "estrenos", url: "/estrenos.html", title: "Estrenos", titleEn: "New releases", genre: "peliculas" },
  { id: "vistas", url: "/pelicula/peliculas-mas-vistas/", title: "Más vistas", titleEn: "Most watched", genre: "peliculas" },
  { id: "cartelera", url: "/pelicula/ultimas-peliculas/cartelera/", title: "En cartelera", titleEn: "In cinemas", genre: "peliculas" },
  { id: "accion", url: "/categoria/accion/", title: "Acción", titleEn: "Action", genre: "accion" },
  { id: "comedia", url: "/categoria/comedia/", title: "Comedia", titleEn: "Comedy", genre: "comedia" },
  { id: "drama", url: "/categoria/drama/", title: "Drama", titleEn: "Drama", genre: "drama" },
  { id: "terror", url: "/categoria/terror/", title: "Terror", titleEn: "Horror", genre: "terror" },
  { id: "suspenso", url: "/categoria/suspenso/", title: "Suspenso", titleEn: "Thriller", genre: "suspenso" },
  { id: "ciencia-ficcion", url: "/categoria/ciencia-ficcion/", title: "Ciencia ficción", titleEn: "Sci-fi", genre: "ciencia-ficcion" },
  { id: "romance", url: "/categoria/romance/", title: "Romance", titleEn: "Romance", genre: "romance" },
  { id: "infantil", url: "/categoria/animacion-e-infantil/", title: "Animación e infantil", titleEn: "Animation and kids", genre: "infantil" },
  { id: "anime", url: "/categoria/anime/", title: "Anime", titleEn: "Anime", genre: "anime" },
  { id: "aventura", url: "/categoria/aventura/", title: "Aventura", titleEn: "Adventure", genre: "aventura" },
  { id: "intriga", url: "/categoria/intriga/", title: "Intriga", titleEn: "Mystery", genre: "intriga" },
  { id: "fantasia", url: "/categoria/fantasia/", title: "Fantasía", titleEn: "Fantasy", genre: "fantasia" },
  { id: "documentales", url: "/categoria/documentales/", title: "Documentales", titleEn: "Documentaries", genre: "documentales" },
  { id: "musical", url: "/categoria/musical/", title: "Musical", titleEn: "Musical", genre: "musical" },
  { id: "deporte", url: "/categoria/deporte/", title: "Deporte", titleEn: "Sport", genre: "deportes" },
  { id: "religiosas", url: "/categoria/religiosas/", title: "Religiosas", titleEn: "Religious", genre: "religiosas" },
  { id: "eroticas", url: "/categoria/eroticas/", title: "Eróticas", titleEn: "Adult", genre: "eroticas", adult: true },
];

export async function home() {
  await null;
  const pages = await mapLimit(ROWS, 5, (row) => getText(BASE + row.url));
  const rows = [];
  pages.forEach((html, i) => {
    if (!html) return;
    const row = ROWS[i];
    const items = cards(html, row.genre, row.adult);
    if (items.length) rows.push({ id: row.id, title: T(row.title, row.titleEn), genre: row.genre, items });
  });
  return rows;
}

/* ---------- buscar ---------- */

export async function search(query) {
  await null;
  const q = String((query && query.q) || query || "").trim();
  if (!q) return [];
  const url = BASE + "/buscar/?q=" + encodeURIComponent(q);
  let html = await getText(url);
  if (!html) return [];
  let items = cards(html, null, false);
  if (!items.length) {
    const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (slug) {
      const alt = await getText(BASE + "/buscar/" + slug + "/");
      if (alt) items = cards(alt, null, false);
    }
  }
  return items.slice(0, 100);
}

/* ---------- ver más ---------- */

export async function browse(ref) {
  await null;
  const parts = String(ref || "").split("|");
  const slug = parts[1] || "accion";
  const page = Math.max(1, Number(parts[2] || 1));
  const html = await getText(BASE + "/categoria/" + slug + "/?page=" + page);
  if (!html) return { items: [] };
  const items = cards(html, slug, slug === "eroticas");
  const next = items.length ? "g|" + slug + "|" + (page + 1) : undefined;
  const out = { items };
  if (next) out.next = next;
  return out;
}

/* ---------- capítulos de una serie ---------- */

export async function episodes(ref) {
  await null;
  const path = String(ref || "").split("|")[1];
  if (!path) return [];
  const html = await getText(BASE + path);
  if (!html) return [];
  const out = [];
  const seen = new Set();
  const re = /href="(https:\/\/www\.tubepelis\.com\/(?:capitulo|episodio)\/(\d+)\/([^"#?]+)\.html)"[^>]*>([\s\S]{0,400}?)<\/(?:a|h\d)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = "e" + m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = decodeEntities(m[4].replace(/<[^>]+>/g, "")) || "Capítulo " + m[2];
    out.push({ id, ref: "e|" + new URL(m[1]).pathname + "|0", title, number: out.length + 1 });
  }
  return out;
}

/* ---------- reproductores ---------- */

function embedUrls(html) {
  const urls = [];
  const re = /reproductor\.php\?v=([A-Za-z0-9%_=+\-/]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let raw = m[1];
    try {
      raw = decodeURIComponent(raw);
    } catch (e) {
      /* se queda como está */
    }
    let url = "";
    try {
      url = atob(raw);
    } catch (e) {
      url = "";
    }
    if (/^https:\/\//.test(url) && urls.indexOf(url) === -1) urls.push(url);
  }
  return urls;
}

function mimeOf(t) {
  const s = String(t || "").toLowerCase();
  if (s.indexOf("mpegurl") !== -1) return "application/vnd.apple.mpegurl";
  if (s.indexOf("dash") !== -1) return "application/dash+xml";
  if (s.indexOf("webm") !== -1) return "video/webm";
  if (s.indexOf("mp4") !== -1) return "video/mp4";
  return "";
}

/* ---------- prueba de trabajo del reproductor ---------- */

const SBOX = (() => {
  const h =
    "637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0add4a2af9ca472c0b7fd9326363ff7cc34a5e5f171d8311504c723c31896059a071280e2eb27b27509832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cfd0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdbe0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9ee1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16";
  const a = new Uint8Array(256);
  for (let i = 0; i < 256; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
  return a;
})();

const RCON = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54];

function xt(a) {
  return ((a << 1) ^ ((a >> 7) * 27)) & 255;
}

function expandKey(key) {
  const nk = key.length >> 2;
  const nr = nk + 6;
  const w = new Uint8Array(16 * (nr + 1));
  w.set(key);
  let rc = 0;
  for (let i = nk; i < 4 * (nr + 1); i++) {
    const o = 4 * i;
    let t0 = w[o - 4];
    let t1 = w[o - 3];
    let t2 = w[o - 2];
    let t3 = w[o - 1];
    if (i % nk === 0) {
      const tmp = t0;
      t0 = SBOX[t1] ^ RCON[rc++];
      t1 = SBOX[t2];
      t2 = SBOX[t3];
      t3 = SBOX[tmp];
    } else if (nk > 6 && i % nk === 4) {
      t0 = SBOX[t0];
      t1 = SBOX[t1];
      t2 = SBOX[t2];
      t3 = SBOX[t3];
    }
    w[o] = w[o - 4 * nk] ^ t0;
    w[o + 1] = w[o + 1 - 4 * nk] ^ t1;
    w[o + 2] = w[o + 2 - 4 * nk] ^ t2;
    w[o + 3] = w[o + 3 - 4 * nk] ^ t3;
  }
  return { w, nr };
}

function encBlock(k, nr, inp, out) {
  const s = inp.slice();
  const add = (r) => {
    for (let i = 0; i < 16; i++) s[i] ^= k.w[16 * r + i];
  };
  add(0);
  for (let r = 1; r <= nr; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    const t = s.slice();
    for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) s[4 * c + row] = t[4 * ((c + row) & 3) + row];
    if (r !== nr) {
      for (let c = 0; c < 4; c++) {
        const a0 = s[4 * c];
        const a1 = s[4 * c + 1];
        const a2 = s[4 * c + 2];
        const a3 = s[4 * c + 3];
        s[4 * c] = xt(a0) ^ (xt(a1) ^ a1) ^ a2 ^ a3;
        s[4 * c + 1] = a0 ^ xt(a1) ^ (xt(a2) ^ a2) ^ a3;
        s[4 * c + 2] = a0 ^ a1 ^ xt(a2) ^ (xt(a3) ^ a3);
        s[4 * c + 3] = (xt(a0) ^ a0) ^ a1 ^ a2 ^ xt(a3);
      }
    }
    add(r);
  }
  out.set(s);
}

function ctrDecrypt(key, iv, data) {
  const { w, nr } = expandKey(key);
  const ctr = new Uint8Array(16);
  ctr.set(iv.subarray(0, Math.min(16, iv.length)));
  const out = new Uint8Array(data.length);
  const ks = new Uint8Array(16);
  for (let off = 0; off < data.length; off += 16) {
    for (let i = 15; i >= 12; i--) {
      ctr[i] = (ctr[i] + 1) & 255;
      if (ctr[i] !== 0) break;
    }
    encBlock(w, nr, ctr, ks);
    const n = Math.min(16, data.length - off);
    for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ ks[i];
  }
  return out;
}

/* el hash propio del reproductor */
const P512 = 511;

function rotl(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function mix(t) {
  t[0] = (t[0] + t[1]) >>> 0;
  t[3] = rotl(t[3] ^ t[0], 16);
  t[2] = (t[2] + t[3]) >>> 0;
  t[1] = rotl(t[1] ^ t[2], 12);
  t[0] = (t[0] + t[1]) >>> 0;
  t[3] = rotl(t[3] ^ t[0], 8);
  t[2] = (t[2] + t[3]) >>> 0;
  t[1] = rotl(t[1] ^ t[2], 7);
}

function powHash(bytes) {
  const e = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762]);
  for (let i = 0; i < bytes.length; i++) {
    e[0] = (e[0] + bytes[i]) >>> 0;
    e[0] = rotl(e[0], 7);
    mix(e);
  }
  for (let i = 0; i < 8; i++) mix(e);
  const r = new Uint32Array(512);
  for (let i = 0; i < 512; i++) {
    mix(e);
    r[i] = (e[0] ^ e[2]) >>> 0;
  }
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 512; i++) {
      const a = r[i] & P512;
      let c = (r[i] + r[a]) >>> 0;
      c = rotl(c, 13);
      c = (c ^ Math.imul(r[(i + 1) & P512], 2654435761)) >>> 0;
      r[i] = c;
      e[0] = (e[0] ^ c) >>> 0;
      mix(e);
    }
  }
  const n = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    mix(e);
    let s = e[0];
    const base = i * 64;
    for (let c = 0; c < 64; c++) {
      const d = r[base + c];
      s = (s + d) >>> 0;
      s = rotl(s, 5);
      s = (s ^ Math.imul(d, 2246822519)) >>> 0;
    }
    n[i] = (s ^ e[2]) >>> 0;
  }
  return n;
}

function zeroBits(w) {
  let total = 0;
  for (let i = 0; i < w.length; i++) {
    if (w[i] === 0) {
      total += 32;
      continue;
    }
    return total + Math.clz32(w[i]);
  }
  return total;
}

async function solve(nonce, bits, budgetMs) {
  if (!(bits > 0)) return "0";
  const prefix = utf8(nonce + ":");
  const started = Date.now();
  let n = 0;
  for (;;) {
    for (let i = 0; i < 128; i++) {
      const digits = utf8(String(n));
      const msg = new Uint8Array(prefix.length + digits.length);
      msg.set(prefix);
      msg.set(digits, prefix.length);
      if (zeroBits(powHash(msg)) >= bits) return String(n);
      n++;
    }
    if (Date.now() - started > budgetMs) return null;
    await kino.sleep(0);
  }
}

/* ---------- el reproductor Byse ---------- */

async function byse(embed, pageUrl) {
  const u = new URL(embed);
  const origin = u.origin;
  const m = u.pathname.match(/\/e\/([A-Za-z0-9._~-]+)/);
  if (!m) throw kino.error("not_found", "embed sin código");
  const api = origin + "/api/videos/" + encodeURIComponent(m[1]) + "/embed/";
  const h = {
    "X-Embed-Origin": "tubepelis.com",
    "X-Embed-Referer": pageUrl,
    "X-Embed-Parent": pageUrl,
    Referer: origin + "/",
  };

  const settings = await get(api + "settings", h);
  if (!settings.ok) throw kino.error("unavailable", "settings " + settings.status);
  const cfg = settings.json();
  const needs = cfg && cfg.captcha_required === true;

  let token = "";
  if (needs) {
    const start = await postJson(api + "captcha", h, {});
    if (!start.ok || !start.json || !start.json.pow_token) throw kino.error("rate_limited", "captcha " + start.status);
    const solution = await solve(String(start.json.pow_nonce || ""), Number(start.json.pow_difficulty || 0), 14000);
    if (solution === null) throw kino.error("rate_limited", "pow agotado");
    const check = await postJson(api + "captcha/verify", h, { pow_token: start.json.pow_token, solution });
    if (!check.ok || !check.json || check.json.status !== "ok" || !check.json.token) {
      throw kino.error("rate_limited", "verify " + (check.json && check.json.status));
    }
    token = String(check.json.token);
  }

  const hh = token ? { ...h, "X-Captcha-Token": token } : h;
  let play = await postJson(api + "playback", hh, {});
  if (!play.ok) {
    const r = await get(api + "playback", hh);
    if (r.ok) {
      play = { ok: true, json: r.json() };
    }
  }
  if (!play.ok || !play.json) throw kino.error("unavailable", "playback " + play.status);

  let body = play.json;
  if (body.playback) {
    try {
      body = JSON.parse(new TextDecoder().decode(decrypt(body.playback)));
    } catch (e) {
      throw kino.error("unavailable", "descifrado");
    }
  }
  const list = Array.isArray(body.sources) ? body.sources : [];
  const streams = list
    .filter((s) => s && typeof s.url === "string" && /^https:\/\//.test(s.url))
    .map((s) => ({ url: s.url, mime: mimeOf(s.mime_type), label: s.label || s.quality || "" }));
  if (!streams.length) throw kino.error("not_found", "sin fuentes");
  const subs = (Array.isArray(body.tracks) ? body.tracks : [])
    .filter((t) => t && typeof t.url === "string" && /^https:\/\//.test(t.url))
    .map((t) => ({ url: t.url, label: t.title || t.language || "Subtítulos", mime: "text/vtt" }));
  return { streams, subs };
}

function decrypt(pb) {
  const parts = Array.isArray(pb.key_parts) ? pb.key_parts : [];
  if (!parts.length) throw new Error("sin llave");
  let order = parts.map((_, i) => i);
  const v = Number(pb.version);
  if (v >= 1 && v <= 20) {
    const pick = [v, 31 - v].filter((n) => n >= 1 && n <= parts.length).map((n) => n - 1);
    if (pick.length) order = pick;
  }
  const chunks = order.map((i) => b64url(parts[i]));
  let total = 0;
  chunks.forEach((c) => (total += c.length));
  const key = new Uint8Array(total);
  let off = 0;
  chunks.forEach((c) => {
    key.set(c, off);
    off += c.length;
  });
  if (total !== 16 && total !== 24 && total !== 32) throw new Error("llave " + total);
  return ctrDecrypt(key, b64url(pb.iv), b64url(pb.payload));
}

/* ---------- el reproductor DoodStream ---------- */

async function dood(embed) {
  const origin = new URL(embed).origin;
  const html = await getText(embed, { Referer: origin + "/" });
  if (!html) throw kino.error("unavailable", "embed vacío");
  const m = html.match(/pass_md5\/([^'"\s]+)/);
  if (!m) throw kino.error("rate_limited", "dood con captcha");
  const r = await get(origin + "/pass_md5/" + m[1], { Referer: embed });
  if (!r.ok) throw kino.error("unavailable", "pass_md5 " + r.status);
  const base = (await r.text()).trim();
  if (!/^https:\/\//.test(base)) throw kino.error("unavailable", "base rara");
  const rand = Math.random().toString(36).slice(2, 12).padEnd(10, "x");
  const url = base + rand + "?token=" + m[1] + "&expiry=" + Date.now();
  return { streams: [{ url, mime: "video/mp4", label: "Servidor 2" }], subs: [] };
}

/* ---------- resolver ---------- */

export async function resolve(ref) {
  await null;
  const parts = String(ref || "").split("|");
  const path = parts[1];
  const want = Number(parts[2] || 0);
  if (!path) throw kino.error("not_found", "ref vacía");

  const pageUrl = BASE + path;
  const html = await getText(pageUrl, { Referer: BASE + "/" });
  if (!html) throw kino.error("not_found", "ficha " + path);

  let embeds = embedUrls(html);
  if (!embeds.length) throw kino.error("not_found", "sin reproductores");
  if (want > 0) embeds = [embeds[want - 1]].filter(Boolean);
  if (!embeds.length) throw kino.error("not_found", "opción " + want);

  const all = embedUrls(html);
  let first = null;
  const errors = [];
  for (const embed of embeds) {
    try {
      const host = new URL(embed).host;
      const got = host.indexOf("playmogo") !== -1 ? await dood(embed) : await byse(embed, pageUrl);
      if (got.streams.length) {
        first = got;
        break;
      }
    } catch (e) {
      errors.push((e && e.detail) || (e && e.message) || "fallo");
    }
  }
  if (!first) {
    const code = errors.length ? "unavailable" : "not_found";
    throw kino.error(code, "reproductores: " + errors.join(", "), {
      userMessage: T(
        "El reproductor pidió una verificación que no se pudo completar. Intenta otra vez.",
        "The player asked for a check that could not be finished. Try again."
      ),
    });
  }

  const best = first.streams[0];
  const alts = [];
  first.streams.slice(1).forEach((s, i) => alts.push({ url: s.url, mime: s.mime, label: s.label || "Copia " + (i + 2) }));
  all.forEach((embed, i) => {
    if (want > 0 && i + 1 === want) return;
    const host = new URL(embed).host;
    alts.push({ label: (host.indexOf("playmogo") !== -1 ? "Servidor " : "Opción ") + (i + 1), ref: (path.indexOf("/serie/") === 0 ? "s|" : "m|") + path + "|" + (i + 1) });
  });

  const stream = {
    url: best.url,
    mime: best.mime || undefined,
    headers: { Referer: new URL(embeds[0]).origin + "/", "User-Agent": UA },
  };
  if (alts.length) stream.alternatives = alts.slice(0, 8);
  if (first.subs.length) stream.subtitles = first.subs;
  return stream;
}