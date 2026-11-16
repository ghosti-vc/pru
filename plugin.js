// Sitios (prueba 0.1.0): revisa varios sitios de películas y series y anota en el log cómo están hechos.
// Solo lee páginas públicas. No resuelve verificaciones, captchas ni cuentas: si un sitio las pide, solo lo anota.

const UA = "Mozilla/5.0 (Linux; Android 13; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const SITES = [
  ["sl", "SoloLatino", "https://sololatino.net"],
  ["fp", "FanPelis", "https://fanpelis.to"],
  ["c2", "Cine24h", "https://cine24h.online"],
  ["fl", "FlixLatam", "https://flixlatam.com"],
  ["ch", "Cinehax", "https://cinehax.com"],
  ["pp", "PelisPlusHD", "https://www.pelisplushd.la"],
];

function log(...a) { try { kino.log(...a); } catch (e) { /* no romper */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function fail(code, detail, es, en) { return kino.error(code, detail, { userMessage: tr(es, en) }); }
function dec(s) {
  return String(s || "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function abs(base, u) {
  u = String(u || "").trim();
  if (!u) return "";
  if (u.startsWith("//")) return "https:" + u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.charAt(0) === "/") return base + u;
  return "";
}

async function get(url) {
  const r = await kino.fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es", Accept: "text/html,application/json" } });
  const t = await r.text();
  return { status: r.status, ok: r.ok, text: t };
}

// Tarjetas genéricas: un enlace que contiene una imagen con título (alt) o un atributo title.
function parseCards(base, html) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,900}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 60) {
    const href = abs(base, m[1]);
    if (!href || href.indexOf(base.replace(/^https?:\/\/(www\.)?/, "")) < 0 || seen.has(href)) continue;
    const img = /<img\b[^>]*>/i.exec(m[2]);
    if (!img) continue;
    const alt = /\balt="([^"]{2,})"/i.exec(img[0]) || /\btitle="([^"]{2,})"/i.exec(m[0]);
    const src = /\b(?:data-src|data-lazy-src|src)="([^"]+)"/i.exec(img[0]);
    const title = dec(alt ? alt[1] : "").replace(/^(ver|póster|poster|imagen)\s+/i, "");
    if (!title || title.length < 2) continue;
    seen.add(href);
    out.push({ href, title, poster: src ? abs(base, dec(src[1])) : "" });
  }
  return out;
}

// Informe de un sitio (solo lectura): estado, tipo de protección, motor probable y rutas útiles.
async function diag(site) {
  const [id, name, base] = site;
  const rep = [name];
  try {
    const h = await get(base + "/");
    const t = h.text;
    rep.push("status=" + h.status, "largo=" + t.length);
    if (/just a moment|cf-chl|challenge-platform|captcha|verify you are human|turnstile/i.test(t)) rep.push("PIDE_VERIFICACION");
    const gen = /<meta name="generator" content="([^"]+)"/i.exec(t);
    if (gen) rep.push("generador=" + gen[1].slice(0, 30));
    if (/wp-content|wp-json/i.test(t)) rep.push("wordpress");
    if (/__NEXT_DATA__|_next\/static/i.test(t)) rep.push("nextjs");
    if (/wp-api\/v1/i.test(t)) rep.push("wp-api/v1");
    const cards = parseCards(base, t);
    rep.push("tarjetas=" + cards.length);
    const paths = {};
    const hre = /href="(\/[a-z0-9_-]+)\//gi;
    let hm;
    while ((hm = hre.exec(t))) paths[hm[1]] = (paths[hm[1]] || 0) + 1;
    rep.push("rutas=" + Object.keys(paths).sort((a, b) => paths[b] - paths[a]).slice(0, 8).join(","));
    if (cards[0]) rep.push("ej=" + cards[0].href.replace(base, "").slice(0, 50));
    log("DIAG " + rep.join(" | "));
    // Prueba de búsqueda del sitio (para saber la forma de la dirección).
    for (const p of ["/?s=amor", "/search?q=amor", "/buscar?q=amor"]) {
      try {
        const s = await get(base + p);
        const n = parseCards(base, s.text).length;
        log("DIAG " + name + " búsqueda " + p + " status=" + s.status + " tarjetas=" + n);
        if (n) break;
      } catch (e) { log("DIAG " + name + " búsqueda " + p + " falló"); }
    }
    return cards.map((c) => ({ id: id + "-" + c.href.replace(/[^a-z0-9]+/gi, "-").slice(-60), ref: "p|" + encodeURIComponent(c.href), title: c.title.slice(0, 200), kind: "series", genres: ["series"], poster: c.poster || undefined }));
  } catch (e) {
    log("DIAG " + name + " falló: " + String((e && e.message) || e).slice(0, 80));
    return [];
  }
}

