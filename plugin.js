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

// ── Bytes ────────────────────────────────────────────────────────────────────
function toBytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
  return out;
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

// Cuerpo binario de una respuesta. Kino puede no exponer arrayBuffer: si solo hay texto,
// se rearma byte por byte (solo sirve si Kino no lo decodificó como UTF-8).
async function bytes(answer) {
  if (typeof answer.arrayBuffer === "function") return new Uint8Array(await answer.arrayBuffer());
  if (typeof answer.bytes === "function") return new Uint8Array(await answer.bytes());
  return toBytes(await body(answer));
}

async function ranged(url, start, end, headers) {
  const answer = await kino.fetch(url, { headers: { ...headers, Range: "bytes=" + start + "-" + end } });
  if (!answer.ok) throw kino.error("unavailable", "rango " + answer.status);
  const got = await bytes(answer);
  if (got.length > end - start + 1) throw kino.error("unavailable", "el rango vino completo");
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
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + mj) >>> 0;
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

// ── AES (solo cifrado de bloque, para el flujo de CTR) ───────────────────────
const SBOX = fromHex(
  "637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0add4a2af9ca472c0" +
    "b7fd9326363ff7cc34a5e5f171d8311504c723c31896059a071280e2eb27b275" +
    "09832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cf" +
    "d0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2" +
    "cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdb" +
    "e0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08" +
    "ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9e" +
    "e1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16"
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
      t0 = SBOX[t1] ^ rcon[(i / nk) - 1];
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
    let poster = image ? media(attr(image[1], "data-src")) || media(attr(image[1], "src")) : undefined;
    if (!poster) {
      const background = /url\((['"]?)(https?:\/\/[^)'"]+)\1\)/i.exec(window);
      if (background) poster = media(background[2]);
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
    for (const r of rowsOf(pelis.value, "m-", SECTION_ROWS.map((x) => ({ ...x, prefix: t("Películas", "Movies") })), "peliculas")) rows.push(r);
  } else log("home: /movies/ falló");
  if (series.status === "fulfilled") {
    for (const r of rowsOf(series.value, "s-", SECTION_ROWS.map((x) => ({ ...x, prefix: t("Series", "Series") })), "series")) rows.push(r);
  } else log("home: /series/ falló");
  if (!rows.length) {
    const items = opens(collect(html));
    if (items.length) rows.push({ id: "todo", title: "Kimera", genre: "otros", items });
  }
  if (!rows.length) throw kino.error("unavailable", "home vacío len=" + html.length);
  for (const row of rows) opens(row.items);
  log("home: filas=" + rows.length);
  return rows;
}

// ── Catálogo ────────────────────────────────────────────────────────────────
function catalogItems(html) {
  const data = json(html, "catalog-initial-data");
  const out = [];
  if (data && Array.isArray(data.items)) {
    for (const it of data.items) {
      const url = String(it.title_url || "");
      const m = /^\/([a-z]+)\/[^\/]+-(\d+)$/.exec(url);
      if (!m) continue;
      const series = AS_SERIES.has(m[1]);
      out.push({
        id: (series ? "s" : "m") + m[2],
        ref: m[2] + "|" + url,
        title: decode(it.name).slice(0, 200),
        kind: series ? "series" : "movie",
        poster: media(it.vertical_cover_url) || media(it.cover_url),
      });
    }
    return { items: out, hasNext: !!data.has_next, pages: Number(data.pages) || 1 };
  }
  return { items: collect(html), hasNext: false, pages: 1 };
}

async function catalog(params, pageNo) {
  const q = Object.keys(params).filter((k) => params[k] !== "" && params[k] != null).map((k) => k + "=" + encodeURIComponent(params[k]));
  q.push("page=" + pageNo);
  return catalogItems(await page("/catalog?" + q.join("&")));
}

export async function search(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const first = await catalog({ q }, 1);
  let items = first.items.slice();
  if (first.pages > 1) {
    const more = [];
    for (let p = 2; p <= Math.min(first.pages, 4); p++) more.push(catalog({ q }, p).catch(() => ({ items: [] })));
    for (const r of await Promise.all(more)) items = items.concat(r.items);
  }
  const seen = new Set();
  items = items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  log("búsqueda '" + q + "': " + items.length);
  return items;
}

const BROWSE = {
  peliculas: { title: "Películas", titleEn: "Movies", params: { type: "movie" }, genre: "peliculas" },
  series: { title: "Series", titleEn: "Series", params: { type: "serie" }, genre: "series" },
  animes: { title: "Animes", titleEn: "Anime", params: { type: "anime" }, genre: "anime" },
  dramas: { title: "Dramas", titleEn: "Dramas", params: { type: "drama" }, genre: "doramas" },
  donghuas: { title: "Donghuas", titleEn: "Donghua", params: { type: "donghua" }, genre: "otros" },
  agregados: { title: "Últimos agregados", titleEn: "Recently added", params: { sort: "added" }, genre: "otros" },
  accion: { title: "Acción", titleEn: "Action", params: { tag: 2 }, genre: "accion" },
  aventura: { title: "Aventura", titleEn: "Adventure", params: { tag: 4 }, genre: "aventura" },
  comedia: { title: "Comedia", titleEn: "Comedy", params: { tag: 1 }, genre: "comedia" },
  drama: { title: "Drama", titleEn: "Drama", params: { tag: 11 }, genre: "drama" },
  terror: { title: "Terror", titleEn: "Horror", params: { tag: 21 }, genre: "terror" },
  ciencia: { title: "Ciencia ficción", titleEn: "Sci-fi", params: { tag: 14 }, genre: "ciencia-ficcion" },
  animacion: { title: "Animación", titleEn: "Animation", params: { tag: 17 }, genre: "infantil" },
  romance: { title: "Romance", titleEn: "Romance", params: { tag: 3 }, genre: "romance" },
  suspenso: { title: "Suspenso", titleEn: "Thriller", params: { tag: 18 }, genre: "suspenso" },
  crimen: { title: "Crimen", titleEn: "Crime", params: { tag: 15 }, genre: "otros" },
  fantasia: { title: "Fantasía", titleEn: "Fantasy", params: { tag: 5 }, genre: "otros" },
  familia: { title: "Familia", titleEn: "Family", params: { tag: 13 }, genre: "infantil" },
};

export async function browse(ref, cursor) {
  const def = BROWSE[String(ref || "")];
  if (!def) throw kino.error("not_found", "sección desconocida");
  const n = Math.max(1, parseInt(cursor, 10) || 1);
  const r = await catalog(def.params, n);
  const out = { items: r.items };
  if (r.hasNext && r.items.length) out.next = String(n + 1);
  return out;
}

export async function categories() {
  return Object.keys(BROWSE).map((id) => ({ id, title: t(BROWSE[id].title, BROWSE[id].titleEn), ref: id }));
}

// ── Episodios ───────────────────────────────────────────────────────────────
async function seriesInfo(id, path) {
  const info = { title: "", poster: undefined };
  try {
    const answer = await kino.fetch(BASE + path, { headers: HEADERS });
    if (answer.ok) {
      const data = json(await body(answer), "title-data");
      if (data) {
        info.title = decode(data.name).slice(0, 200);
        info.poster = media(data.cover_url);
      }
    }
  } catch (error) {
    log("ficha de serie", id, error.message);
  }
  if (!info.title) info.title = "Serie " + id;
  return info;
}

export async function episodes(ref) {
  const [id, path] = splitRef(ref);
  if (!id) throw kino.error("not_found", "ref " + ref);
  const series = await seriesInfo(id, path);
  const episodes = [];
  for (let page = 1; page <= 20; page++) {
    const answer = await kino.fetch(BASE + "/api/titles/" + encodeURIComponent(id) + "/content?sort=asc&page=" + page, { headers: HEADERS });
    if (!answer.ok) break;
    const data = JSON.parse(await body(answer));
    for (const season of data.seasons || []) {
      const number = Number(season.number) || 1;
      for (const item of season.items || []) {
        const episode = Number(item.number);
        if (!episode || !item.url) continue;
        episodes.push({
          season: number,
          number: episode,
          ref: id + "|" + item.url,
          title: decode(item.name).slice(0, 200) || "Episodio " + episode,
          poster: item.thumbnail_url || series.poster,
        });
      }
    }
    if (!data.has_next) break;
  }
  if (!episodes.length) throw kino.error("not_found", "sin episodios");
  return { series, episodes };
}

async function firstEpisode(id) {
  const answer = await kino.fetch(BASE + "/api/titles/" + encodeURIComponent(id) + "/content?sort=asc&page=1", { headers: HEADERS });
  if (!answer.ok) return null;
  const data = JSON.parse(await body(answer));
  for (const season of data.seasons || []) {
    const items = season.items || [];
    if (items.length) return items[0].url || null;
  }
  return null;
}

// ── Índice del stream ───────────────────────────────────────────────────────
const streams = new Map();
const keys = new Map();

function playlistUrl(value) {
  const url = media(value);
  if (!url) return undefined;
  if (/\.m3u8/i.test(url)) return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url + ".m3u8" : url.slice(0, cut) + ".m3u8" + url.slice(cut);
}

// Arma el mapa de tramos: dónde empieza cada segmento ya descifrado y de qué tamaño queda.
async function index(id, videoUrl, headers) {
  const answer = await kino.fetch(playlistUrl(videoUrl), { headers });
  if (!answer.ok) throw kino.error("unavailable", "lista " + answer.status);
  const lines = (await body(answer)).split(/\r?\n/);
  let initUrl;
  let size = 0;
  let pending = 0;
  const parts = [];
  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;
    if (clean.startsWith("#EXT-X-MAP")) {
      const uri = /URI="([^"]+)"/.exec(clean);
      if (uri) initUrl = media(uri[1]);
      continue;
    }
    if (clean.startsWith("#EXT-X-IGCF-SIZE")) {
      pending = Number(clean.split(":")[1]) || 0;
      continue;
    }
    if (clean.startsWith("#")) continue;
    const url = media(clean);
    if (!url || !pending) continue;
    parts.push({ url, file: pending });
    pending = 0;
  }
  if (!parts.length) throw kino.error("unavailable", "lista sin segmentos");
  const list = [];
  if (initUrl) list.push({ url: initUrl, off: 0, len: 0, iv: null });
  let off = 0;
  for (const part of parts) {
    const len = part.file - IGCF_HEAD - IGCF_IV - IGCF_TAIL;
    if (len <= 0) throw kino.error("unavailable", "segmento raro");
    list.push({ url: part.url, off, len, iv: null });
    off += len;
  }
  if (initUrl) {
    const first = list[0];
    first.len = first.len || (await head(first.url, headers)).length - IGCF_HEAD - IGCF_IV - IGCF_TAIL;
    // el init no tenía tamaño en la lista: se recorre el resto para recolocar los offsets
    let acc = first.len;
    for (let i = 1; i < list.length; i++) {
      list[i].off = acc;
      acc += list[i].len;
    }
    off = acc;
  }
  return { id, list, size: off, headers };
}

