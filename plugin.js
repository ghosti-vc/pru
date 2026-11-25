/* ---------- prueba de trabajo del reproductor ---------- */

const P_BASE = new Uint32Array(4);
const P_STATE = new Uint32Array(4);
const P_WORK = new Uint32Array(512);
const P_OUT = new Uint32Array(8);
const P_K1 = 2654435761;
const P_K2 = 2246822519;

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
    e[0] = (e[0] + e[1]) >>> 0;
    e[3] = rotl(e[3] ^ e[0], 16);
    e[2] = (e[2] + e[3]) >>> 0;
    e[1] = rotl(e[1] ^ e[2], 12);
    e[0] = (e[0] + e[1]) >>> 0;
    e[3] = rotl(e[3] ^ e[0], 8);
    e[2] = (e[2] + e[3]) >>> 0;
    e[1] = rotl(e[1] ^ e[2], 7);
  }
  for (let i = 0; i < 8; i++) {
    e[0] = (e[0] + e[1]) >>> 0;
    e[3] = rotl(e[3] ^ e[0], 16);
    e[2] = (e[2] + e[3]) >>> 0;
    e[1] = rotl(e[1] ^ e[2], 12);
    e[0] = (e[0] + e[1]) >>> 0;
    e[3] = rotl(e[3] ^ e[0], 8);
    e[2] = (e[2] + e[3]) >>> 0;
    e[1] = rotl(e[1] ^ e[2], 7);
  }
  for (let i = 0; i < 512; i++) {
    e[0] = (e[0] + e[1]) >>> 0;
    e[3] = rotl(e[3] ^ e[0], 16);
    e[2] = (e[2] + e[3]) >>> 0;
    e[1] = rotl(e[1] ^ e[2], 12);
    e[0] = (e[0] + e[1]) >>> 0;
    e[3] = rotl(e[3] ^ e[0], 8);
    e[2] = (e[2] + e[3]) >>> 0;
    e[1] = rotl(e[1] ^ e[2], 7);
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
      e[0] = (e[0] + e[1]) >>> 0;
      e[3] = rotl(e[3] ^ e[0], 16);
      e[2] = (e[2] + e[3]) >>> 0;
      e[1] = rotl(e[1] ^ e[2], 12);
      e[0] = (e[0] + e[1]) >>> 0;
      e[3] = rotl(e[3] ^ e[0], 8);
      e[2] = (e[2] + e[3]) >>> 0;
      e[1] = rotl(e[1] ^ e[2], 7);
    }
  }
  for (let i = 0; i < 8; i++) {
    e[0] = (e[0] + e[1]) >>> 0;
    e[3] = rotl(e[3] ^ e[0], 16);
    e[2] = (e[2] + e[3]) >>> 0;
    e[1] = rotl(e[1] ^ e[2], 12);
    e[0] = (e[0] + e[1]) >>> 0;
    e[3] = rotl(e[3] ^ e[0], 8);
    e[2] = (e[2] + e[3]) >>> 0;
    e[1] = rotl(e[1] ^ e[2], 7);
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

/* ---------- reproductor Byse ---------- */

function parseEmbed(embed) {
  const u = new URL(embed);
  const m = u.pathname.match(/\/e\/([A-Za-z0-9._~-]+)/);
  const seg = u.pathname.split("/").filter(Boolean);
  const code = m ? m[1] : seg[seg.length - 1] || "";
  return { origin: u.origin, code };
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
    .map((s) => ({ url: s.url, mime: mimeOf(s.mime_type), label: s.label || s.quality || "" }));
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
  const { origin, code } = parseEmbed(embed);
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
    let j = null;
    try {
      j = JSON.parse(await det.text());
    } catch (e) {
      j = null;
    }
    const direct = sourcesFrom(j);
    if (direct.length) return { streams: direct, subs: [] };
  }

  let token = savedToken(code);
  let play = null;
  if (token) {
    play = await postJson(api + "embed/playback", { ...h, "X-Captcha-Token": token }, { fingerprint: fp });
    if (play.status === 401 || play.status === 403) token = "";
  }

  if (!token) {
    const start = await postJson(api + "embed/captcha", h, { fingerprint: fp });
    if (!start.ok || !start.json || !start.json.pow_token) {
      throw kino.error("rate_limited", "captcha " + start.status);
    }
    const solution = await solve(String(start.json.pow_nonce || ""), Number(start.json.pow_difficulty || 0), 28000);
    if (solution === null) throw kino.error("rate_limited", "pow agotado");
    const check = await postJson(api + "embed/captcha/verify", h, {
      pow_token: start.json.pow_token,
      solution,
      fingerprint: fp,
    });
    if (!check.ok || !check.json || check.json.status !== "ok" || !check.json.token) {
      throw kino.error("rate_limited", "verify " + (check.json && check.json.status));
    }
    token = String(check.json.token);
    saveToken(code, token, Number(check.json.expires_in || 0));
    play = await postJson(api + "embed/playback", { ...h, "X-Captcha-Token": token }, { fingerprint: fp });
  }

  if (!play || !play.ok || !play.json) {
    const map = await routes(origin, code, h, fp);
    throw kino.error("unavailable", ("pb " + (play ? play.status : 0) + " " + map).slice(0, 180));
  }

  let body = play.json;
  if (body.playback) {
    try {
      body = JSON.parse(new TextDecoder().decode(decrypt(body.playback)));
    } catch (e) {
      throw kino.error("unavailable", "descifrado");
    }
  }
  const streams = sourcesFrom(body);
  if (!streams.length) throw kino.error("not_found", "sin fuentes");
  const subs = (Array.isArray(body.tracks) ? body.tracks : [])
    .filter((t) => t && typeof t.url === "string" && /^https:\/\//.test(t.url))
    .map((t) => ({ url: t.url, label: t.title || t.language || "Subtítulos", mime: "text/vtt" }));
  return { streams, subs };
} 