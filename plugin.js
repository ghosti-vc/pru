/* Pelistube — plugin de Kino
   Catálogo: TubePelis. Reproductores: Byse (API con prueba de trabajo) y Doodstream. */

const SITE = "https://www.tubepelis.com";
const UA = "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const BASE_H = {
  "User-Agent": UA,
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml,*/*",
};
const KNOWN = [
  "byseqekaho.com",
  "playmogo.com",
  "n1mwq.org",
  "dood.xxx",
  "dood.watch",
  "doodstream.com",
  "dood.so",
  "dood.la",
  "dood.pm",
  "dsvplay.com",
  "voe.sx",
  "filemoon.sx",
  "streamtape.com",
  "mixdrop.co",
];
const POW_MS = 12000;

const isEn = () => /^en/i.test(String(kino.lang || ""));
const tr = (es, enText) => (isEn() ? enText : es);

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

function postForm(url, headers, body) {
  return req(url, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, headers),
    body: body,
  });
}

async function page(url, referer) {
  const r = await get(url, referer ? { Referer: referer } : null);
  if (!r.ok) {
    if (r.status === 404) throw kino.error("not_found", "http 404", { userMessage: "Ese título ya no está en el sitio." });
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

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
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

/* ---------- prueba de trabajo (PoW), versión rápida ---------- */

const P_BASE = new Uint32Array(4);
const P_WORK = new Uint32Array(512);
const P_K1 = 2654435761;
const P_K2 = 2246822519;

function mixAll(st) {
  st[0] = (st[0] + st[1]) >>> 0;
  st[3] = ((st[3] ^ st[0]) << 16) | ((st[3] ^ st[0]) >>> 16);
  st[2] = (st[2] + st[3]) >>> 0;
  st[1] = ((st[1] ^ st[2]) << 12) | ((st[1] ^ st[2]) >>> 20);
  st[0] = (st[0] + st[1]) >>> 0;
  st[3] = ((st[3] ^ st[0]) << 8) | ((st[3] ^ st[0]) >>> 24);
  st[2] = (st[2] + st[3]) >>> 0;
  st[1] = ((st[1] ^ st[2]) << 7) | ((st[1] ^ st[2]) >>> 25);
  st[3] >>>= 0;
  st[1] >>>= 0;
}

function powTry(digits, bits) {
  const st = P_WORK.subarray(0, 4);
  const r = P_WORK;
  st[0] = P_BASE[0];
  st[1] = P_BASE[1];
  st[2] = P_BASE[2];
  st[3] = P_BASE[3];
  for (let i = 0; i < digits.length; i++) {
    st[0] = (st[0] + (digits.charCodeAt(i) & 255)) >>> 0;
    st[0] = ((st[0] << 7) | (st[0] >>> 25)) >>> 0;
    mixAll(st);
  }
  for (let i = 0; i < 8; i++) mixAll(st);
  for (let i = 4; i < 516; i++) {
    mixAll(st);
    r[i] = (st[0] ^ st[2]) >>> 0;
  }
  for (let k = 0; k < 2; k++) {
    for (let s = 4; s < 516; s++) {
      const a = 4 + (r[s] & 511);
      let c = (r[s] + r[a]) >>> 0;
      c = ((c << 13) | (c >>> 19)) >>> 0;
      c = (c ^ Math.imul(r[s + 1 > 515 ? 4 : s + 1], P_K1)) >>> 0;
      r[s] = c;
      st[0] = (st[0] ^ c) >>> 0;
      mixAll(st);
    }
  }
  let zeros = 0;
  for (let i = 0; i < 8 && zeros < bits; i++) {
    mixAll(st);
    let s = st[0];
    const a = 4 + i * 64;
    for (let c = 0; c < 64; c++) {
      const d = r[a + c];
      s = (s + d) >>> 0;
      s = ((s << 5) | (s >>> 27)) >>> 0;
      s = (s ^ Math.imul(d, P_K2)) >>> 0;
    }
    const o = (s ^ st[2]) >>> 0;
    if (o === 0) zeros += 32;
    else {
      zeros += Math.clz32(o);
      break;
    }
  }
  return zeros >= bits;
}

