// Kino plugin: Kimera (kimeraweb.com) — películas y series.
// El sitio guarda el video troceado y disfrazado (.png/.jpg), cifrado con AES-CTR y con una llave
// derivada por video. HLS no tiene AES-CTR, así que el plugin sirve los bytes ya descifrados
// (byteSource + read) y pide a la CDN solo el rango que el reproductor necesita.

const BASE = "https://kimeraweb.com";
const CDN = "https://cloudcdn.sbs";
const TYPES = "movies|series|dramas|animes|donghuas|shorts";
const AS_SERIES = new Set(["series", "dramas", "animes", "donghuas", "shorts"]);
const SOCIAL = "kinotvapp/kino-social";
const SALT = "kmr_sec_stream_v2_";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "es-CO,es;q=0.9",
};
const LINK = new RegExp('(?:href|data-href)="(?:https?:\\/\\/kimeraweb\\.com)?\\/(' + TYPES + ')\\/([^"]+)"', "gi");
const BARE = new RegExp('\\/(' + TYPES + ')\\/([a-z0-9][a-z0-9-]*-\\d+)', "gi");

function t(es, en) {
  return String(kino.lang || "es").toLowerCase().startsWith("en") ? en : es;
}

function log(...args) {
  try {
    kino.log(...args);
  } catch {
    // la línea se pierde, el resultado no
  }
}

async function body(answer) {
  if (typeof answer.text === "function") return await answer.text();
  if (typeof answer.json === "function") return JSON.stringify(await answer.json());
  return "";
}

function decode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function text(value) {
  const plain = decode(String(value || "").replace(/<[^>]*>/g, " "));
  const flat = typeof plain.normalize === "function" ? plain.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : plain;
  return flat.toLowerCase().replace(/\s+/g, " ").trim();
}

function attr(attrs, name) {
  const found = new RegExp(name + '="([^"]*)"').exec(attrs);
  return found ? found[1] : "";
}

function https(value) {
  let url = String(value || "");
  if (url.startsWith("/")) url = CDN + url;
  return url.startsWith(CDN + "/") ? url : undefined;
}

function media(value) {
  let url = String(value || "").trim();
  if (!url) return undefined;
  if (url.startsWith("/")) url = CDN + url;
  return /^https:\/\//i.test(url) ? url : undefined;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function json(html, key) {
  const found = new RegExp('<script type="application/json"[^>]*(?:id="' + key + '"|data-element="' + key + '")[^>]*>([\\s\\S]*?)<\\/script>').exec(html);
  if (!found) return null;
  try {
    return JSON.parse(found[1]);
  } catch {
    return null;
  }
}

function splitRef(ref) {
  const at = String(ref || "").indexOf("|");
  if (at === -1) return [String(ref || ""), ""];
  return [ref.slice(0, at), ref.slice(at + 1)];
}