async function head(url, headers) {
  const got = await ranged(url, 0, 63, headers);
  if (String.fromCharCode(got[0], got[1], got[2], got[3]) !== "IGCF") throw kino.error("unavailable", "sin cabecera IGCF");
  return got;
}

async function ivOf(entry, headers) {
  if (entry.iv) return entry.iv;
  const got = await ranged(entry.url, IGCF_HEAD, IGCF_HEAD + IGCF_IV - 1, headers);
  if (got.length < IGCF_IV) throw kino.error("unavailable", "sin IV");
  entry.iv = got;
  return got;
}

async function keyFor(stream) {
  if (stream.key) return stream.key;
  const cached = keys.get(stream.id);
  if (cached) {
    stream.key = cached;
    return cached;
  }
  const answer = await kino.fetch(BASE + "/api/content/video/" + stream.id + "/key", { headers: HEADERS });
  if (!answer.ok) throw kino.error("unavailable", "llave " + answer.status);
  const data = JSON.parse(await body(answer));
  const token = data && (data.t || data.key);
  if (!token) throw kino.error("unavailable", "sin llave");
  const secret = fromHex(atob(token).split("").map((c) => ("0" + c.charCodeAt(0).toString(16)).slice(-2)).join(""));

  // El sitio mezcla el token con un identificador: se prueban los candidatos y gana el que
  // produzca un bloque válido. Lo que se adivina es solo el identificador, nunca la llave.
  const first = stream.list[0];
  const sample = await ranged(first.url, IGCF_HEAD + IGCF_IV, IGCF_HEAD + IGCF_IV + 63, stream.headers);
  const iv = await ivOf(first, stream.headers);
  const masks = [];
  const push = (value) => {
    const s = String(value || "");
    if (s.length === 16 || s.length === 24 || s.length === 32) masks.push(s);
  };
  const video = String(stream.id);
  push(video.padStart(16, "0"));
  push(video.padStart(32, "0"));
  push(video);
  push(stream.initHash);
  for (const m of stream.masks || []) push(m);

  for (const mask of masks) {
    const hash = sha256(toBytes(SALT + atob(token)));
    const maskBytes = toBytes(mask);
    const derived = new Uint8Array(maskBytes.length);
    for (let i = 0; i < maskBytes.length; i++) derived[i] = maskBytes[i] ^ hash[i];
    const probe = ctrDecrypt(derived, iv, 0, sample);
    if (plausible(probe)) {
      log("llave ok con máscara de " + mask.length + " («" + mask + "»)");
      keys.set(stream.id, derived);
      stream.key = derived;
      return derived;
    }
  }
  throw kino.error("unavailable", "ninguna máscara descifró");
}