async function solve(nonce, bits, budgetMs, startAt) {
  if (!(bits > 0)) return { solution: "0" };
  const prefix = String(nonce) + ":";
  P_BASE[0] = 1779033703;
  P_BASE[1] = 3144134277;
  P_BASE[2] = 1013904242;
  P_BASE[3] = 2773480762;
  for (let i = 0; i < prefix.length; i++) {
    P_BASE[0] = (P_BASE[0] + (prefix.charCodeAt(i) & 255)) >>> 0;
    P_BASE[0] = ((P_BASE[0] << 7) | (P_BASE[0] >>> 25)) >>> 0;
    P_BASE[0] = (P_BASE[0] + P_BASE[1]) >>> 0;
    P_BASE[3] = ((P_BASE[3] ^ P_BASE[0]) << 16) | ((P_BASE[3] ^ P_BASE[0]) >>> 16);
    P_BASE[2] = (P_BASE[2] + P_BASE[3]) >>> 0;
    P_BASE[1] = ((P_BASE[1] ^ P_BASE[2]) << 12) | ((P_BASE[1] ^ P_BASE[2]) >>> 20);
    P_BASE[0] = (P_BASE[0] + P_BASE[1]) >>> 0;
    P_BASE[3] = ((P_BASE[3] ^ P_BASE[0]) << 8) | ((P_BASE[3] ^ P_BASE[0]) >>> 24);
    P_BASE[2] = (P_BASE[2] + P_BASE[3]) >>> 0;
    P_BASE[1] = ((P_BASE[1] ^ P_BASE[2]) << 7) | ((P_BASE[1] ^ P_BASE[2]) >>> 25);
    P_BASE[3] >>>= 0;
    P_BASE[1] >>>= 0;
  }
  const started = Date.now();
  let n = startAt > 0 ? startAt : 0;
  for (;;) {
    for (let i = 0; i < 2048; i++) {
      if (powTry(String(n), bits)) return { solution: String(n) };
      n++;
    }
    if (Date.now() - started > budgetMs) return { next: n };
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

/* ---------- estado del PoW ---------- */

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

function powState(code) {
  try {
    const v = kino.storage.get("pw:" + code);
    if (typeof v !== "string") return null;
    const p = v.split("|");
    return { t: p[0], n: Number(p[1]) || 0 };
  } catch (e) {
    return null;
  }
}

function savePow(code, token, n) {
  try {
    kino.storage.set("pw:" + code, token + "|" + n, { ttlMs: 3600000 });
  } catch (e) {
    /* sin almacenamiento */
  }
}

function clearPow(code) {
  try {
    kino.storage.remove("pw:" + code);
  } catch (e) {
    /* nada */
  }
}

/* ---------- reproductor Byse ---------- */

function parseEmbed(embed) {
  const u = new URL(embed);
  const m = u.pathname.match(/\/e\/([A-Za-z0-9._~-]+)/);
  const seg = u.pathname.split("/").filter(Boolean);
  return { origin: u.origin, code: m ? m[1] : seg[seg.length - 1] || "" };
}

function sourcesFrom(b) {
  const list = b && Array.isArray(b.sources) ? b.sources : [];
  return list
    .filter((s) => s && typeof s.url === "string" && /^https:\/\//.test(s.url))
    .map((s) => ({ url: s.url, mime: mimeOf(s.url, s.mime_type), label: s.label || s.quality || "" }));
}

function byseHeaders(origin, embed, pageUrl) {
  return {
    "X-Embed-Origin": "tubepelis.com",
    "X-Embed-Referer": pageUrl,
    "X-Embed-Parent": embed,
    Origin: origin,
    Referer: embed,
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json",
  };
}

async function playback(api, h, fp, token) {
  const hh = Object.assign({}, h);
  if (token) hh["X-Captcha-Token"] = token;
  const q = "?fingerprint=" + encodeURIComponent(fp);
  let r = await get(api + "embed/playback" + q, hh);
  if (r.ok) return r;
  let last = r;
  r = await postJson(api + "embed/playback", hh, { fingerprint: fp });
  if (r.ok) return r;
  if (r.status !== 405) last = r;
  r = await postForm(api + "embed/playback", hh, "fingerprint=" + encodeURIComponent(fp));
  if (r.ok) return r;
  if (r.status !== 405) last = r;
  r = await get(api + "embed/playback/" + encodeURIComponent(fp), hh);
  if (r.ok) return r;
  return last;
}

async function captcha(api, h, fp, code) {
  let start = await postJson(api + "embed/captcha", h, { fingerprint: fp });
  let sj = start.ok ? await start.json() : null;
  if (!sj || !sj.pow_token) {
    const g = await get(api + "embed/captcha?fingerprint=" + encodeURIComponent(fp), h);
    sj = g.ok ? await g.json() : null;
    if (!sj || !sj.pow_token) start = g;
  }
  if (!sj || !sj.pow_token) throw kino.error("rate_limited", "captcha " + start.status);
  const tok = String(sj.pow_token);
  const st = powState(code);
  const from = st && st.t === tok ? st.n : 0;
  const res = await solve(String(sj.pow_nonce || ""), Number(sj.pow_difficulty || 0), POW_MS, from);
  if (!res.solution) {
    savePow(code, tok, res.next || 0);
    throw kino.error("rate_limited", "pow agotado");
  }
  const check = await postJson(api + "embed/captcha/verify", h, {
    pow_token: tok,
    solution: res.solution,
    fingerprint: fp,
  });
  const cj = check.ok ? await check.json() : null;
  if (!cj || cj.status !== "ok" || !cj.token) throw kino.error("rate_limited", "verify " + (cj && cj.status));
  const t = String(cj.token);
  saveToken(code, t, Number(cj.expires_in || 0));
  clearPow(code);
  return t;
}

async function byse(embed, pageUrl) {
  const parsed = parseEmbed(embed);
  const origin = parsed.origin;
  const code = parsed.code;
  if (!code) throw kino.error("not_found", "embed sin código");
  const api = origin + "/api/videos/" + encodeURIComponent(code) + "/";
  const fp = fingerprint();
  const h = byseHeaders(origin, embed, pageUrl);

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
    play = await playback(api, h, fp, token);
    if (play.status === 401 || play.status === 403) token = "";
  }
  if (!token) {
    token = await captcha(api, h, fp, code);
    play = await playback(api, h, fp, token);
  }
  if (!play || !play.ok) throw kino.error("unavailable", "playback " + (play ? play.status : 0));

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

/* ---------- reproductor Doodstream ---------- */

async function dood(embed, pageUrl) {
  const origin = new URL(embed).origin;
  const r = await get(embed, { Referer: pageUrl });
  if (!r.ok) throw kino.error("unavailable", "dood " + r.status);
  const html = await r.text();
  const m = html.match(/\/pass_md5\/([^"'\s<>]+)/);
  if (!m) throw kino.error("not_found", "dood sin pass");
  const pr = await get(origin + "/pass_md5/" + m[1], { Referer: embed });
  if (!pr.ok) throw kino.error("unavailable", "pass " + pr.status);
  const data = (await pr.text()).trim();
  if (!/^https?:/i.test(data)) throw kino.error("not_found", "pass raro");
  const token = data.substring(data.lastIndexOf("/") + 1);
  const abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let rnd = "";
  for (let i = 0; i < 10; i++) rnd += abc.charAt(Math.floor(Math.random() * abc.length));
  const url = data + rnd + "?token=" + token + "&expiry=" + Date.now();
  return { streams: [{ url: url, mime: "video/mp4", label: "" }], subs: [], origin: origin, embed: embed };
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
      const u = abs(m[0].replace(/\\\//g, "/"), base);
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
  const hit = findMedia(await r.text(), embed);
  if (!hit) throw kino.error("not_found", "sin media");
  return { streams: [{ url: hit, mime: mimeOf(hit), label: "" }], subs: [], origin: new URL(embed).origin, embed: embed };
}

async function play(embed, pageUrl) {
  const h = hostOf(embed);
  if (/dood|dsvplay/.test(h)) return await dood(embed, pageUrl);
  if (/byseqekaho|playmogo|n1mwq/.test(h)) {
    try {
      return await byse(embed, pageUrl);
    } catch (e) {
      return await generic(embed, pageUrl);
    }
  }
  return await generic(embed, pageUrl);
}

function labelOf(url) {
  const h = hostOf(url);
  if (/byseqekaho/.test(h)) return "Byse";
  if (/dood|dsvplay/.test(h)) return "Dood";
  if (/playmogo/.test(h)) return "PlayMogo";
  return h.slice(0, 48);
}

function embeds(html, pageUrl) {
  const out = [];
  const unknown = [];
  const add = (u) => {
    const a = abs(u, pageUrl);
    if (!a || !/^https:/i.test(a)) return;
    if (/\.(jpg|jpeg|png|webp|gif|css|js)(\?|$)/i.test(a)) return;
    if (out.indexOf(a) > -1 || unknown.indexOf(a) > -1) return;
    const host = hostOf(a);
    if (!host) return;
    if (KNOWN.some((k) => host === k || host.slice(-k.length - 1) === "." + k)) out.push(a);
    else if (/\/(e|v|embed|d|player)\/[A-Za-z0-9._~-]{4,}/.test(a)) unknown.push(a);
  };
  const re = /(?:src|data-src|data-player|data-video|data-url|data-link|data-code|href)="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) add(m[1]);
  const re2 = /https?:(?:\\\/|\/){2}[^"'\\\s]*(?:byseqekaho|playmogo|n1mwq|dood|dsvplay)[^"'\\\s]*/gi;
  while ((m = re2.exec(html))) add(m[0].replace(/\\\//g, "/"));
  return out.concat(unknown.slice(0, 2));
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
  if (!list.length) {
    const n = (html.match(/<iframe/gi) || []).length;
    throw kino.error("not_found", "sin reproductor (iframes " + n + ")", {
      userMessage: "Este título no tiene reproductor disponible.",
    });
  }

  const order = [];
  for (let i = 0; i < list.length; i++) order.push((pick + i) % list.length);
  const fails = [];
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
      if (got.origin && got.origin !== "null") stream.headers = { Referer: got.embed, Origin: got.origin };
      if (got.subs.length) stream.subtitles = got.subs;
      if (alts.length) stream.alternatives = alts;
      return stream;
    } catch (e) {
      fails.push(labelOf(list[i]) + ": " + (e && e.message ? e.message : "error"));
    }
  }
  throw kino.error("unavailable", ("reproductores: " + fails.join(", ")).slice(0, 190), {
    userMessage: "Ningún reproductor respondió. Prueba más tarde.",
  });
}

export async function prepare(ref) {
  try {
    const path = String(ref || "").split("|")[1] || "";
    if (!path) return;
    const pageUrl = SITE + path;
    const list = embeds(await page(pageUrl), pageUrl);
    const first = list.filter((u) => /byseqekaho|playmogo|n1mwq/.test(u))[0];
    if (!first) return;
    const parsed = parseEmbed(first);
    if (!parsed.code) return;
    const api = parsed.origin + "/api/videos/" + encodeURIComponent(parsed.code) + "/";
    const fp = fingerprint();
    const h = byseHeaders(parsed.origin, first, pageUrl);
    if (savedToken(parsed.code)) return;
    await captcha(api, h, fp, parsed.code);
  } catch (e) {
    /* prepare nunca falla */
  }
}