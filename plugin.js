// PelisForte - películas (v0.1.0, con diagnóstico de reproducción).
const SITE = "https://www2.pelisforte.se";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const HOME_ROW = 20;
const enc = encodeURIComponent;

function log(...a) { try { kino.log(...a); } catch { /* sin registro */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function dec(s) { try { return decodeURIComponent(s); } catch { return String(s || ""); } }
function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}
function stripTags(s) { return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")); }

async function getText(url, headers) {
  let r;
  try {
    r = await kino.fetch(url, { headers: Object.assign({ "User-Agent": UA, "Accept-Language": "es-MX,es;q=0.9", Referer: SITE + "/" }, headers || {}) });
  } catch (e) {
    log("fetch falló " + url.slice(0, 80) + " " + String((e && e.message) || e).slice(0, 60));
    throw kino.error("unavailable", "fetch falló", { userMessage: tr("No se pudo abrir el sitio. Prueba de nuevo en un momento.", "Could not open the site. Try again in a moment.") });
  }
  if (!r.ok) {
    log("fetch " + url.slice(0, 80) + " status=" + r.status);
    const um = { userMessage: tr("El sitio respondió con el error " + r.status + ".", "The site answered with error " + r.status + ".") };
    if (r.status === 404) throw kino.error("not_found", "404", um);
    throw kino.error("unavailable", "status " + r.status, um);
  }
  return r.text();
}

// ---- Tarjetas ------------------------------------------------------------------------------------
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<li id="post-\d+"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html))) {
    const b = m[1];
    const href = (/<a href="(https?:\/\/[^"]*\/pelicula\/[^"]+)"[^>]*class="lnk-blk"/i.exec(b) || /<a href="(https?:\/\/[^"]*\/pelicula\/[^"]+)"/i.exec(b) || [])[1];
    if (!href) continue;
    const title = stripTags((/<h2 class="entry-title">([\s\S]*?)<\/h2>/i.exec(b) || [])[1] || "");
    const img = (/<img[^>]*\ssrc="([^"]+)"/i.exec(b) || [])[1] || "";
    const year = Number((/<span class="year">(\d{4})</i.exec(b) || [])[1]) || undefined;
    const path = href.replace(/^https?:\/\/[^/]+/, "");
    if (!title || seen.has(path)) continue;
    seen.add(path);
    const num = (/-(\d+)$/.exec(path) || [])[1] || String(out.length);
    out.push({
      id: "pf-" + num,
      ref: "m|" + enc(path) + "|" + enc(title.slice(0, 80)),
      title: title.slice(0, 200),
      kind: "movie",
      genres: ["peliculas"],
      year,
      poster: /^https?:/.test(img) ? img.replace(/-\d+x\d+(\.\w+)$/, "$1") : undefined,
    });
  }
  return out;
}

async function listPage(path, n) {
  const url = SITE + (n > 1 ? path.replace(/\/$/, "") + "/page/" + n : path);
  const html = await getText(url);
  const items = parseCards(html);
  const hasNext = items.length >= 10 && /\/page\/\d+/.test(html);
  return { items, hasNext };
}

const SECTIONS = {
  nuevas: { path: "/todas-las-peliculas", title: ["Últimas películas", "Latest movies"] },
  latino: { path: "/pelis/idiomas/espanol-latino", title: ["Español Latino", "Latin Spanish"] },
  accion: { path: "/peliculas/accion-p01", title: ["Acción", "Action"] },
  drama: { path: "/peliculas/drama", title: ["Drama", "Drama"] },
};

export async function home() {
  await null;
  const ids = Object.keys(SECTIONS);
  const res = await Promise.allSettled(ids.map((id) => listPage(SECTIONS[id].path, 1)));
  const rows = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("home: falló " + ids[i] + " " + String((r.reason && r.reason.message) || r.reason).slice(0, 60)); return; }
    const items = r.value.items.slice(0, HOME_ROW);
    if (items.length) rows.push({ id: "row-" + ids[i], title: tr(SECTIONS[ids[i]].title[0], SECTIONS[ids[i]].title[1]), genre: "peliculas", ref: ids[i], items });
  });
  log("home filas=" + rows.length);
  if (!rows.length) throw kino.error("unavailable", "inicio sin resultados");
  return rows;
}

export async function browse(ref, cursor) {
  await null;
  const sec = SECTIONS[String(ref || "")];
  if (!sec) throw kino.error("not_found", "catálogo desconocido");
  const n = Math.max(1, parseInt(cursor, 10) || 1);
  const p = await listPage(sec.path, n);
  const out = { items: p.items };
  if (p.hasNext) out.next = String(n + 1);
  return out;
}

export async function search(query) {
  await null;
  const q = stripTags(query && query.q).slice(0, 100);
  if (!q) return [];
  const html = await getText(SITE + "/?s=" + enc(q));
  const items = parseCards(html);
  log("búsqueda: " + items.length + " películas");
  return items;
}