// ── Bytes ───────────────────────────────────────────────────────────────────
function toBytes(textValue) {
  const out = new Uint8Array(textValue.length);
  for (let i = 0; i < textValue.length; i++) out[i] = textValue.charCodeAt(i) & 255;
  return out;
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function toBase64(bytesIn) {
  let out = "";
  for (let i = 0; i < bytesIn.length; i += 0x8000) out += String.fromCharCode.apply(null, bytesIn.subarray(i, i + 0x8000));
  return btoa(out);
}

// Cuerpo binario de una respuesta. Kino puede no exponer arrayBuffer ni bytes: si solo hay texto,
// se rearma desde hex o base64, y como último recurso byte por byte.
async function bytes(answer) {
  if (typeof answer.arrayBuffer === "function") return new Uint8Array(await answer.arrayBuffer());
  if (typeof answer.bytes === "function") return new Uint8Array(await answer.bytes());
  const raw = await body(answer);
  if (!raw) return new Uint8Array(0);
  const clean = raw.replace(/\s+/g, "");
  if (clean.length % 2 === 0 && /^[0-9a-f]+$/i.test(clean)) return fromHex(clean);
  if (clean.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(clean)) {
    try {
      return fromHex(kino.crypto.convert(clean, "base64", "hex"));
    } catch {
      // no era base64: sigue como texto
    }
  }
  return toBytes(raw);
}

function hexHead(got) {
  let out = "";
  for (let i = 0; i < got.length && i < 16; i++) out += ("0" + got[i].toString(16)).slice(-2);
  return out || "vacio";
}

// Pide un rango y devuelve esos bytes. Si la CDN ignora el Range, recorta el archivo completo.
async function ranged(url, start, end, headers) {
  const want = end - start + 1;
  const h = { ...headers, Accept: "*/*", Range: "bytes=" + start + "-" + end };
  const answer = await kino.fetch(url, { headers: h, redirect: "follow" });
  if (!answer.ok) throw kino.error("unavailable", "rango " + answer.status);
  let got = await bytes(answer);
  if (!got.length) {
    // un Kino que no entrega binario devuelve el cuerpo vacío: se reintenta pidiendo base64
    const again = await kino.fetch(url, { headers: h, redirect: "follow", responseType: "base64" });
    if (again.ok) got = await bytes(again);
  }
  if (!got.length) throw kino.error("unavailable", "rango sin cuerpo");
  if (got.length > want) got = got.subarray(start, end + 1);
  return got;
}

// ── SHA-256 (solo para la sal de la llave) ───────────────────────────────────
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256(data) {
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const len = data.length;
  const total = (((len + 9) >> 6) + 1) << 6;
  const msg = new Uint8Array(total);
  msg.set(data);
  msg[len] = 0x80;
  const bits = len * 8;
  msg[total - 4] = (bits >>> 24) & 255;
  msg[total - 3] = (bits >>> 16) & 255;
  msg[total - 2] = (bits >>> 8) & 255;
  msg[total - 1] = bits & 255;
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K256[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 255;
    out[i * 4 + 1] = (h[i] >>> 16) & 255;
    out[i * 4 + 2] = (h[i] >>> 8) & 255;
    out[i * 4 + 3] = h[i] & 255;
  }
  return out;
}

// ── AES (solo cifrar: CTR necesita nada más) ────────────────────────────────
const SBOX = fromHex(
  "637c777bf26b6fc53001672bfed7ab76" +
    "ca82c97dfa5947f0add4a2af9ca472c0" +
    "b7fd9326363ff7cc34a5e5f171d83115" +
    "04c723c31896059a071280e2eb27b275" +
    "09832c1a1b6e5aa0523bd6b329e32f84" +
    "53d100ed20fcb15b6acbbe394a4c58cf" +
    "d0efaafb434d338545f9027f503c9fa8" +
    "51a3408f929d38f5bcb6da2110fff3d2" +
    "cd0c13ec5f974417c4a77e3d645d1973" +
    "60814fdc222a908846eeb814de5e0bdb" +
    "e0323a0a4906245cc2d3ac629195e479" +
    "e7c8376d8dd54ea96c56f4ea657aae08" +
    "ba78252e1ca6b4c6e8dd741f4bbd8b8a" +
    "703eb5664803f60e613557b986c11d9e" +
    "e1f8981169d98e949b1e87e9ce5528df" +
    "8ca1890dbfe6426841992d0fb054bb16"
);

function expandKey(key) {
  const nk = key.length >> 2;
  const nr = nk + 6;
  const w = new Uint8Array(16 * (nr + 1));
  w.set(key);
  const rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
  for (let i = nk; i < 4 * (nr + 1); i++) {
    let t0 = w[(i - 1) * 4];
    let t1 = w[(i - 1) * 4 + 1];
    let t2 = w[(i - 1) * 4 + 2];
    let t3 = w[(i - 1) * 4 + 3];
    if (i % nk === 0) {
      const rot = t0;
      t0 = SBOX[t1] ^ rcon[i / nk - 1];
      t1 = SBOX[t2];
      t2 = SBOX[t3];
      t3 = SBOX[rot];
    } else if (nk > 6 && i % nk === 4) {
      t0 = SBOX[t0];
      t1 = SBOX[t1];
      t2 = SBOX[t2];
      t3 = SBOX[t3];
    }
    w[i * 4] = w[(i - nk) * 4] ^ t0;
    w[i * 4 + 1] = w[(i - nk) * 4 + 1] ^ t1;
    w[i * 4 + 2] = w[(i - nk) * 4 + 2] ^ t2;
    w[i * 4 + 3] = w[(i - nk) * 4 + 3] ^ t3;
  }
  return { w, nr };
}

function encryptBlock(key, block) {
  const { w, nr } = key;
  const s = new Uint8Array(block);
  const add = (round) => {
    for (let i = 0; i < 16; i++) s[i] ^= w[round * 16 + i];
  };
  const xt = (a) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 255;
  add(0);
  for (let round = 1; round <= nr; round++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    const c = new Uint8Array(16);
    for (let col = 0; col < 4; col++) {
      c[col * 4] = s[col * 4];
      c[col * 4 + 1] = s[((col + 1) % 4) * 4 + 1];
      c[col * 4 + 2] = s[((col + 2) % 4) * 4 + 2];
      c[col * 4 + 3] = s[((col + 3) % 4) * 4 + 3];
    }
    if (round !== nr) {
      for (let col = 0; col < 4; col++) {
        const a0 = c[col * 4];
        const a1 = c[col * 4 + 1];
        const a2 = c[col * 4 + 2];
        const a3 = c[col * 4 + 3];
        const all = a0 ^ a1 ^ a2 ^ a3;
        c[col * 4] = a0 ^ all ^ xt(a0 ^ a1);
        c[col * 4 + 1] = a1 ^ all ^ xt(a1 ^ a2);
        c[col * 4 + 2] = a2 ^ all ^ xt(a2 ^ a3);
        c[col * 4 + 3] = a3 ^ all ^ xt(a3 ^ a0);
      }
    }
    s.set(c);
    add(round);
  }
  return s;
}

// Descifra data con AES-CTR: iv de 16 bytes, contador de 128 bits, arranca en startBlock.
function ctrDecrypt(keyBytes, iv, startBlock, data) {
  const key = expandKey(keyBytes);
  const counter = new Uint8Array(iv);
  const bump = (n) => {
    let carry = n;
    for (let i = 15; i >= 0 && carry; i--) {
      const sum = counter[i] + carry;
      counter[i] = sum & 255;
      carry = sum >> 8;
    }
  };
  bump(startBlock);
  const out = new Uint8Array(data.length);
  for (let off = 0; off < data.length; off += 16) {
    const ks = encryptBlock(key, counter);
    const n = Math.min(16, data.length - off);
    for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ ks[i];
    bump(1);
  }
  return out;
}

// ── Contenedor del sitio ─────────────────────────────────────────────────────
// 8 bytes de cabecera "IGCF" + longitud, 16 de IV en claro, el cuerpo cifrado y 4 de CRC32.
const IGCF_HEAD = 8;
const IGCF_IV = 16;
const IGCF_TAIL = 4;

function plausible(bytesIn) {
  if (bytesIn.length < 12) return false;
  const kind = String.fromCharCode(bytesIn[4], bytesIn[5], bytesIn[6], bytesIn[7]);
  if (["ftyp", "styp", "moof", "moov", "mdat", "sidx", "free", "skip", "emsg", "prft"].indexOf(kind) === -1) return false;
  const size = (bytesIn[0] << 24) | (bytesIn[1] << 16) | (bytesIn[2] << 8) | bytesIn[3];
  return size > 8 && size < 50000000;
}

// ── Fichas del HTML ─────────────────────────────────────────────────────────
function cards(html) {
  const out = [];
  let links = [];
  let match;
  LINK.lastIndex = 0;
  while ((match = LINK.exec(html))) links.push({ type: match[1].toLowerCase(), full: match[2], end: match.index + match[0].length });
  if (!links.length) {
    BARE.lastIndex = 0;
    while ((match = BARE.exec(html))) links.push({ type: match[1].toLowerCase(), full: match[2], end: match.index + match[0].length });
  }
  links = links.map((link, i) => ({ ...link, i })).sort((a, b) => a.end - b.end || a.i - b.i);
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const path = link.full.split("/")[0];
    const numbered = /(\d+)$/.exec(path);
    if (!numbered) continue;
    const stop = i + 1 < links.length ? links[i + 1].end : link.end + 2000;
    const window = html.slice(link.end, Math.min(stop, link.end + 2000));
    const wide = html.slice(link.end, Math.min(html.length, link.end + 2600));
    const image = /<img([^>]*)>/i.exec(window);
    let poster = image ? https(attr(image[1], "data-src")) || https(attr(image[1], "src")) : undefined;
    if (!poster) {
      const background = /url\((['"]?)(https?:\/\/[^)'"]+)\1\)/i.exec(window);
      if (background) poster = https(background[2]);
    }
    let title = image ? decode(attr(image[1], "alt")) : "";
    if (!title) {
      const caption = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(wide);
      if (caption) title = text(caption[1]);
    }
    if (!title) {
      const twin = new RegExp('(?:href|data-href)="[^"]*' + escapeRegExp(path) + '"[^>]*>([\\s\\S]{1,200}?)<\\/a>', "i").exec(wide);
      if (twin) title = text(twin[1]);
    }
    title = title.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) continue;
    const id = (AS_SERIES.has(link.type) ? "s" : "m") + numbered[1];
    out.push({
      id,
      ref: numbered[1] + "|/" + link.type + "/" + path,
      title,
      kind: AS_SERIES.has(link.type) ? "series" : "movie",
      poster,
    });
  }
  return out;
}

function collect(html) {
  const items = [];
  const seen = new Set();
  for (const card of cards(html)) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    items.push(card);
    if (items.length >= 30) break;
  }
  return items;
}

function sections(html) {
  const marks = [];
  const re = /<h2\b[^>]*>/gi;
  let match;
  while ((match = re.exec(html))) marks.push(match.index + match[0].length);
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i];
    const to = i + 1 < marks.length ? marks[i + 1] : html.length;
    out.push({ head: text(html.slice(from, Math.min(to, from + 300))), body: html.slice(from, to) });
  }
  return out;
}

