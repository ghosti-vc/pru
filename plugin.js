/* Pelistube — plugin de Kino
   Catálogo: TubePelis. Reproductores: reproductor.php?v=<base64> → Byse / PlayMogo.
   La API y los métodos se descubren en el JavaScript del propio reproductor. */

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
const DENY = [
  "googleapis.com",
  "gstatic.com",
  "jsdelivr.net",
  "jquery.com",
  "youtube.com",
  "ytimg.com",
  "googletagmanager.com",
  "google-analytics.com",
  "facebook.net",
  "bootstrapcdn.com",
  "unpkg.com",
  "cloudflare.com",
  "image.tmdb.org",
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
  if (!s || s.indexOf("data:") === 0 || s.charAt(0) === "#") return "";
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

function snippet(html, word, n) {
  const s = String(html);
  const i = s.toLowerCase().indexOf(String(word).toLowerCase());
  if (i < 0) return "-" + word;
  let out = s.slice(Math.max(0, i - n), i + n);
  out = out.replace(/[\r\n\t]+/g, " ").replace(/["']/g, "").replace(/\s+/g, " ").trim();
  return out;
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
    return new URL(url).hostname.toLowerCase();
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

/* ---------- prueba de trabajo (PoW) ---------- */

const P_BASE = new Uint32Array(4);
const P_WORK = new Uint32Array(516);
const P_K1 = 2654435761;
const P_K2 = 2246822519;

function mixAll(st) {
  st[0] = (st[0] + st[1]) >>> 0;
  st[3] = (((st[3] ^ st[0]) << 16) | ((st[3] ^ st[0]) >>> 16)) >>> 0;
  st[2] = (st[2] + st[3]) >>> 0;
  st[1] = (((st[1] ^ st[2]) << 12) | ((st[1] ^ st[2]) >>> 20)) >>> 0;
  st[0] = (st[0] + st[1]) >>> 0;
  st[3] = (((st[3] ^ st[0]) << 8) | ((st[3] ^ st[0]) >>> 24)) >>> 0;
  st[2] = (st[2] + st[3]) >>> 0;
  st[1] = (((st[1] ^ st[2]) << 7) | ((st[1] ^ st[2]) >>> 25)) >>> 0;
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
    P_BASE[3] = (((P_BASE[3] ^ P_BASE[0]) << 16) | ((P_BASE[3] ^ P_BASE[0]) >>> 16)) >>> 0;
    P_BASE[2] = (P_BASE[2] + P_BASE[3]) >>> 0;
    P_BASE[1] = (((P_BASE[1] ^ P_BASE[2]) << 12) | ((P_BASE[1] ^ P_BASE[2]) >>> 20)) >>> 0;
    P_BASE[0] = (P_BASE[0] + P_BASE[1]) >>> 0;
    P_BASE[3] = (((P_BASE[3] ^ P_BASE[0]) << 8) | ((P_BASE[3] ^ P_BASE[0]) >>> 24)) >>> 0;
    P_BASE[2] = (P_BASE[2] + P_BASE[3]) >>> 0;
    P_BASE[1] = (((P_BASE[1] ^ P_BASE[2]) << 7) | ((P_BASE[1] ^ P_BASE[2]) >>> 25)) >>> 0;
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

/* ---------- estado ---------- */

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

/* ---------- Byse ---------- */

function parseEmbed(embed) {
  const u = new URL(embed);
  const m = u.pathname.match(/\/e\/([A-Za-z0-9._~-]+)/);
  const seg = u.pathname.split("/").filter(Boolean);
  return { origin: u.origin, code: m ? m[1] : seg[seg.length - 1] || "" };
}

function parentUrl(embed) {
  try {
    const b = btoa(embed);
    const pad = (b.match(/=+$/) || [""])[0].length;
    const core = b.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    return SITE + "/reproductor.php?v=" + core + "%3D".repeat(pad);
  } catch (e) {
    return SITE + "/";
  }
}

function byseHeaders(origin, embed, pageUrl, parent) {
  const p = parent || parentUrl(embed);
  return {
    "X-Embed-Origin": "tubepelis.com",
    "X-Embed-Referer": pageUrl,
    "X-Embed-Parent": p,
    Origin: origin,
    Referer: p,
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json",
  };
}

function sourcesFrom(b) {
  const list = b && Array.isArray(b.sources) ? b.sources : [];
  return list
    .filter((s) => s && typeof s.url === "string" && /^https:\/\//.test(s.url))
    .map((s) => ({ url: s.url, mime: mimeOf(s.url, s.mime_type), label: s.label || s.quality || "" }));
}

function subsFrom(b) {
  return (b && Array.isArray(b.tracks) ? b.tracks : [])
    .filter((t) => t && typeof t.url === "string" && /^https:\/\//.test(t.url))
    .map((t) => ({ url: t.url, label: t.title || t.language || "Subtítulos", mime: "text/vtt" }));
}

async function unpack(j) {
  if (!j) return { streams: [], subs: [], keys: [] };
  let body = j;
  if (body.playback) {
    try {
      body = JSON.parse(await decrypt(body.playback));
    } catch (e) {
      return { streams: [], subs: [], keys: ["playback!"], err: e && e.message ? e.message : "descifrado" };
    }
  }
  return { streams: sourcesFrom(body), subs: subsFrom(body), keys: Object.keys(body || {}) };
}

function apiFrom(html, origin, code) {
  const abs1 = html.match(/https?:\/\/[a-z0-9.-]+\/api\/videos\/([A-Za-z0-9._~-]+)/i);
  if (abs1) return { base: abs1[0].slice(0, abs1[0].indexOf("/api/videos/") + 12), id: abs1[1] };
  const rel = html.match(/["']\/api\/videos\/([A-Za-z0-9._~-]+)/);
  if (rel) return { base: origin + "/api/videos/", id: rel[1] };
  return { base: origin + "/api/videos/", id: code };
}

function methodsOf(html) {
  const out = [];
  const re = /method\s*:\s*["'](GET|POST|PUT)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const v = m[1].toUpperCase();
    if (out.indexOf(v) < 0) out.push(v);
  }
  return out;
}

async function call(url, methods, h, fp, token, body) {
  const hh = Object.assign({}, h);
  if (token) hh["X-Captcha-Token"] = token;
  const list = methods.length ? methods : ["GET", "POST"];
  const q = "?fingerprint=" + encodeURIComponent(fp);
  let best = null;
  for (const m of list) {
    let r;
    if (m === "GET") r = await get(url + q, hh);
    else if (m === "PUT") r = await req(url, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, hh), body: JSON.stringify(body || { fingerprint: fp }) });
    else r = await postJson(url, hh, body || { fingerprint: fp });
    if (r.ok) return r;
    if (!best || best.status === 405) best = r;
  }
  return best;
}

async function captcha(url, methods, h, fp, code, html) {
  let start = await call(url + "embed/captcha", methods, h, fp, "");
  let sj = start && start.ok ? await start.json() : null;
  if (!sj || !sj.pow_token) {
    const rich = { fingerprint: fp, code: code, origin: "tubepelis.com", parent: h["X-Embed-Parent"], referer: h["X-Embed-Referer"] };
    const r2 = await postJson(url + "embed/captcha", h, rich);
    sj = r2.ok ? await r2.json() : null;
    if (!sj || !sj.pow_token) {
      throw kino.error("rate_limited", ("captcha " + (start ? start.status : 0) + "/" + r2.status + " [" + snippet(html, "captcha", 70) + "] " + snippet(html, "fingerprint", 40)).slice(0, 190));
    }
  }
  const tok = String(sj.pow_token);
  const st = powState(code);
  const from = st && st.t === tok ? st.n : 0;
  const res = await solve(String(sj.pow_nonce || ""), Number(sj.pow_difficulty || 0), POW_MS, from);
  if (!res.solution) {
    savePow(code, tok, res.next || 0);
    throw kino.error("rate_limited", "pow agotado " + res.next);
  }
  const payload = { pow_token: tok, solution: res.solution, fingerprint: fp, code: code };
  const check = await call(url + "embed/captcha/verify", methods, h, fp, "", payload);
  const cj = check && check.ok ? await check.json() : null;
  if (!cj || cj.status !== "ok" || !cj.token) throw kino.error("rate_limited", "verify " + (check ? check.status : 0) + " [" + snippet(html, "verify", 60) + "]");
  const t = String(cj.token);
  saveToken(code, t, Number(cj.expires_in || 0));
  clearPow(code);
  return t;
}

async function byse(embed, pageUrl, parent, warm) {
  const parsed = parseEmbed(embed);
  const origin = parsed.origin;
  const code = parsed.code;
  if (!code) throw kino.error("not_found", "embed sin código");
  const h = byseHeaders(origin, embed, pageUrl, parent);

  const emb = await get(embed, { Referer: h.Referer });
  if (!emb.ok) throw kino.error("unavailable", "embed " + emb.status);
  const html = await emb.text();
  const api = apiFrom(html, origin, code);
  const methods = methodsOf(html);
  const url = api.base + encodeURIComponent(api.id) + "/";
  const fp = fingerprint();

  const settings = await call(url + "embed/settings", methods, h, fp, "");
  if (!settings || !settings.ok) {
    throw kino.error("unavailable", ("settings " + (settings ? settings.status : 0) + " [" + snippet(html, "api/", 80) + "]").slice(0, 190));
  }

  const det = await call(url + "embed/details", methods, h, fp, "");
  if (det && det.ok) {
    const d = await unpack(await det.json());
    if (d.streams.length) return { streams: d.streams, subs: d.subs, origin: origin, embed: embed };
    if (warm) return { streams: [], subs: [], origin: origin, embed: embed };
  }

  let token = savedToken(code);
  let play = null;
  if (token) {
    play = await call(url + "embed/playback", methods, h, fp, token);
    if (play && (play.status === 401 || play.status === 403)) token = "";
  }
  if (!token) {
    token = await captcha(url, methods, h, fp, code, html);
    if (warm) return { streams: [], subs: [], origin: origin, embed: embed };
    play = await call(url + "embed/playback", methods, h, fp, token);
  }
  if (!play || !play.ok) throw kino.error("unavailable", "playback " + (play ? play.status : 0));

  const p = await unpack(await play.json());
  if (!p.streams.length) throw kino.error("not_found", "sin fuentes [" + (p.err || p.keys.join(",")) + "]");
  return { streams: p.streams, subs: p.subs, origin: origin, embed: embed };
}

/* ---------- Doodstream ---------- */

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

/* ---------- genéricos ---------- */

function findMedia(body, base) {
  const pats = [
    /https?:(?:\\\/|\/){2}[^"'\s]+?\.m3u8[^"'\s]*/gi,
    /https?:(?:\\\/|\/){2}[^"'\s]+?\.mp4[^"'\s]*/gi,
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

/* ---------- envoltorio reproductor.php?v=<base64> ---------- */

function unwrap(u) {
  const m = String(u).match(/[?&]v=([^&]+)/);
  if (!m) return "";
  let b = m[1];
  try {
    b = decodeURIComponent(b);
  } catch (e) {
    /* ya venía decodificado */
  }
  let t = b.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(t)) return "";
  while (t.length % 4) t += "=";
  let s = "";
  try {
    s = atob(t);
  } catch (e) {
    return "";
  }
  s = s.trim();
  if (!/^https?:\/\//i.test(s)) return "";
  return s.replace(/^http:\/\//i, "https://");
}

/* ---------- candidatos ---------- */

function iframeTags(html) {
  return html.match(/<iframe\b[^>]*>/gi) || [];
}

function attrsOf(tag) {
  const out = [];
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) out.push(m[2] || m[3] || m[4] || "");
  return out;
}

function isKnown(host) {
  for (const k of KNOWN) {
    if (host === k) return true;
    if (host.length > k.length && host.slice(-k.length - 1) === "." + k) return true;
  }
  return false;
}

function isDenied(host) {
  for (const k of DENY) {
    if (host === k) return true;
    if (host.length > k.length && host.slice(-k.length - 1) === "." + k) return true;
  }
  return false;
}

function candidates(html, pageUrl) {
  const known = [];
  const other = [];
  const own = [];
  const seen = {};
  const add = (raw) => {
    let u = String(raw || "").trim();
    if (!u) return;
    if (/^https?%3A/i.test(u)) {
      try {
        u = decodeURIComponent(u);
      } catch (e) {
        /* nada */
      }
    }
    let a = abs(u, pageUrl).replace(/^http:\/\//i, "https://");
    if (!a || !/^https:/i.test(a)) return;
    const inner = unwrap(a);
    if (inner) a = inner;
    if (seen[a]) return;
    const h = hostOf(a);
    if (!h) return;
    if (isKnown(h)) {
      seen[a] = 1;
      known.push({ url: a, parent: pageUrl });
    } else if (/(^|\.)tubepelis\.com$/.test(h)) {
      if (!/^\/(player|reproductor|embed)/i.test(pathOf(a))) return;
      seen[a] = 1;
      own.push({ url: a, parent: pageUrl });
    } else if (!isDenied(h)) {
      seen[a] = 1;
      other.push({ url: a, parent: pageUrl });
    }
  };
  for (const tag of iframeTags(html)) attrsOf(tag).forEach(add);
  const re = /(?:data-src|data-player|data-video|data-url|data-link|data-embed|data-srv|data-code|value)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = re.exec(html))) add(m[1] || m[2] || "");
  const re2 = /https?:(?:\\\/|\/){2}[^"'\s]*(?:byseqekaho|playmogo|n1mwq|dood|dsvplay)[^"'\s]*/gi;
  while ((m = re2.exec(html))) add(m[0].replace(/\\\//g, "/"));
  return known.concat(own, other).slice(0, 6);
}

function labelOf(url) {
  const h = hostOf(url);
  if (/byseqekaho/.test(h)) return "Byse";
  if (/dood|dsvplay/.test(h)) return "Dood";
  if (/playmogo/.test(h)) return "PlayMogo";
  if (/tubepelis/.test(h)) return "Servidor";
  return h.slice(0, 48);
}

async function play(c, pageUrl, depth) {
  const embed = c.url;
  const h = hostOf(embed);
  if (/(^|\.)tubepelis\.com$/.test(h)) {
    if ((depth || 0) > 1) throw kino.error("not_found", "player anidado");
    const r = await get(embed, { Referer: pageUrl });
    if (!r.ok) throw kino.error("unavailable", "player " + r.status);
    const inner = candidates(await r.text(), embed);
    if (!inner.length) throw kino.error("not_found", "player vacío");
    return await play(inner[0], embed, (depth || 0) + 1);
  }
  if (/dood|dsvplay/.test(h)) return await dood(embed, pageUrl);
  if (/byseqekaho|playmogo|n1mwq/.test(h)) {
    let first = null;
    try {
      return await byse(embed, pageUrl, c.parent, false);
    } catch (e) {
      first = e;
    }
    try {
      return await generic(embed, pageUrl);
    } catch (e2) {
      throw kino.error("unavailable", ("byse " + (first && first.message ? first.message : "") + " / gen " + (e2 && e2.message ? e2.message : "")).slice(0, 170));
    }
  }
  return await generic(embed, pageUrl);
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
  const list = candidates(html, pageUrl);
  if (!list.length) {
    const tags = iframeTags(html).map((t) => t.replace(/\s+/g, " ").slice(0, 62));
    throw kino.error("not_found", ("sin reproductor (iframes " + tags.length + ": " + tags.slice(0, 2).join(" | ") + ")").slice(0, 190), {
      userMessage: "Este título no tiene reproductor disponible.",
    });
  }

  const order = [];
  for (let i = 0; i < list.length; i++) order.push((pick + i) % list.length);
  const fails = [];
  for (const i of order) {
    try {
      const got = await play(list[i], pageUrl, 0);
      const alts = [];
      got.streams.slice(1, 4).forEach((s) => alts.push({ url: s.url, mime: s.mime, label: s.label || s.mime }));
      list.forEach((c, j) => {
        if (j !== i && alts.length < 8) alts.push({ label: labelOf(c.url), ref: kind + "|" + path + "|" + j });
      });
      const first = got.streams[0];
      const stream = { url: first.url, mime: first.mime };
      if (got.origin && got.origin !== "null") stream.headers = { Referer: got.embed, Origin: got.origin };
      if (got.subs.length) stream.subtitles = got.subs;
      if (alts.length) stream.alternatives = alts;
      return stream;
    } catch (e) {
      fails.push(labelOf(list[i].url) + ": " + (e && e.message ? e.message : "error"));
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
    const list = candidates(await page(pageUrl), pageUrl);
    const cand = list.filter((c) => /byseqekaho|playmogo|n1mwq/.test(c.url))[0];
    if (!cand) return;
    await byse(cand.url, pageUrl, cand.parent, true);
  } catch (e) {
    /* prepare nunca falla */
  }
}