export async function home() {
  await null;
  const res = await Promise.allSettled(SITES.map((s) => diag(s)));
  const rows = [];
  res.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length) rows.push({ id: "row-" + SITES[i][0], title: SITES[i][1], genre: "series", ref: SITES[i][0], items: r.value.slice(0, 20) });
  });
  if (!rows.length) throw fail("unavailable", "ningún sitio respondió", "Ningún sitio respondió. Mira el registro para ver el motivo.", "No site answered. Check the log for the reason.");
  return rows;
}

export async function browse(ref) {
  await null;
  const site = SITES.find((s) => s[0] === String(ref));
  if (!site) throw fail("not_found", "sitio desconocido", "Ese catálogo no existe.", "That catalog does not exist.");
  return { items: await diag(site) };
}

export async function search(query) {
  await null;
  const q = String((query && query.q) || "").trim().slice(0, 80);
  if (!q) return [];
  const res = await Promise.allSettled(SITES.map(async ([id, name, base]) => {
    const s = await get(base + "/?s=" + encodeURIComponent(q));
    const cards = parseCards(base, s.text);
    log("BUSCAR " + name + " status=" + s.status + " tarjetas=" + cards.length);
    return cards.slice(0, 12).map((c) => ({ id: id + "-" + c.href.replace(/[^a-z0-9]+/gi, "-").slice(-60), ref: "p|" + encodeURIComponent(c.href), title: c.title.slice(0, 200), kind: "series", genres: ["series"], poster: c.poster || undefined }));
  }));
  const out = [];
  res.forEach((r) => { if (r.status === "fulfilled") out.push.apply(out, r.value); });
  return out;
}

// Al abrir un título: se anota cómo está hecha su página (capítulos, reproductores) para la siguiente versión.
export async function episodes(ref) {
  await null;
  const url = decodeURIComponent(String(ref || "").slice(2));
  if (!/^https:\/\//i.test(url)) throw fail("not_found", "referencia desconocida", "No se encontró este título.", "Title not found.");
  const h = await get(url);
  const t = h.text;
  log("TÍTULO " + url.slice(0, 80) + " status=" + h.status + " largo=" + t.length);
  const ep = (t.match(/href="[^"]*(?:episodio|capitulo|temporada|season|episode)[^"]*"/gi) || []).slice(0, 6);
  ep.forEach((x, i) => log("TÍTULO ep" + i + " " + x.slice(0, 120)));
  const ifr = (t.match(/<iframe[^>]+src="[^"]+"/gi) || []).slice(0, 4);
  ifr.forEach((x, i) => log("TÍTULO iframe" + i + " " + x.slice(0, 160)));
  const js = (t.match(/(?:data-(?:id|post|player|server|src|url)|player_data|embed_url)[^>\n]{0,100}/gi) || []).slice(0, 6);
  js.forEach((x, i) => log("TÍTULO dato" + i + " " + x.slice(0, 140)));
  const title = dec((/<title>([^<]*)<\/title>/i.exec(t) || [, ""])[1]).replace(/\s*[|\-–].*$/, "");
  return { series: { title: title || "Título" }, episodes: [{ season: 1, number: 1, ref: ref, title: tr("Ver", "Watch") }] };
}

export async function resolve(ref) {
  await null;
  throw fail("unavailable", "prueba", "Esta versión es solo de prueba y todavía no reproduce. Manda el registro.", "This is a test build and does not play yet. Send the log.");
}