// Abre la ficha en la pantalla del plugin, así Atrás vuelve al Home.
function opens(items) {
  for (const item of items) item.open = { screen: { args: { ref: item.ref } } };
  return items;
}

const ROWS = [
  { id: "estrenos", title: "Últimos estrenos", titleEn: "Latest releases", keys: ["ultimos estrenos"], genre: "otros" },
  { id: "populares", title: "Populares del día", titleEn: "Popular today", keys: ["populares"], genre: "otros" },
  { id: "agregados", title: "Últimos títulos agregados", titleEn: "Recently added", keys: ["ultimos titulos"], genre: "otros" },
  { id: "episodios", title: "Últimos episodios", titleEn: "Latest episodes", keys: ["ultimos episodios"], genre: "series" },
];

async function page(path) {
  const answer = await kino.fetch(BASE + path, { headers: HEADERS });
  if (!answer.ok) throw kino.error("unavailable", path + " " + answer.status);
  return await body(answer);
}

function rowsOf(html, prefix, wanted, genre) {
  const found = sections(html);
  const out = [];
  for (const row of wanted) {
    const section = found.find((one) => row.keys.some((key) => one.head.includes(key)));
    if (!section) continue;
    const items = opens(collect(section.body));
    if (items.length) out.push({ id: prefix + row.id, title: row.prefix + " · " + t(row.title, row.titleEn), genre: genre || row.genre, items });
  }
  return out;
}

