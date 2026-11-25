/* Pelistube — plugin de Kino
   Catálogo: TubePelis. Reproductores: Byse (API con prueba de trabajo) y PlayMogo. */

const SITE = "https://www.tubepelis.com";
const UA = "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const BASE_H = {
  "User-Agent": UA,
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml,*/*",
};
const PLAYER_HOSTS = ["byseqekaho.com", "playmogo.com", "n1mwq.org"];
const POW_MS = 12000;

const en = () => /^en/i.test(String(kino.lang || ""));
const tr = (es, enText) => (en() ? enText : es);

/* ---------- red ---------- */

async function req(url, opts) {
  const o = { headers: BASE_H, timeoutMs: 13000 };
  if (opts) {
    if (opts.headers) o.headers = Object.assign({}, BASE_H, opts.headers);
    if (opts.method) o.method = opts.method;
    if (opts.body) o.body = opts.body;
  }
  const r = await kino.fetch(url, o);
  return {
    ok: r.ok,
    status: r.status,
    text: () => r.text(),
    json: async () => {
      try {
        return await r.json();
      } catch (e) {
        return null;
      }
    },
  };
}

const get = (url, headers) => req(url, headers ? { headers } : null);

function postJson(url, headers, body) {
  return req(url, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, headers),
    body: JSON.stringify(body || {}),
  });
}

async function page(url, referer) {
  const r = await get(url, referer ? { Referer: referer } : null);
  if (!r.ok) {
    if (r.status === 404) {
      throw kino.error("not_found", "http 404", { userMessage: "Ese título ya no está en el sitio." });
    }
    throw kino.error("unavailable", "http " + r.status, { userMessage: "El sitio no respondió. Inténtalo más tarde." });
  }
  return r.text();
}

/* ---------- texto y rutas ---------- */

function abs(u, base) {
  if (!u) return "";
  let s = String(u).trim().replace(/&amp;/g, "&");
  if (!s || s.indexOf("data:") === 0) return "";
  if (s.indexOf("//") === 0) s = "https:" + s;
  else if (s.charAt(0) === "/") s = SITE + s;
  else if (!/^https?:/i.test(s)) {
    try {
      s = new URL(s, base || SITE).toString();
    } catch (e) {
      return "";
    }
  }
  return s.split("#")[0];
}