export async function read({ handle, offset, length }) {
  await null;
  let stream = streams.get(handle);
  if (!stream) {
    const cut = String(handle).indexOf("|");
    const id = handle.slice(2, cut);
    const videoUrl = decodeURIComponent(handle.slice(cut + 1));
    const headers = { Referer: BASE + "/", Origin: BASE, "User-Agent": HEADERS["User-Agent"] };
    stream = await index(id, videoUrl, headers);
    stream.initHash = (/\/stream\/([a-z0-9]+)\./i.exec(stream.list[0].url) || [])[1];
    streams.set(handle, stream);
  }
  const total = Math.min(length, stream.size - offset);
  if (total <= 0) return { bytes: "" };
  const key = await keyFor(stream);

  const out = new Uint8Array(total);
  let written = 0;
  let pos = offset;
  while (written < total) {
    const entry = stream.list.find((x) => pos >= x.off && pos < x.off + x.len);
    if (!entry) break;
    const local = pos - entry.off;
    const take = Math.min(total - written, entry.len - local);
    const skip = local % 16;
    const from = local - skip;
    const need = skip + take;
    const pad = (16 - (need % 16)) % 16;
    const iv = await ivOf(entry, stream.headers);
    const raw = await ranged(entry.url, IGCF_HEAD + IGCF_IV + from, IGCF_HEAD + IGCF_IV + from + need + pad - 1, stream.headers);
    const clear = ctrDecrypt(key, iv, from / 16, raw);
    out.set(clear.subarray(skip, skip + take), written);
    written += take;
    pos += take;
  }
  return { bytes: toBase64(out.subarray(0, written)) };
}