const SECTION_ROWS = [
  { id: "mes", title: "Populares del mes", titleEn: "Popular this month", keys: ["populares del mes"] },
  { id: "estrenos", title: "Últimos estrenos", titleEn: "Latest releases", keys: ["ultimos estrenos"] },
  { id: "agregados", title: "Últimos agregados", titleEn: "Recently added", keys: ["ultimos titulos"] },
  { id: "dia", title: "Populares del día", titleEn: "Popular today", keys: ["populares del dia"] },
];

export async function home() {
  const [inicio, pelis, series] = await Promise.allSettled([page("/"), page("/movies/"), page("/series/")]);
  if (inicio.status !== "fulfilled") throw inicio.reason;
  const html = inicio.value;
  const found = sections(html);
  const rows = [];
  for (const row of ROWS) {
    const section = found.find((one) => row.keys.some((key) => one.head.includes(key)));
    if (!section) continue;
    const items = opens(collect(section.body));
    if (items.length) rows.push({ id: row.id, title: t(row.title, row.titleEn), genre: row.genre, items });
  }
  if (pelis.status === "fulfilled") {
    for (const r of rowsOf(pelis.value, "m-", SECTION_ROWS.map((x) => ({ ...x, prefix: t("Películas", "Movies") })), "peliculas")) rows.push(r