function stripTags(s) {
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function yearOf(s) {
  const m = String(s).match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : undefined;
}

function slugOf(path) {
  const m = String(path).match(/\/(?:pelicula|serie|episodio)\/(\d+)\/([^/?#]+?)(?:\.html?)?$/);
  if (m) return (m[1] + "-" + m[2]).replace(/[^A-Za-z0-9._~-]+/g, "-").slice(0, 100);
  return String(path).replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9._~-]+/g, "-").slice(0, 100) || "x";
}

function pathOf(url) {
  return String(url).replace(/^https?:\/\/[^/]+/i, "").split("#")[0];
}

function mimeOf(u, hint) {
  const s = String(hint || "");
  const t = String(u || "");
  if (/mpegurl|m3u8/i.test(s) || /\.m3u8(\?|$)/i.test(t)) return "application/vnd.apple.mpegurl";
  if (/dash|mpd/i.test(s) || /\.mpd(\?|$)/i.test(t)) return "application/dash+xml";
  if (/webm/i.test(s) || /\.webm(\?|$)/i.test(t)) return "video/webm";
  return "video/mp4";
}

/* ---------- tarjetas ---------- */

function cards(html, kind) {
  const out = [];
  const seen = {};
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,1200}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = abs(m[1], SITE);
    if (!url) continue;
    const p = pathOf(url);
    if (kind === "movie" && !/^\/pelicula\/\d+\//.test(p)) continue;
    if (kind === "serie" && !/^\/serie\/\d+\//.test(p)) continue;
    if (seen[p]) continue;
    const inner = m[2];
    const title = stripTags((inner.match(/(?:alt|title)="([^"]+)"/) || [])[1] || inner).slice(0, 120);
    if (!title || title.length < 2) continue;
    const poster = abs((inner.match(/(?:data-src|data-lazy-src|data-original|src)="([^"]+)"/) || [])[1] || "", SITE);
    seen[p] = 1;
    out.push({ p, title, poster: /^https?:/i.test(poster) ? poster : "", year: yearOf(title) || yearOf(inner) });
  }
  return out;
}

function uniq(list) {
  const seen = {};
  return list.filter((c) => (seen[c.p] ? false : (seen[c.p] = true)));
}

function item(c, kind, genres) {
  const it = {
    id: slugOf(c.p),
    ref: (kind === "movie" ? "mv" : "sr") + "|" + c.p,
    title: c.title,
    kind: kind === "movie" ? "movie" : "series",
    genres: genres,
  };
  if (c.poster) it.poster = c.poster;
  if (c.year) it.year = c.year;
  return it;
}

function catLinks(html) {
  const out = [];
  const re = /href="(\/categoria\/[a-z0-9-]+\/)"/gi;
  let m;
  while ((m = re.exec(html))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
  return out;
}

/* ---------- prueba de trabajo (PoW) ---------- */

const P_BASE = new Uint32Array(4);
const P_STATE = new Uint32Array(4);
const P_WORK = new Uint32Array(512);
const P_OUT = new Uint32Array(8);
const P_K1 = 2654435761;
const P_K2 = 2246822519;

function rotl(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function zeroBits(a) {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] >>> 0;
    if (v === 0) {
      n += 32;
      continue;
    }
    n += Math.clz32(v);
    break;
  }
  return n;
}

function mix(e) {
  e[0] = (e[0] + e[1]) >>> 0;
  e[3] = rotl(e[3] ^ e[0], 16);
  e[2] = (e[2] + e[3]) >>> 0;
  e[1] = rotl(e[1] ^ e[2], 12);
  e[0] = (e[0] + e[1]) >>> 0;
  e[3] = rotl(e[3] ^ e[0], 8);
  e[2] = (e[2] + e[3]) >>> 0;
  e[1] = rotl(e[1] ^ e[2], 7);
}

function powTry(digits, bits) {
  const e = P_STATE;
  const r = P_WORK;
  e[0] = P_BASE[0];
  e[1] = P_BASE[1];
  e[2] = P_BASE[2];
  e[3] = P_BASE[3];
  for (let i = 0; i < digits.length; i++) {
    e[0] = (e[0] + (digits.charCodeAt(i) & 255)) >>> 0;
    e[0] = rotl(e[0], 7);
    mix(e);
  }
  for (let i = 0; i < 8; i++) mix(e);
  for (let i = 0; i < 512; i++) {
    mix(e);
    r[i] = (e[0] ^ e[2]) >>> 0;
  }
  for (let k = 0; k < 2; k++) {
    for (let s = 0; s < 512; s++) {
      const a = r[s] & 511;
      let c = (r[s] + r[a]) >>> 0;
      c = rotl(c, 13);
      c = (c ^ Math.imul(r[(s + 1) & 511], P_K1)) >>> 0;
      r[s] = c;
      e[0] = (e[0] ^ c) >>> 0;
      mix(e);
    }
  }
  for (let i = 0; i < 8; i++) {
    mix(e);
    let s = e[0];
    const a = i * 64;
    for (let c = 0; c < 64; c++) {
      const d = r[a + c];
      s = (s + d) >>> 0;
      s = rotl(s, 5);
      s = (s ^ Math.imul(d, P_K2)) >>> 0;
    }
    P_OUT[i] = (s ^ e[2]) >>> 0;
  }
  return zeroBits(P_OUT) >= bits;
}

async function solve(nonce, bits, budgetMs) {
  if (!(bits > 0)) return "0";
  const prefix = String(nonce) + ":";
  P_BASE[0] = 1779033703;
  P_BASE[1] = 3144134277;
  P_BASE[2] = 1013904242;
  P_BASE[3] = 2773480762;
  for (let i = 0; i < prefix.length; i++) {
    P_BASE[0] = (P_BASE[0] + (prefix.charCodeAt(i) & 255)) >>> 0;
    P_BASE[0] = rotl(P_BASE[0], 7);
    P_BASE[0] = (P_BASE[0] + P_BASE[1]) >>> 0;
    P_BASE[3] = rotl(P_BASE[3] ^ P_BASE[0], 16);
    P_BASE[2] = (P_BASE[2] + P_BASE[3]) >>> 0;
    P_BASE[1] = rotl(P_BASE[1] ^ P_BASE[2], 12);
    P_BASE[0] = (P_BASE[0] + P_BASE[1]) >>> 0;
    P_BASE[3] = rotl(P_BASE[3] ^ P_BASE[0], 8);
    P_BASE[2] = (P_BASE[2] + P_BASE[3]) >>> 0;
    P_BASE[1] = rotl(P_BASE[1] ^ P_BASE[2], 7);
  }
  const started = Date.now();
  let n = 0;
  for (;;) {
    for (let i = 0; i < 4096; i++) {
      if (powTry(String(n), bits)) return String(n);
      n++;
    }
    if (Date.now() - started > budgetMs) return null;
    await kino.sleep(0);
  }
}

/* ---------- descifrado ---------- */

function b64url(s) {
  let t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function decrypt(pb) {
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
  if (typeof kino.crypto.decrypt !== "function") throw new Error("sin crypto");
  const pt = await kino.crypto.decrypt({
    alg: "AES-CTR",
    key: key,
    iv: b64url(pb.iv),
    data: b64url(pb.payload),
    outputEncoding: "bytes",
  });
  return new TextDecoder().decode(pt);
}

/* ---------- reproductor Byse ---------- */

function parseEmbed(embed) {
  const u = new URL(embed);
  const m = u.pathname.match(/\/e\/([A-Za-z0-9._~-]+)/);
  const seg = u.pathname.split("/").filter(Boolean);
  return { origin: u.origin, code: m ? m[1] : seg[seg.length - 1] || "" };
}

function fingerprint() {
  try {
    const v = kino.storage.get("fp");
    if (typeof v === "string" && v.length >= 16) return v;
  } catch (e) {
    /* sin almacenamiento */
  }
  const abc = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) s += abc[Math.floor(Math.random() * 16)];
  try {
    kino.storage.set("fp", s);
  } catch (e) {
    /* no se pudo guardar */
  }
  return s;
}

function sourcesFrom(b) {
  const list = b && Array.isArray(b.sources) ? b.sources : [];
  return list
    .filter((s) => s && typeof s.url === "string" && /^https:\/\//.test(s.url))
    .map((s) => ({ url: s.url, mime: mimeOf(s.url, s.mime_type), label: s.label || s.quality || "" }));
}

function savedToken(code) {
  try {
    const v = kino.storage.get("tk:" + code);
    return typeof v === "string" ? v : "";
  } catch (e) {
    return "";
  }
}

function saveToken(code, token, ttl) {
  const secs = ttl > 0 ? ttl : 3600;
  const ms = Math.max(60000, Math.min(secs * 1000, 86400000));
  try {
    kino.storage.set("tk:" + code, token, { ttlMs: ms });
  } catch (e) {
    /* sin almacenamiento */
  }
}

async function routes(origin, code, h, fp) {
  const base = origin + "/api/videos/" + encodeURIComponent(code) + "/";
  const cands = [
    ["epb", "embed/playback"],
    ["epb/", "embed/playback/"],
    ["pb", "playback"],
    ["pb/", "playback/"],
    ["est", "embed/stream"],
    ["st", "stream"],
    ["edt", "embed/details"],
    ["dt", "details"],
  ];
  const out = [];
  for (const [label, path] of cands) {
    let st = 0;
    try {
      const r = await postJson(base + path, h, { fingerprint: fp });
      st = r.status;
    } catch (e) {
      st = 0;
    }
    out.push(label + ":" + st);
  }
  return out.join(" ");
}

async function byse(embed, pageUrl) {
  const parsed = parseEmbed(embed);
  const origin = parsed.origin;
  const code = parsed.code;
  if (!code) throw kino.error("not_found", "embed sin código");
  const api = origin + "/api/videos/" + encodeURIComponent(code) + "/";
  const fp = fingerprint();
  const h = {
    "X-Embed-Origin": "tubepelis.com",
    "X-Embed-Referer": pageUrl,
    "X-Embed-Parent": embed,
    Origin: origin,
    Referer: embed,
    "X-Requested-With": "XMLHttpRequest",
  };

  const settings = await get(api + "embed/settings", h);
  if (!settings.ok) throw kino.error("unavailable", "settings " + settings.status);

  const det = await get(api + "embed/details", h);
  if (det.ok) {
    const j = await det.json();
    const direct = sourcesFrom(j);
    if (direct.length) return { streams: direct, subs: [], origin: origin, embed: embed };
  }

  let token = savedToken(code);
  let play = null;
  if (token) {
    play = await postJson(api + "embed/playback", Object.assign({}, h, { "X-Captcha-Token": token }), { fingerprint: fp });
    if (play.status === 401 || play.status === 403) token = "";
  }

  if (!token) {
    const start = await postJson(api + "embed/captcha", h, { fingerprint: fp });
    const sj = start.ok ? await start.json() : null;
    if (!sj || !sj.pow_token) throw kino.error("rate_limited", "captcha " + start.status);
    const solution = await solve(String(sj.pow_nonce || ""), Number(sj.pow_difficulty || 0), POW_MS);
    if (solution === null) throw kino.error("rate_limited", "pow agotado");
    const check = await postJson(api + "embed/captcha/verify", h, {
      pow_token: sj.pow_token,
      solution: solution,
      fingerprint: fp,
    });
    const cj = check.ok ? await check.json() : null;
    if (!cj || cj.status !== "ok" || !cj.token) throw kino.error("rate_limited", "verify " + (cj && cj.status));
    token = String(cj.token);
    saveToken(code, token, Number(cj.expires_in || 0));
    play = await postJson(api + "embed/playback", Object.assign({}, h, { "X-Captcha-Token": token }), { fingerprint: fp });
  }

  if (!play || !play.ok) {
    const map = await routes(origin, code, h, fp);
    throw kino.error("unavailable", ("pb " + (play ? play.status : 0) + " " + map).slice(0, 180));
  }

  let body = await play.json();
  if (!body) throw kino.error("unavailable", "respuesta vacía");
  if (body.playback) {
    try {
      body = JSON.parse(await decrypt(body.playback));
    } catch (e) {
      throw kino.error("unavailable", "descifrado " + (e && e.message ? e.message : ""));
    }
  }
  const streams = sourcesFrom(body);
  if (!streams.length) throw kino.error("not_found", "sin fuentes");
  const subs = (Array.isArray(body.tracks) ? body.tracks : [])
    .filter((t) => t && typeof t.url === "string" && /^https:\/\//.test(t.url))
    .map((t) => ({ url: t.url, label: t.title || t.language || "Subtítulos", mime: "text/vtt" }));
  return { streams: streams, subs: subs, origin: origin, embed: embed };
}

/* ---------- reproductores genéricos ---------- */

function findMedia(body, base) {
  const pats = [
    /https?:(?:\\\/|\/){2}[^"'\\\s]+?\.m3u8[^"'\\\s]*/gi,
    /https?:(?:\\\/|\/){2}[^"'\\\s]+?\.mp4[^"'\\\s]*/gi,
  ];
  for (const re of pats) {
    const m = body.match(re);
    if (m && m.length) {
      const clean = m[0].replace(/\\\//g, "/");
      const u = abs(clean, base);
      if (u) return u;
    }
  }
  const file = body.match(/["'](?:file|src|url)["']\s*:\s*["']([^"']+)["']/i);
  if (file) {
    const u = abs(file[1].replace(/\\\//g, "/"), base);
    if (u && /\.(m3u8|mp4)(\?|$)/i.test(u)) return u;
  }
  const at = body.match(/atob\(\s*["']([A-Za-z0-9+/=]{20,})["']\s*\)/);
  if (at) {
    try {
      const u = abs(atob(at[1]), base);
      if (u && /^https?:/i.test(u)) return u;
    } catch (e) {
      /* base64 inválido */
    }
  }
  return "";
}

async function generic(embed, pageUrl) {
  const r = await get(embed, { Referer: pageUrl });
  if (!r.ok) throw kino.error("unavailable", "embed " + r.status);
  const body = await r.text();
  const hit = findMedia(body, embed);
  if (!hit) throw kino.error("not_found", "sin media");
  const host = new URL(embed).hostname;
  return {
    streams: [{ url: hit, mime: mimeOf(hit), label: "" }],
    subs: [],
    origin: "https://" + host,
    embed: embed,
  };
}

/* ---------- salidas ---------- */

async function play(embed, pageUrl) {
  if (/byseqekaho\./.test(embed)) return await byse(embed, pageUrl);
  return await generic(embed, pageUrl);
}

function labelOf(url) {
  const h = String(url).replace(/^https?:\/\//, "").split("/")[0];
  if (/byseqekaho/.test(h)) return "Byse";
  if (/playmogo/.test(h)) return "PlayMogo";
  return h.slice(0, 48);
}

function embeds(html, pageUrl) {
  const out = [];
  const add = (u) => {
    const a = abs(u, pageUrl);
    if (!a) return;
    if (!PLAYER_HOSTS.some((h) => a.indexOf("//" + h) > -1 || a.indexOf("." + h + "/") > -1)) return;
    if (out.indexOf(a) < 0) out.push(a);
  };
  const re = /(?:src|data-src|data-player|data-video|data-url|data-link|href)="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) add(m[1]);
  const re2 = /https?:(?:\\\/|\/){2}[^"'\\\s]*(?:byseqekaho|playmogo|n1mwq)\.com[^"'\\\s]*/gi;
  while ((m = re2.exec(html))) add(m[0].replace(/\\\//g, "/"));
  return out;
}

/* ---------- capacidades ---------- */

export async function home() {
  const html = await page(SITE + "/");
  const rows = [];
  const mv = uniq(cards(html, "movie")).slice(0, 30);
  const sr = uniq(cards(html, "serie")).slice(0, 30);
  if (mv.length) {
    rows.push({
      id: "estrenos",
      title: tr("Estrenos", "New releases"),
      genre: "peliculas",
      ref: "ct|/|1",
      items: mv.map((c) => item(c, "movie", ["peliculas"])),
    });
  }
  if (sr.length) {
    rows.push({
      id: "series",
      title: tr("Series", "Series"),
      genre: "series",
      ref: "ct|/|1",
      items: sr.map((c) => item(c, "series", ["series"])),
    });
  }
  for (const c of catLinks(html).slice(0, 3)) {
    const slug = c.replace(/\/categoria\//, "").replace(/\//g, "");
    const r = await get(SITE + c);
    if (!r.ok) continue;
    const sub = uniq(cards(await r.text(), "movie")).slice(0, 30);
    if (!sub.length) continue;
    rows.push({
      id: "cat-" + slug,
      title: slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " "),
      genre: slug,
      ref: "ct|" + c + "|1",
      items: sub.map((x) => item(x, "movie", [slug])),
    });
  }
  return rows.slice(0, 20);
}

export async function search(query) {
  const q = typeof query === "string" ? query : (query && query.query) || "";
  const term = String(q).trim().slice(0, 120);
  if (!term) return [];
  for (const p of ["/buscar/?q=", "/buscar?q=", "/?s="]) {
    const r = await get(SITE + p + encodeURIComponent(term));
    if (!r.ok) continue;
    const html = await r.text();
    const items = [];
    uniq(cards(html, "movie")).slice(0, 40).forEach((c) => items.push(item(c, "movie", ["peliculas"])));
    uniq(cards(html, "serie")).slice(0, 40).forEach((c) => items.push(item(c, "series", ["series"])));
    if (items.length) return items.slice(0, 100);
  }
  return [];
}

export async function browse(ref) {
  const parts = String(ref || "").split("|");
  const path = parts[1] || "/";
  const n = Math.max(1, Number(parts[2]) || 1);
  const base = path === "/" ? "" : path.replace(/\/$/, "");
  const url = SITE + (n > 1 ? base + "/page/" + n + "/" : base + "/");
  const html = await page(url);
  const items = [];
  uniq(cards(html, "movie")).slice(0, 50).forEach((c) => items.push(item(c, "movie", [])));
  uniq(cards(html, "serie")).slice(0, 50).forEach((c) => items.push(item(c, "series", [])));
  const out = { items: items.slice(0, 100) };
  if (items.length >= 10) out.next = "ct|" + path + "|" + (n + 1);
  return out;
}

export async function episodes(ref) {
  const path = String(ref || "").split("|")[1] || "";
  if (!path) throw kino.error("not_found", "sin ref");
  const html = await page(SITE + path);
  const out = [];
  const seen = {};
  const re = /<a\b[^>]*href="([^"]*\/episodio\/[^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/gi;
  let m;
  let n = 0;
  while ((m = re.exec(html))) {
    const u = abs(m[1], SITE);
    if (!u) continue;
    const p = pathOf(u);
    if (seen[p]) continue;
    seen[p] = 1;
    n++;
    const label = stripTags(m[2]).slice(0, 90);
    const se = seasonEp(label) || seasonEp(p);
    const ep = {
      id: slugOf(p),
      ref: "ep|" + p,
      title: label || tr("Capítulo ", "Episode ") + n,
      kind: "episode",
      number: se ? se.ep : n,
    };
    if (se) ep.season = se.se;
    out.push(ep);
  }
  if (!out.length) throw kino.error("not_found", "sin episodios", { userMessage: "Esta serie no tiene capítulos publicados." });
  return { items: out.slice(0, 2000) };
}

function seasonEp(s) {
  let m = String(s).match(/t\s*(\d{1,2})\s*e\s*(\d{1,3})/i);
  if (!m) m = String(s).match(/\b(\d{1,2})x(\d{1,3})\b/);
  if (!m) m = String(s).match(/temporada\s*(\d{1,2})[^\d]{1,20}(\d{1,3})/i);
  if (!m) return null;
  return { se: Number(m[1]), ep: Number(m[2]) };
}

export async function resolve(ref) {
  const parts = String(ref || "").split("|");
  const kind = parts[0];
  const path = parts[1] || "";
  const pick = Number(parts[2] || 0);
  if (!path) throw kino.error("not_found", "sin ref");
  const pageUrl = SITE + path;
  const html = await page(pageUrl);
  const list = embeds(html, pageUrl);
  if (!list.length) throw kino.error("not_found", "sin reproductor", { userMessage: "Este título no tiene reproductor disponible." });

  const order = [];
  for (let i = 0; i < list.length; i++) order.push((pick + i) % list.length);
  let last = null;
  for (const i of order) {
    try {
      const got = await play(list[i], pageUrl);
      const alts = [];
      got.streams.slice(1, 4).forEach((s) => alts.push({ url: s.url, mime: s.mime, label: s.label || s.mime }));
      list.forEach((u, j) => {
        if (j !== i && alts.length < 8) alts.push({ label: labelOf(u), ref: kind + "|" + path + "|" + j });
      });
      const first = got.streams[0];
      const stream = { url: first.url, mime: first.mime };
      if (got.origin && got.origin !== "null") {
        stream.headers = { Referer: got.embed, Origin: got.origin };
      }
      if (got.subs.length) stream.subtitles = got.subs;
      if (alts.length) stream.alternatives = alts;
      return stream;
    } catch (e) {
      last = e;
    }
  }
  throw last || kino.error("unavailable", "ningún reproductor respondió", { userMessage: "Ningún reproductor respondió. Prueba más tarde." });
}