// ── Reproducción ────────────────────────────────────────────────────────────
export async function resolve(ref) {
  await null;
  const raw = String(ref || "");
  const cut = raw.indexOf("#");
  const base = cut === -1 ? raw : raw.slice(0, cut);
  const pick = cut === -1 ? "" : raw.slice(cut + 1);
  let [id, path] = splitRef(base);
  if (!id || !path.startsWith("/")) throw kino.error("not_found", "ref " + raw);

  if (!path.includes("/watch")) {
    if (/^\/movies\//.test(path)) {
      path = path.replace(/\/+$/, "") + "/watch";
    } else {
      const first = await firstEpisode(id);
      if (!first) throw kino.error("not_found", "sin episodios " + id);
      path = first;
    }
  }

  const headers = { Referer: BASE + "/", Origin: BASE, "User-Agent": HEADERS["User-Agent"] };
  const answer = await kino.fetch(BASE + path, { headers: HEADERS });
  if (answer.status === 404) throw kino.error("not_found", "watch 404");
  if (!answer.ok) throw kino.error("unavailable", "watch " + answer.status);

  const data = json(await body(answer), "content-data");
  const all = [];
  for (const category of (data && data.playback) || []) {
    for (const option of category.playback_options || []) all.push({ cat: String(category.name || ""), option });
  }
  const wanted = pick ? parseInt(pick, 10) : -1;
  let chosen = wanted >= 0 && all[wanted] && all[wanted].option.url ? all[wanted] : undefined;
  if (!chosen) chosen = all.find((x) => x.option.url && x.option.ready && x.option.active) || all.find((x) => x.option.url && !x.option.failed);
  if (!chosen) throw kino.error("not_found", "sin servidor", { userMessage: "Este título no tiene ningún servidor disponible ahora." });

  const option = chosen.option;
  const videoUrl = media(option.url);
  if (!videoUrl) throw kino.error("unavailable", "url rara");

  const alternatives = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i] === chosen || !all[i].option.url) continue;
    alternatives.push({ label: (all[i].cat + " · " + (all[i].option.name || "Servidor")).slice(0, 48), ref: id + "|" + path + "#" + i });
    if (alternatives.length >= 8) break;
  }

  const subtitles = [];
  for (const track of option.subtitles || []) {
    const trackUrl = media(track.url);
    if (!trackUrl) continue;
    subtitles.push({ lang: String(track.language_code || "und").slice(0, 16), url: trackUrl, format: "vtt" });
    if (subtitles.length >= 30) break;
  }

  const handle = "k:" + id + "|" + encodeURIComponent(videoUrl);
  const built = await index(id, videoUrl, headers);
  built.initHash = (/\/stream\/([a-z0-9]+)\./i.exec(built.list[0].url) || [])[1];
  built.masks = (option.audio_tracks || []).map((tr) => tr.track_identifier);
  streams.set(handle, built);
  await keyFor(built);

  const stream = {
    source: "plugin",
    handle,
    size: built.size,
    mime: "video/mp4",
    label: (chosen.cat + " · " + (option.name || "Servidor")).slice(0, 40),
    subtitles,
  };
  if (alternatives.length) stream.alternatives = alternatives;
  log("resolve: bytes=" + built.size + " tramos=" + built.list.length + " subs=" + subtitles.length);
  return stream;
}