export async function episodes(ref) {
  await null;
  const p = String(ref || "").split("|");
  if (p[0] !== "m" || !p[1]) throw kino.error("not_found", "referencia desconocida");
  return { series: { title: dec(p[2] || "") }, episodes: [{ season: 1, number: 1, ref: "p|" + p[1], title: tr("Película", "Movie") }] };
}

// ---- Reproducción (diagnóstico) -----------------------------------------------------------------
function pageOptions(html) {
  const labels = [];
  const lre = /<a class="btn[^"]*" href="#options-(\d+)">[\s\S]*?<span class="server">([\s\S]*?)<\/span>/gi;
  let m;
  while ((m = lre.exec(html))) labels[Number(m[1])] = stripTags(m[2]);
  const out = [];
  const re = /<div id="options-(\d+)"[^>]*>[\s\S]*?<iframe[^>]*data-src="([^"]+)"/gi;
  while ((m = re.exec(html))) out.push({ n: Number(m[1]), url: decodeEntities(m[2]), label: labels[Number(m[1])] || "Opción " + (Number(m[1]) + 1) });
  return out;
}

function findMedia(t) {
  const s = String(t || "").replace(/\\\//g, "/");
  const m = /https?:\/\/[^"'\s<>\\]+\.(?:m3u8|mp4)[^"'\s<>\\]*/i.exec(s);
  return m ? m[0] : null;
}

export async function resolve(ref) {
  await null;
  const p = String(ref || "").split("|");
  if ((p[0] !== "p" && p[0] !== "m") || !p[1]) throw kino.error("not_found", "referencia desconocida");
  const pageUrl = SITE + dec(p[1]);
  const html = await getText(pageUrl);
  const opts = pageOptions(html);
  log("opciones: " + opts.length + " -> " + opts.map((o) => o.label).join(" | "));
  if (!opts.length) throw kino.error("not_found", "sin opciones", { userMessage: tr("Esta película aún no tiene video.", "This movie has no video yet.") });

  // Diagnóstico: mp4.nu -> r.php?h=... -> servidor real
  const hdr = (r, k) => { try { return (r.headers && (r.headers.get ? r.headers.get(k) : r.headers[k])) || ""; } catch (e) { return ""; } };
  for (const o of opts.slice(0, 3)) {
    try {
      const H = { "User-Agent": UA, Referer: pageUrl, "Accept-Language": "es-MX,es;q=0.9" };
      const r = await kino.fetch(o.url, { headers: H });
      const t = String(await r.text());
      const rp = /location\.replace\("([^"]+)"/.exec(t);
      if (!rp) { log("dbg " + o.label + " sin r.php"); continue; }
      const next = new URL(rp[1], o.url).href;
      log("dbg " + o.label + " next=" + next.slice(0, 60));
      const r2 = await kino.fetch(next, { headers: Object.assign({}, H, { Referer: o.url }), redirect: "manual" });
      const t2 = String(await r2.text());
      log("dbg r2 status=" + r2.status + " url=" + String(r2.url || "").slice(0, 120) + " loc=" + hdr(r2, "location").slice(0, 160) + " largo=" + t2.length);
      const loc = hdr(r2, "location");
      let t3 = "";
      if (loc) {
        const H3 = Object.assign({}, H, { Referer: "https://mp4.nu/" });
        const r3 = await kino.fetch(loc, { headers: H3 });
        t3 = String(await r3.text());
        log("dbg r3 status=" + r3.status + " largo=" + t3.length + " eval=" + /eval\(function\(p,a,c,k,e/.test(t3));
        const c = t3.replace(/\s+/g, " ");
        const st = Math.max(0, c.indexOf("<body"));
        for (let i = 0; i < 2400 && st + i < c.length; i += 600) log("dbg r3parte" + (i / 600 + 1) + ": " + c.slice(st + i, st + i + 600));
        const m3 = /(?:file|src|source|sources)["']?\s*[:=]\s*["']([^"']+)["']/i.exec(c);
        log("dbg r3file=" + (m3 ? m3[1].slice(0, 200) : "-"));
        const mm = c.match(/https?:\/\/[^"'\s<>\\]+/g) || [];
        log("dbg r3urls=" + mm.filter((u) => !/google|yandex|cloudflare|jquery|jsdelivr/.test(u)).slice(0, 8).join(" "));
      }
      const media = findMedia(t3) || findMedia(t2);
      log("dbg media=" + (media || "-"));
      if (media) return { url: media, mime: /\.m3u8/i.test(media) ? "application/x-mpegurl" : "video/mp4", headers: { Referer: next } };
    } catch (e) {
      log("dbg " + o.label + " falló " + String((e && e.message) || e).slice(0, 120));
    }
  }
  throw kino.error("not_found", "sin video directo", { userMessage: tr("Aún no se puede reproducir este título.", "This title cannot be played yet.") });
}