// ── Pantalla ────────────────────────────────────────────────────────────────
async function detail(ref) {
  const [id, path] = splitRef(ref);
  const kind = AS_SERIES.has(path.split("/")[1] || "") ? "series" : "movie";
  const info = { id: (kind === "series" ? "s" : "m") + id, kind, ref, title: "Kimera", poster: undefined, synopsis: "", episodes: [] };
  if (kind === "series") {
    const r = await episodes(ref);
    info.title = r.series.title;
    info.poster = r.series.poster;
    info.episodes = r.episodes.slice(0, 80).map((e) => ({ season: e.season, number: e.number, ref: e.ref, title: e.title }));
    return info;
  }
  const answer = await kino.fetch(BASE + path, { headers: HEADERS });
  if (answer.ok) {
    const data = json(await body(answer), "content-data");
    if (data && data.title) {
      info.title = decode(data.title.name).slice(0, 200) || info.title;
      info.poster = media(data.title.cover_url);
      info.synopsis = decode(String(data.title.description || "")).slice(0, 600);
    }
  }
  return info;
}

function playArg(info, episode) {
  return { ref: episode ? episode.ref : info.ref, kind: info.kind, id: info.id, title: info.title };
}

function loaded(info) {
  const out = [];
  if (info.poster) out.push({ type: "Image", url: info.poster, alt: info.title, height: 220 });
  out.push({ type: "Text", text: info.title, maxLines: 3, canRequestFocus: true });
  out.push({ type: "Text", text: info.kind === "series" ? t("Serie", "Series") : t("Película", "Movie"), canRequestFocus: true });
  if (info.synopsis) out.push({ type: "Text", text: info.synopsis, maxLines: 6, canRequestFocus: true });
  out.push({
    type: "Row",
    children: [
      { type: "ElevatedButton", labelText: t("Reproducir", "Play"), labelTextEn: "Play", icon: "play", onPressed: { go: { play: playArg(info) } } },
      { type: "OutlinedButton", labelText: t("Compartir", "Share"), labelTextEn: "Share", icon: "share", onPressed: { event: "share" } },
    ],
  });
  if (info.episodes.length) {
    out.push({ type: "Text", text: t("Episodios", "Episodes"), canRequestFocus: true });
    for (const ep of info.episodes) {
      out.push({
        type: "ListTile",
        title: { type: "Text", text: ep.title },
        subtitle: { type: "Text", text: "T" + ep.season + " · E" + ep.number },
        trailing: { type: "IconButton", icon: "play", labelText: t("Reproducir", "Play"), labelTextEn: "Play", onPressed: { go: { play: playArg(info, ep) } } },
        onTap: { go: { play: playArg(info, ep) } },
      });
    }
  }
  return out;
}

export async function screen({ state }) {
  await null;
  const info = state && state.data;
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar",
      mergeWithKinoBar: true,
      dense: true,
      title: (info && info.title) || "Kimera",
      leading: { type: "IconButton", icon: "close", labelText: t("Cerrar", "Close"), labelTextEn: "Close", onPressed: { close: true } },
    },
    body: {
      type: "SingleChildScrollView",
      children: info ? loaded(info) : [{ type: "Skeleton", height: 220 }, { type: "Skeleton" }, { type: "Skeleton" }],
    },
  };
}

export async function screenEvent({ name, state, route }) {
  await null;
  const info = state && state.data;
  const ref = (route && route.args && route.args.ref) || (state && state.ref) || "";

  if (name === "open") {
    if (!ref) return { state: { data: { kind: "movie", title: "Kimera", episodes: [] } } };
    try {
      return { state: { ref, data: await detail(ref) } };
    } catch (error) {
      log("pantalla: " + (error.message || error));
      return { toast: t("No se pudo abrir la ficha", "Could not open the title") };
    }
  }

  if (name === "share") {
    if (!info) return { toast: t("Todavía está cargando", "Still loading") };
    if (!kino.plugins) return { toast: t("Actualiza Kino para compartir", "Update Kino to share") };
    try {
      const answer = await kino.plugins.call("social", "share", {
        text: t("Te recomiendo «" + info.title + "» en Kimera", "I recommend \"" + info.title + "\" on Kimera"),
        title: { kind: info.kind === "series" ? "series" : "movie" },
        from: "kimera",
      });
      if (answer && answer.provider_missing) return { go: { installPlugin: { repo: SOCIAL } } };
      return { toast: t("El borrador te espera en Kino Social", "Your draft waits in Kino Social") };
    } catch (error) {
      log("compartir: " + (error.message || error));
      return { toast: t("No se pudo abrir Kino Social", "Could not open Kino Social") };
    }
  }

  return null;
}