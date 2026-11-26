
// PELISKronos: catálogo desde Cinemeta, enlaces desde el addon KRONOS4K.
const CINEMETA = "https://v3-cinemeta.strem.io";
const ADDON = "https://addons.4rever.cc";
// Addons de respaldo (formato Stremio). Se usan solo si el principal falla o no trae enlaces.
// Pega aquí la URL base del addon (sin /manifest.json). Debe devolver enlaces https directos.
const BACKUPS = [
  // "https://ejemplo-addon.com",
];

const es = () => String(kino.lang || "es-CO").toLowerCase().indexOf("es") === 0;
const t = (a, b) => (es() ? a : b);

const GENRES = {
  action: "accion", adventure: "aventura", animation: "animacion",
  comedy: "comedia", crime: "crimen", documentary: "documental",
  drama: "drama", family: "familia", fantasy: "fantasia",
  history: "historia", horror: "terror", music: "musical",
  mystery: "misterio", romance: "romance",
  "science fiction": "ciencia-ficcion", "sci-fi": "ciencia-ficcion",
  thriller: "suspenso", war: "guerra", western: "western",
};

async function getJson(url) {
  const r = await kino.fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw kino.error("unavailable", "http " + r.status + " " + url.slice(0, 70));
  try {
    return await r.json();
  } catch (e) {
    throw kino.error("unavailable", "json invalido");
  }
}

function genreOf(list) {
  if (!Array.isArray(list)) return undefined;
  const out = [];
  for (const g of list) {
    const k = GENRES[String(g).toLowerCase()];
    if (k && out.indexOf(k) < 0) out.push(k);
  }
  return out.length ? out : undefined;
}


// ---- Catálogo en español desde TMDB (kino.tmdb: la llave la pone Kino, el plugin no guarda ninguna) --------
// Si este Kino no trae kino.tmdb o TMDB falla, se usa Cinemeta como antes.
const TM_GENRES = {
  28: "accion", 12: "aventura", 16: "animacion", 35: "comedia", 80: "crimen", 99: "documental", 18: "drama",
  10751: "familia", 14: "fantasia", 36: "historia", 27: "terror", 10402: "musical", 9648: "misterio",
  10749: "romance", 878: "ciencia-ficcion", 53: "suspenso", 10752: "guerra", 37: "western",
  10759: "accion", 10765: "ciencia-ficcion", 10768: "guerra",
};
async function tm(path, params, ms) {
  if (typeof kino.tmdb !== "function") throw kino.error("unavailable", "sin kino.tmdb");
  return await withTimeout(kino.tmdb(path, params || {}), ms || 7000);
}
function tmItem(r, type) {
  if (!r || !r.id) return null;
  const movie = type === "movie";
  const title = String((movie ? r.title : r.name) || "").trim();
  if (!title) return null;
  const id = (movie ? "tmm_" : "tms_") + r.id;
  const item = { id: id, ref: id, kind: movie ? "movie" : "series", title: title.slice(0, 200), ids: { tmdb: r.id } };
  if (r.poster_path) item.poster = "https://image.tmdb.org/t/p/w500" + r.poster_path;
  if (r.backdrop_path) item.backdrop = "https://image.tmdb.org/t/p/w780" + r.backdrop_path;
  if (r.overview) item.overview = String(r.overview).slice(0, 1800);
  const orig = String((movie ? r.original_title : r.original_name) || "").trim();
  if (orig && normTitle(orig) !== normTitle(title)) item.originalTitle = orig;
  const g = [];
  for (const n of r.genre_ids || []) { const k = TM_GENRES[n]; if (k && g.indexOf(k) < 0) g.push(k); }
  if (g.length) item.genres = g;
  const ym = /^(\d{4})/.exec(String((movie ? r.release_date : r.first_air_date) || ""));
  if (ym && Number(ym[1]) > 1800) item.year = Number(ym[1]);
  if (typeof r.vote_average === "number" && r.vote_average > 0 && r.vote_average <= 10) item.rating = Math.round(r.vote_average * 10) / 10;
  return item;
}
// Número de IMDb (tt…) de un título de TMDB: el addon KRONOS lo pide por ese número.
const EXT = {};
async function tmToImdb(ref) {
  const m = /^tm([ms])_(\d+)$/.exec(String(ref || ""));
  if (!m) return ref;
  const key = m[1] + m[2];
  if (!EXT[key]) {
    EXT[key] = (async () => {
      const d = await tm("/" + (m[1] === "m" ? "movie/" : "tv/") + m[2] + "/external_ids", {});
      const imdb = d && d.imdb_id;
      if (!imdb || !/^tt\d+$/.test(imdb)) throw kino.error("not_found", "sin número de IMDb");
      return imdb;
    })();
    EXT[key].catch(() => { delete EXT[key]; });
  }
  return await EXT[key];
}

function toItem(m) {
  if (!m) return null;
  const id = m.imdb_id || m.id;
  if (!id || !/^[A-Za-z0-9._~-]{1,128}$/.test(id)) return null;
  // Campos que entiende Kino: id, ref, title, kind ("movie" | "series"), poster, year (igual que los demás plugins).
  const item = {
    id: id,
    ref: id,
    kind: m.type === "series" ? "series" : "movie",
    title: m.name || id,
    ids: { imdb: id },
  };
  if (m.poster) item.poster = m.poster;
  if (m.background) item.backdrop = m.background;
  if (m.description) item.overview = m.description;
  const g = genreOf(m.genre);
  if (g) item.genres = g;
  const year = m.releaseInfo ? parseInt(String(m.releaseInfo).slice(0, 4), 10) : 0;
  if (year > 1800 && year < 2100) item.year = year;
  return item;
}

function labelOf(s) {
  const raw = String(s.name || s.title || "")
    .replace(/[📦🌐⚡📁🔊🎞]/g, " ")
    .replace(/\s*\n\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, 48);
}

const ROWS = [
  ["peli-top", "movie", "top", "peliculas", "Películas destacadas", "Featured movies"],
  ["peli-rating", "movie", "imdbRating", "peliculas", "Mejor valoradas", "Top rated movies"],
  ["serie-top", "series", "top", "series", "Series destacadas", "Featured series"],
  ["serie-rating", "series", "imdbRating", "series", "Series mejor valoradas", "Top rated series"],
  ["accion", "movie", "top/genre=Action", "accion", "Acción", "Action"],
  ["comedia", "movie", "top/genre=Comedy", "comedia", "Comedia", "Comedy"],
  ["drama", "movie", "top/genre=Drama", "drama", "Drama", "Drama"],
  ["terror", "movie", "top/genre=Horror", "terror", "Terror", "Horror"],
  ["suspenso", "movie", "top/genre=Thriller", "suspenso", "Suspenso", "Thriller"],
  ["scifi", "movie", "top/genre=Science%20Fiction", "ciencia-ficcion", "Ciencia ficción", "Sci-fi"],
  ["romance", "movie", "top/genre=Romance", "romance", "Romance", "Romance"],
  ["animacion", "series", "top/genre=Animation", "animacion", "Animación", "Animation"],
  ["documental", "series", "top/genre=Documentary", "documentales", "Documentales", "Documentaries"],
];

// Cada fila: id, tipo, ruta TMDB, parámetros, género, título es/en.
const TM_ROWS = [
  ["peli-top", "movie", "/movie/popular", {}],
  ["peli-rating", "movie", "/movie/top_rated", {}],
  ["serie-top", "tv", "/tv/popular", {}],
  ["serie-rating", "tv", "/tv/top_rated", {}],
  ["accion", "movie", "/discover/movie", { with_genres: "28" }],
  ["comedia", "movie", "/discover/movie", { with_genres: "35" }],
  ["drama", "movie", "/discover/movie", { with_genres: "18" }],
  ["terror", "movie", "/discover/movie", { with_genres: "27" }],
  ["suspenso", "movie", "/discover/movie", { with_genres: "53" }],
  ["scifi", "movie", "/discover/movie", { with_genres: "878" }],
  ["romance", "movie", "/discover/movie", { with_genres: "10749" }],
  ["animacion", "tv", "/discover/tv", { with_genres: "16" }],
  ["documental", "tv", "/discover/tv", { with_genres: "99" }],
];
export async function home() {
  const jobs = ROWS.map(async (row, i) => {
    const tr = TM_ROWS[i];
    let items = [];
    try {
      const params = Object.assign({ language: "es-MX", page: 1 }, tr[3]);
      if (tr[2].indexOf("/discover/") === 0) { params.sort_by = "popularity.desc"; params["vote_count.gte"] = "50"; }
      const d = await tm(tr[2], params);
      items = ((d && d.results) || []).map((r) => tmItem(r, tr[1])).filter(Boolean).slice(0, 40);
    } catch (e) {
      kino.log("home: TMDB falló en " + row[0] + " (" + String((e && e.message) || e).slice(0, 50) + "), uso Cinemeta");
    }
    if (!items.length) {
      const data = await getJson(CINEMETA + "/catalog/" + row[1] + "/" + row[2] + ".json");
      items = (data.metas || []).map(toItem).filter(Boolean).slice(0, 40);
    }
    if (!items.length) return null;
    return { id: row[0], title: t(row[4], row[5]), genre: row[3], items: items };
  });
  const out = await Promise.all(jobs.map((j, i) => j.catch((e) => {
    kino.log("home: falló " + ROWS[i][0] + " " + String((e && e.message) || e).slice(0, 80));
    return null;
  })));
  const rows = out.filter(Boolean);
  kino.log("home: " + rows.length + " filas");
  if (!rows.length) throw kino.error("unavailable", "sin catálogo", { userMessage: t("No pude cargar el catálogo ahora.", "Could not load the catalog now.") });
  return rows;
}

export async function search(query) {
  await null;
  const raw = typeof query === "string" ? query : (query && (query.q || query.query || query.text || query.term)) || "";
  const q = String(raw).trim();
  if (!q) return [];
  if (typeof kino.tmdb === "function") {
    try {
      const d = await tm("/search/multi", { query: q, language: "es-MX", include_adult: false, page: 1 });
      const res = [];
      for (const r of (d && d.results) || []) {
        if (r.media_type !== "movie" && r.media_type !== "tv") continue;
        const it = tmItem(r, r.media_type);
        if (it) res.push(it);
        if (res.length >= 60) break;
      }
      kino.log("búsqueda TMDB: " + res.length);
      if (res.length) return res;
    } catch (e) {
      kino.log("búsqueda: TMDB falló (" + String((e && e.message) || e).slice(0, 50) + "), uso Cinemeta");
    }
  }
  const enc = encodeURIComponent(q);
  const urls = [
    CINEMETA + "/catalog/movie/top/search=" + enc + ".json",
    CINEMETA + "/catalog/series/top/search=" + enc + ".json",
  ];
  const parts = await Promise.all(urls.map(async (u) => {
    try {
      const d = await getJson(u);
      return (d.metas || []).map(toItem).filter(Boolean);
    } catch (e) {
      kino.log("búsqueda: falló " + String((e && e.message) || e).slice(0, 80));
      return [];
    }
  }));
  const seen = {};
  const out = [];
  for (const list of parts) {
    for (const it of list) {
      if (seen[it.id]) continue;
      seen[it.id] = 1;
      out.push(it);
      if (out.length >= 60) return out;
    }
  }
  return out;
}

export async function episodes(ref) {
  await null;
  ref = await tmToImdb(ref);
  const id = String(ref || "").split(":")[0];
  if (!/^tt\d+$/.test(id)) throw kino.error("not_found", "ref " + ref);
  const data = await getJson(CINEMETA + "/meta/series/" + id + ".json");
  const meta = data.meta || {};
  const vids = Array.isArray(meta.videos) ? meta.videos : [];
  const eps = [];
  const seasons = {};
  for (const v of vids) {
    const season = Number(v.season) || 0;
    const number = Number(v.number) || 0;
    if (!number) continue;
    const epRef = id + ":" + season + ":" + number;
    eps.push({
      id: epRef.replace(/:/g, "-"),
      ref: epRef,
      title: v.name || v.title || t("Episodio", "Episode") + " " + number,
      season: season,
      number: number,
      poster: v.thumbnail || undefined,
      overview: v.overview || undefined,
    });
    if (!seasons[season]) {
      seasons[season] = season === 0 ? t("Especiales", "Specials") : t("Temporada", "Season") + " " + season;
    }
  }
  if (!eps.length) throw kino.error("not_found", "sin episodios", { userMessage: "Esta serie no tiene episodios cargados." });
  eps.sort((a, b) => a.season - b.season || a.number - b.number);
  return {
    episodes: eps,
    seasons: Object.keys(seasons).map((s) => ({ season: Number(s), name: seasons[s] })),
  };
}

// Cabeceras que el addon pide para abrir el enlace (convención de Stremio: behaviorHints.proxyHeaders.request).
function headersOf(s) {
  const bh = (s && s.behaviorHints) || {};
  const req = bh.proxyHeaders && bh.proxyHeaders.request;
  const out = {};
  if (req && typeof req === "object") {
    for (const k of Object.keys(req)) if (typeof req[k] === "string") out[k] = req[k];
  }
  return out;
}

function hostOf(u) {
  const m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || ""));
  return m ? m[1].toLowerCase() : "";
}

const isHls = (u) => !/\.(mp4|mkv|webm)(\?|$)/i.test(String(u || ""));

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Cabeceras de navegador para el reproductor: algunos servidores dan 403 si el cliente no se identifica como navegador.
function browserHeaders(url, own) {
  const h = { "User-Agent": UA, Accept: "*/*", "Accept-Language": "es-419,es;q=0.9" };
  const host = hostOf(url);
  if (host) { h.Referer = "https://" + host + "/"; h.Origin = "https://" + host; }
  return Object.assign(h, own || {});
}

async function openManifest(url, headers, ms) {
  try {
    const r = await kino.fetch(url, { headers, timeoutMs: ms });
    if (!r.ok) return { ok: false, why: "http " + r.status };
    const t = String(await r.text()).slice(0, 400);
    return /#EXTM3U/.test(t) ? { ok: true, why: "m3u8" } : { ok: false, why: "no es m3u8: " + t.replace(/\s+/g, " ").slice(0, 40) };
  } catch (e) {
    return { ok: false, why: "error " + String((e && e.code) || (e && e.message) || e).slice(0, 30) };
  }
}

// Abre el manifiesto como lo hará el reproductor (cabeceras de navegador) y, si no, sin ellas; guarda las que funcionaron.
async function check(c, ms) {
  if (!isHls(c.url)) { c.sendHeaders = browserHeaders(c.url, c.headers); return { ok: true, why: "mp4" }; }
  const a = browserHeaders(c.url, c.headers);
  const ra = await openManifest(c.url, a, ms);
  if (ra.ok) { c.sendHeaders = a; return { ok: true, why: "m3u8 con cabeceras" }; }
  if (Object.keys(c.headers || {}).length === 0 && !/^http 40[13]/.test(ra.why)) {
    const rb = await openManifest(c.url, { Accept: "*/*" }, ms);
    if (rb.ok) { c.sendHeaders = {}; return { ok: true, why: "m3u8 sin cabeceras" }; }
    return { ok: false, why: ra.why + " / sin cabeceras: " + rb.why };
  }
  return ra;
}

// Hosts que ya fallaron: no se vuelven a probar durante 10 min (ahorra peticiones; Kino limita las de cada llamada).
const BAD = {};
const CACHE = {};
const badNow = (u) => { const t = BAD[hostOf(u)]; return t && Date.now() - t < 600000; };

async function primary(ref, t0) {
  await null;
  const parts = String(ref || "").split(":");
  const id = parts[0];
  if (!/^tt\d+$/.test(id)) throw kino.error("not_found", "ref " + ref);
  const type = parts.length >= 2 ? "series" : "movie";
  const addonId = type === "series" ? id + ":" + (parts[1] || 1) + ":" + (parts[2] || 1) : id;
  const bases = [ADDON].concat(BACKUPS.map((u) => String(u).replace(/\/manifest\.json$/, "").replace(/\/+$/, "")));
  let data = CACHE[addonId] && Date.now() - CACHE[addonId].t < 600000 ? CACHE[addonId].d : null;
  let lastErr = null;
  for (let i = 0; !data && i < bases.length; i++) {
    const left = 19000 - (Date.now() - t0) - 3000;
    if (i > 0 && left < 3000) break;
    try {
      const r = await kino.fetch(bases[i] + "/stream/" + type + "/" + addonId + ".json", { headers: { Accept: "application/json" }, timeoutMs: i === 0 ? 12000 : Math.min(left, 8000) });
      if (!r.ok) throw kino.error("unavailable", "addon http " + r.status);
      const d = await r.json();
      if (d && Array.isArray(d.streams) && d.streams.some((x) => x && typeof x.url === "string" && x.url.indexOf("https://") === 0)) {
        data = d;
        CACHE[addonId] = { t: Date.now(), d: d };
      } else {
        kino.log("addon " + hostOf(bases[i]) + ": sin enlaces" + (i < bases.length - 1 ? ", pruebo respaldo" : ""));
      }
    } catch (e) {
      lastErr = e;
      kino.log("addon " + hostOf(bases[i]) + ": " + String((e && e.code) || (e && e.message) || e).slice(0, 40) + (i < bases.length - 1 ? ", pruebo respaldo" : ""));
    }
  }
  if (!data) {
    if (lastErr) throw kino.error("unavailable", "addon " + String((lastErr && lastErr.code) || (lastErr && lastErr.message) || lastErr).slice(0, 40), { userMessage: "El addon de enlaces no respondió a tiempo. Prueba de nuevo." });
    data = { streams: [] };
  }
  const seenUrl = {};
  const all = (Array.isArray(data.streams) ? data.streams : [])
    .filter((s) => s && typeof s.url === "string" && s.url.indexOf("https://") === 0 && !seenUrl[s.url] && (seenUrl[s.url] = 1));
  const fresh = all.filter((s) => !badNow(s.url));
  const list = fresh.length ? fresh : all;
  if (!list.length) {
    throw kino.error("not_found", "sin enlaces", { userMessage: "Este título no tiene enlaces disponibles ahora." });
  }
  const cands = list.slice(0, 4).map((s) => ({
    url: s.url,
    mime: /\.mp4(\?|$)/i.test(s.url) ? "video/mp4" : "application/vnd.apple.mpegurl",
    label: labelOf(s),
    headers: headersOf(s),
    hints: Object.keys((s && s.behaviorHints) || {}).join(","),
  }));
  // Se prueban a la vez: así se descartan los que dan 403 antes de entregarlos al reproductor.
  const ms = Math.max(2500, Math.min(6000, 19000 - (Date.now() - t0)));
  const res = await Promise.all(cands.map((c) => check(c, ms)));
  res.forEach((r, i) => kino.log("resolve: " + hostOf(cands[i].url) + " " + (r.ok ? "OK " : "NO ") + r.why + " cabeceras=" + Object.keys(cands[i].headers).length + (cands[i].hints ? " hints=" + cands[i].hints : "")));
  res.forEach((r, i) => { if (!r.ok) BAD[hostOf(cands[i].url)] = Date.now(); });
  const good = cands.filter((c, i) => res[i].ok);
  if (!good.length) {
    throw kino.error("unavailable", "ningún enlace abre (" + res.map((r) => r.why).join(" | ").slice(0, 120) + ")", { userMessage: "Los enlaces de este título rechazan la conexión. Prueba otro título." });
  }
  const mk = (c) => {
    const o = { url: c.url, mime: c.mime, label: c.label };
    if (c.sendHeaders && Object.keys(c.sendHeaders).length) o.headers = c.sendHeaders;
    return o;
  };
  const main = mk(good[0]);
  const alts = good.slice(1).map(mk);
  if (alts.length) main.alternatives = alts;
  return main;
}

// ===== Motor de AllCalidad y de extracción de reproductores (tomado de PelisMAX) =====
const REF = "https://allcalidad.re/";
// Cabeceras con las que el reproductor pide el video: muchos servidores responden 403 si falta el origen o el navegador.
function playHeaders(pageUrl) {
  const m = /^(https?:\/\/[^\/?#]+)/i.exec(String(pageUrl || ""));
  const h = { Referer: pageUrl, "User-Agent": UA };
  if (m) h.Origin = m[1];
  return h;
}


function log(...args) {
  try { kino.log(...args); } catch { /* el registro no debe romper nada */ }
}

// Textos que lee la persona: español por defecto, inglés si kino.lang es "en-US".
function tr(es, en) {
  return (typeof kino !== "undefined" && kino.lang === "en-US") ? en : es;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}


function attr(tag, name) {
  const a = new RegExp(name + "=([\"'])([^\"']*)\\1", "i").exec(tag);
  return a ? a[2] : "";
}

// Forma de la ruta sin el código: /e/xxxx -> "/e/". Sirve para el registro sin filtrar enlaces.
function pathShape(u) {
  const m = /^https?:\/\/[^\/?#]+(\/[^?#]*)?/i.exec(String(u || ""));
  const p = m && m[1] ? m[1] : "";
  return p.replace(/[A-Za-z0-9_-]{8,}/g, "~").slice(0, 40);
}

function absUrl(u) {
  let x = String(u || "").trim();
  if (x.startsWith("//")) x = "https:" + x;
  return /^https:\/\//i.test(x) ? x : "";
}

// -- Lectura de reproductores embebidos ---------------------------------------------------------
// Muchos reproductores esconden el video: dentro de un script "empaquetado" (eval(function(p,a,c,k,e,d)...)
// o en un texto en base64 (atob). Aquí se desarman, sin ejecutar nada, para buscar el .m3u8 / .mp4.


const MEDIA_RE = /["'`]((?:https?:)?\/\/[^"'`\s<>\\]+?\.(?:m3u8|mp4)(?:\?[^"'`\s<>\\]*)?)["'`]/i;

// Videos de prueba que traen los reproductores y sus librerías (Big Buck Bunny y compañía).
// Nunca son el capítulo: se descartan para no mostrarlos por error.
const DEMO_MEDIA = /pinup_preroll|[_\/-]preroll[_.\/-]|agl00\d\.com|big[_-]?buck[_-]?bunny|\bbbb[_-]|sintel|elephants?[_-]?dream|tears[_-]?of[_-]?steel|gtv-videos-bucket|commondatastorage|test-?streams|bitdash|bitmovin|mux\.dev|zencdn|oceans\.mp4|flowplayer\.com|jwplatform|\/samples?\/|(?:googleapis|gstatic|jsdelivr|cdnjs|unpkg)\./i;
// Los enlaces de streamtape.com/e/... son la página del reproductor (no el video) y el sitio responde 403: se descartan.
const isDemo = (u) => DEMO_MEDIA.test(String(u || "")) || /streamtape\.[a-z]+\/e\//i.test(String(u || ""));

function normText(s) {
  return String(s || "").replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/&amp;/g, "&");
}

// Desarma un script empaquetado con el método clásico "p,a,c,k,e,d".
function unpackPacked(src) {
  const re = /\}\s*\(\s*(['"])((?:\\[\s\S]|(?!\1)[^\\])*)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\[\s\S]|(?!\5)[^\\])*)\5\s*\.split\(\s*['"]\|['"]\s*\)/;
  const m = re.exec(src);
  if (!m) return null;
  const payload = m[2].replace(/\\(['"\\])/g, "$1").replace(/\\n/g, "\n");
  const radix = Number(m[3]);
  let count = Number(m[4]);
  if (!(radix >= 2 && radix <= 62) || !(count > 0 && count < 100000)) return null;
  const dict = m[6].split("|");
  const enc = (c) => (c < radix ? "" : enc(Math.floor(c / radix))) + ((c = c % radix) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
  const map = {};
  while (count--) map[enc(count)] = dict[count] || enc(count);
  return payload.replace(/\b\w+\b/g, (w) => (map[w] != null ? map[w] : w));
}

function unpackAll(html) {
  const out = [];
  let i = 0;
  while (out.length < 4) {
    const k = html.indexOf("eval(function(p,a,c,k,e", i);
    if (k < 0) break;
    const u = unpackPacked(html.slice(k, k + 80000));
    if (u) out.push(u);
    i = k + 20;
  }
  return out;
}

function base64Texts(html) {
  const out = [];
  const re = /atob\(\s*["']([A-Za-z0-9+\/=_-]{16,})["']\s*\)/g;
  let m;
  while ((m = re.exec(html)) && out.length < 6) {
    try { out.push(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { /* no era base64 */ }
  }
  return out;
}

function findMedia(text) {
  const re = new RegExp(MEDIA_RE.source, "gi");
  const t = normText(text);
  let m;
  while ((m = re.exec(t))) {
    const u = absUrl(m[1]);
    if (u && !isDemo(u)) return u;
    if (u) log("video de muestra descartado: " + hostOf(u) + pathShape(u));
  }
  return "";
}

// Igual, pero sin exigir comillas: el texto que sale de un base64 suele ser el enlace "pelado".
function findMediaLoose(text) {
  const re = /((?:https?:)?\/\/[^\s"'`<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'`<>\\]*)?)/gi;
  const t = normText(text);
  let m;
  while ((m = re.exec(t))) {
    const u = absUrl(m[1]);
    if (u && !isDemo(u)) return u;
    if (u) log("video de muestra descartado: " + hostOf(u) + pathShape(u));
  }
  return "";
}

// Busca el video escrito en la página, en sus scripts empaquetados o en sus textos base64.
function deepMedia(html) {
  let u = findMedia(html);
  if (u) return u;
  for (const t of unpackAll(html)) { u = findMedia(t); if (u) return u; }
  for (const t of base64Texts(html)) { u = findMediaLoose(t); if (u) return u; }
  return "";
}

const SKIP_HOST = /(google|gstatic|facebook|doubleclick|googletagmanager|cloudflare|jsdelivr|cdnjs|jquery|bootstrap|fontawesome|histats|yandex)/i;

// Enlaces a otras páginas de reproductor que esta página abre o inserta (iframes y textos de script).
function embedLinks(html, base) {
  const texts = [html].concat(unpackAll(html), base64Texts(html));
  const out = [];
  const add = (u) => {
    const a = absUrl(u);
    if (!a || a === base || out.indexOf(a) >= 0) return;
    if (SKIP_HOST.test(hostOf(a))) return;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)(\?|$)/i.test(a)) return;
    out.push(a);
  };
  const decoded = base64Texts(html);
  for (const raw of texts) {
    const t = normText(raw);
    const fr = /<iframe[^>]*src=["']([^"']+)["']/gi;
    let f;
    while ((f = fr.exec(t))) add(f[1]);
    const ur = /["'`]((?:https?:)?\/\/[^"'`\s<>\\]+)["'`]/g;
    let u;
    while ((u = ur.exec(t))) {
      if (/\/(?:e|embed|v|f|play|player|stream|d)\/[A-Za-z0-9_-]{6,}/i.test(u[1])) add(u[1]);
    }
  }
  // Lo que sale de un base64 suele ser el enlace "pelado", sin comillas.
  for (const raw of decoded) {
    const bare = /(?:https?:)?\/\/[^\s"'`<>\\]+/g;
    let b;
    while ((b = bare.exec(normText(raw)))) add(b[0]);
  }
  return out.slice(0, 4);
}

function redact(s) {
  return String(s || "")
    .replace(/https?:\/\/[^\s"'<>]+/g, (u) => hostOf(u) + pathShape(u))
    .replace(/[A-Za-z0-9+\/=_-]{16,}/g, "~")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

// Radiografía de una página de reproductor para el registro (sin códigos ni enlaces completos).
function diag(html, depth, found) {
  const title = /<title[^>]*>([^<]*)/i.exec(html);
  const scripts = [];
  const sre = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let s;
  while ((s = sre.exec(html))) scripts.push({ attrs: s[1], body: s[2] });
  const ext = scripts.map((x) => attr("<s " + x.attrs + ">", "src")).filter(Boolean).map((x) => hostOf(absUrl(x))).filter(Boolean);
  const inline = scripts.filter((x) => x.body.trim()).sort((a, b) => b.body.length - a.body.length);
  const links = embedLinks(html, "").map((u) => hostOf(u) + pathShape(u));
  log("embed[" + depth + "] bytes=" + html.length + " titulo=" + (title ? title[1].trim().slice(0, 40) : "-") +
    " video=" + (found ? "si" : "no") + " packed=" + unpackAll(html).length + " atob=" + base64Texts(html).length +
    " tagVideo=" + /<video[\s>]/i.test(html) + " iframes=" + (html.split("<iframe").length - 1) +
    " scriptsExt=" + ext.slice(0, 4).join(",") + " scriptsInline=" + inline.length + " enlaces=" + links.join(","));
  if (!found && inline.length) log("embed[" + depth + "] script mayor: " + redact(inline[0].body));
}

// Lee la página de un reproductor y busca el video; si no está, sigue los reproductores que esa
// página abre (hasta 2 niveles), porque el de TuDorama suele ser solo una envoltura.
const innerHosts = new Map(); // envoltura -> a qué reproductores apunta

// ok.ru guarda el video en un bloque de datos de su página ("hlsManifestUrl" o la lista de calidades).
function okruMedia(html) {
  const t = String(html || "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const clean = (u) => String(u).replace(/\\+u0026/gi, "&").replace(/\\+\//g, "/");
  for (const key of ["hlsManifestUrl", "ondemandHls", "hlsMasterPlaylistUrl"]) {
    const m = new RegExp('\\\\*"' + key + '\\\\*"\\s*:\\s*\\\\*"(https?:[^"]*?)\\\\*"').exec(t);
    if (m) return clean(m[1]);
  }
  const order = ["ultra", "quad", "full", "hd", "sd", "low", "lowest", "mobile"];
  let best = "", bestRank = 99;
  const re = /\\*"name\\*"\s*:\s*\\*"([a-z]+)\\*"\s*,\s*\\*"url\\*"\s*:\s*\\*"(https?:[^"]*?)\\*"/g;
  let m;
  while ((m = re.exec(t))) { const i = order.indexOf(m[1]); const rk = i < 0 ? 50 : i; if (rk < bestRank) { bestRank = rk; best = clean(m[2]); } }
  return best;
}

async function embedFromHtml(embedUrl, depth, referer) {
  const d = depth || 0;
  if (isHoster(embedUrl)) {
    try {
      const hm = await hosterMedia(embedUrl, referer);
      if (hm) { log("hoster directo: " + hostOf(embedUrl) + " -> " + hostOf(hm.url)); return hm; }
      log("hoster " + hostOf(embedUrl) + ": sin video directo, sigo con el método normal");
    } catch (e) { log("hoster " + hostOf(embedUrl) + " falló: " + String((e && e.message) || e).slice(0, 60)); }
  }
  const r = await kino.fetch(embedUrl, { headers: { Referer: referer || REF } });
  log("embed[" + d + "] " + hostOf(embedUrl) + pathShape(embedUrl) + " status=" + r.status);
  if (!r.ok) return null;
  let html = await r.text();
  let u = deepMedia(html);
  if (!u && /(^|\.)ok\.ru$/i.test(hostOf(embedUrl))) { u = okruMedia(html); if (u) log("ok.ru: video encontrado"); }
  if (d === 0) innerHosts.set(embedUrl, embedLinks(html, embedUrl).map(hostOf));
  // Una página diminuta, sin video ni enlaces, suele ser una pantalla de comprobación del servidor:
  // con la cookie que acaba de dejar, el segundo intento trae la página real. Un solo reintento.
  if (!u && d >= 1 && html.length < 3000 && !/byse/i.test(hostOf(embedUrl)) && !embedLinks(html, embedUrl).length) {
    log("embed[" + d + "] página diminuta (" + html.length + " bytes): reintento");
    if (typeof kino.sleep === "function") await kino.sleep(900);
    const r2 = await kino.fetch(embedUrl, { headers: { Referer: referer || REF } });
    if (r2.ok) {
      const h2 = await r2.text();
      if (h2.length > html.length) { html = h2; u = deepMedia(html); }
    }
  }
  diag(html, d, !!u);
  if (u) {
    log("embed[" + d + "] video elegido: " + hostOf(u) + pathShape(u));
    return { url: u, mime: /\.m3u8/i.test(u) ? "application/x-mpegurl" : "video/mp4", headers: playHeaders(embedUrl) };
  }
  if (d >= 2) return null;
  const links = embedLinks(html, embedUrl).filter((l) => !/byse/i.test(hostOf(l))).slice(0, d === 0 ? 3 : 2);
  for (const l of links) {
    try {
      const got = await embedFromHtml(l, d + 1, embedUrl);
      if (got) return got;
    } catch (e) {
      log("embed[" + (d + 1) + "] falló: " + String((e && e.message) || e).slice(0, 60));
    }
  }
  return null;
}

async function captureEmbed(embedUrl, ms, referer) {
  if (typeof kino === "undefined" || !kino.browser || typeof kino.browser.capture !== "function") return null;
  const page = await kino.browser.capture(embedUrl, { timeoutMs: ms, headers: { Referer: referer || REF } });
  const media = page && Array.isArray(page.media) ? page.media : [];
  const first = media.find((x) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url) && !isDemo(x.url));
  if (!first) return null;
  const out = { url: first.url, mime: first.mime || first.mimeType || (/\.m3u8(\?|$)/i.test(first.url) ? "application/x-mpegurl" : "video/mp4") };
  if (first.headers && typeof first.headers === "object") out.headers = first.headers;
  return out;
}


// ---- Extractores directos por servidor (tomados de Kino Resolver) --------------------------------
// Para los servidores más comunes se saca el video leyendo la página (o la API del servidor), sin
// abrir el navegador. Si no logran nada, se sigue con el método de siempre.

const H_VOE = /voe\.sx|voe-unblock|voeunbl|voeun|edwardarriveoften|yodelswartlike|nathanfromsubject|reputationsheriff|fittingcentermondaysunday|tinycat-voe-fashion|scatch176duplicities|arianathankspecial|cloudwindow-route/i;
const H_WISH = /stream.?wish|strwish|embedwish|wishembed|awish|dwish|mwish|wishfast|sfastwish|flaswish|obeywish|cdnwish|asnwish|flastwish|jodwish|swhoi|swdyu|wishonly|playerwish|hlswish|iplayerhls|hlsflast|ghbrisk|cybervynx|streamhg|hlsflex|hglink|hgplaycdn|vibuxer|yuguaab/i;
const H_TAPE = /streamtape|strtape|strcloud|stape|tapewithadblock|streamadblock|watchadsontape|shavetape|strtpe/i;
const H_HIDE = /streamhide|playhide|guccihide|moviesm4u|louishide|ahvsh|movhide/i;
const H_LARE = /streamlare|slmaxed|slwatch|sltube|streamlure/i;
const H_VIMEOS = /\bvimeos\.(net|zip|to|sx|cc|xyz|lol|art|fun)\b/i;

const hx = (re, s, i) => { const m = re.exec(String(s || "")); return m ? m[i === undefined ? 1 : i] : ""; };
const rot13 = (s) => s.replace(/[a-zA-Z]/g, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode(b + ((c.charCodeAt(0) - b + 13) % 26)); });
const b64 = (s) => { try { return atob(String(s).replace(/[^A-Za-z0-9+\/=_-]/g, "").replace(/-/g, "+").replace(/_/g, "/")); } catch (e) { return ""; } };

function voeDecode(html) {
  try {
    const raw = hx(/<script type="application\/json">(\[".*?"\])<\/script>/s, html);
    if (!raw) return null;
    let s = rot13(JSON.parse(raw)[0]);
    for (const j of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) s = s.split(j).join("");
    const d1 = b64(s);
    let sh = "";
    for (let i = 0; i < d1.length; i++) sh += String.fromCharCode((d1.charCodeAt(i) - 3 + 256) % 256);
    return JSON.parse(b64(sh.split("").reverse().join("")));
  } catch (e) { return null; }
}

function packedOf(html) {
  const outs = [];
  let i = 0;
  while (outs.length < 4) {
    const k = html.indexOf("eval(function(p,a,c,k,e", i);
    if (k < 0) break;
    const u = unpackPacked(html.slice(k, k + 80000));
    if (u) outs.push(u);
    i = k + 20;
  }
  return outs;
}
const fileOfPacked = (html) => {
  for (const t of packedOf(html)) {
    const f = hx(/(?:file|"hls\d?")\s*:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/i, t) || hx(/(?:file|"hls\d?")\s*:\s*"(https?:[^"]+)"/i, t) || hx(/sources\s*:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/i, t) || hx(/src\s*:\s*"(https?:[^"]+)"/i, t);
    if (f) return f;
  }
  return "";
};
const fixU = (u) => String(u || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
const okU = (u) => /^https?:\/\//i.test(u || "") && !isDemo(u);

// Devuelve { url, mime, headers } o null.
async function hosterMedia(url, refer) {
  const h = hostOf(url);
  const RF = refer || REF;
  const page = async (u, hdr) => {
    const r = await kino.fetch(u, { headers: hdr || { Referer: RF } });
    if (!r.ok) { log("hoster " + hostOf(u) + " status=" + r.status); return ""; }
    return await r.text();
  };
  const out = (u, referer, extra) => {
    u = fixU(u);
    if (!okU(u)) return null;
    const hd = referer ? playHeaders(referer) : undefined;
    const o = { url: u, mime: /\.m3u8/i.test(u) ? "application/x-mpegurl" : "video/mp4" };
    if (hd || extra) o.headers = Object.assign({}, hd || {}, extra || {});
    return o;
  };
  let html, u;

  if (H_VOE.test(h)) {
    const id = hx(/voe\.sx\/(?:e\/)?([A-Za-z0-9]+)/i, url);
    const first = id ? "https://voe.sx/e/" + id : url;
    html = await page(first, { Referer: RF });
    if (/permanentToken|Redirecting/.test(html)) {
      const r = hx(/window\.location\.href\s*=\s*'(https?:\/\/[^']+)'/, html);
      if (r) html = await page(r, { Referer: "https://voe.sx/" });
    }
    if (/File not found|no longer available|Error 404/i.test(html)) return null;
    const d = voeDecode(html);
    if (d) { u = d.source || d.direct_access_url; if (u) return out(u, "https://voe.sx/"); }
    u = hx(/(?:mp4|hls)'\s*:\s*'([^']+)'/, html);
    if (u && u.startsWith("aHR0")) u = b64(u);
    if (!u) { try { const v = hx(/let\s+[0-9a-f]+\s*=\s*'(.*?)'/i, html); const j = JSON.parse(b64(v).split("").reverse().join("")); u = j.file; } catch (e) { /* nada */ } }
    return u ? out(u, "https://voe.sx/") : null;
  }

  if (H_VIMEOS.test(h)) {
    const ref = "https://" + h + "/";
    html = await page(url, { Referer: ref });
    if (/File not found|deleted|no longer available/i.test(html)) return null;
    for (const t of packedOf(html)) {
      u = hx(/file\s*:\s*["']([^"']+\.m3u8[^"']*)/i, t) || hx(/(https?:\/\/[^"']+\.m3u8[^"']*)/i, t) || hx(/file\s*:\s*["'](https?:[^"']+)["']/i, t);
      if (u) return out(u, ref);
    }
    return null;
  }

  if (H_TAPE.test(h)) {
    const tok = async (p) => {
      const t = await page(p, { Referer: p });
      if (/Video not found/i.test(t)) return null;
      return hx(/getElementById\('\w+link'\)\.innerHTML\s*=\s*"[^"]+"\s*.*?\('[^']*?\/([^']+)'\)/s, t);
    };
    const norm = url.replace("/v/", "/e/").replace(/\/e\/e\//, "/e/");
    let t = await tok(norm);
    if (!t) t = await tok(norm.replace("/e/", "/v/"));
    return t ? out("https://streamtape.com/" + t + "&stream=1", norm) : null;
  }

  if (H_LARE.test(h)) {
    const id = hx(/\/[ev]\/(\w+)/, url);
    if (!id) return null;
    const r = await kino.fetch("https://streamlare.com/api/video/stream/get", { method: "POST", body: { form: { id } } });
    let j = null;
    try { j = JSON.parse(await r.text()); } catch (e) { /* nada */ }
    u = j && j.result && j.result.file;
    return u ? out(u, url) : null;
  }

  if (/(^|\.)ok\.ru$|okru\.link|odnoklassniki/i.test(h)) {
    if (/okru\.link\/v2/.test(url)) {
      const v = hx(/t=([\w.]+)/, url);
      const r = await kino.fetch("https://apizz.okru.link/decoding", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: url }, body: { form: { video: v } } });
      const d = await r.text();
      u = hx(/"url":"(.*?)"/, d);
      return u ? out(u) : null;
    }
    if (/okru\.link/.test(url)) {
      const d = await page("https://okru.link/details.php?v=" + hx(/t=(\w+)/, url), { Referer: REF });
      u = hx(/"file":"(.*?)"/, d);
      return u ? out(u) : null;
    }
    html = await page(url, { Referer: "https://ok.ru/" });
    u = okruMedia(html);
    return u ? out(u, "https://ok.ru/") : null;
  }

  if (H_WISH.test(h) || H_HIDE.test(h) || /streamvid|vidstreamz|fastream|supervideo|vidmoly|mp4upload|uqload|vidoza|videzz|lulu(?:stream|vdo)/i.test(h)) {
    let ref = RF, extra;
    let p = url;
    if (/uqload/i.test(h)) { ref = "https://uqload.com/"; }
    if (/supervideo/i.test(h)) { ref = "https://supervideo.cc/"; if (!/\/e\//.test(p)) p = p.replace("supervideo.cc/", "supervideo.cc/e/"); }
    if (/mp4upload/i.test(h) && !/embed-/.test(p)) p = p.replace(/mp4upload\.com\//, "mp4upload.com/embed-") + (/\.html/.test(p) ? "" : ".html");
    const hdr = { Referer: ref };
    if (/uqload/i.test(h)) hdr.Origin = ref;
    if (/vidmoly/i.test(h)) {
      p = p.replace("/embed-", "/").replace(/\/[dwv]\//, "/");
      if (!/\.html/.test(p)) p += ".html";
      hdr.cookie = "cf_turnstile_demo_pass_" + p.replace(/^https?:\/\/[^\/]+\//, "").replace(".html", "") + "=1";
      hdr.Referer = RF;
    }
    html = await page(p, hdr);
    if (!html || /File (?:was )?(?:not found|deleted)|no longer available|Video not found|>Security Check</i.test(html)) return null;
    u = "";
    if (/vidoza|videzz|lulu(?:stream|vdo)/i.test(h)) {
      const s = hx(/sourcesCode\s*:\s*(\[\{.*?\}\])/s, html).replace(/(\w+):/g, '"$1":');
      try { const arr = JSON.parse(s); u = (arr[arr.length - 1] || {}).src || (arr[arr.length - 1] || {}).file; } catch (e) { /* nada */ }
    }
    if (!u) u = fileOfPacked(html);
    if (!u) u = hx(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/, html) || hx(/sources\s*:\s*\[\s*["'](https?:[^"']+)["']/, html);
    if (!u && /mp4upload/i.test(h)) u = hx(/"(https[^"]+\.mp4)"/, html) || hx(/"file":"([^"]+)/, html) || hx(/src:"([^"]+)/, html);
    if (!u) return null;
    if (/uqload|supervideo/i.test(h)) extra = { Origin: ref.replace(/\/$/, "") };
    return out(u, /mp4upload/i.test(h) ? p : ref === RF ? p : ref, extra);
  }
  return null;
}

const HOSTER_RE = new RegExp([H_VOE, H_WISH, H_TAPE, H_HIDE, H_LARE, H_VIMEOS].map((r) => r.source).join("|") + "|(?:^|\\.)ok\\.ru$|okru\\.link|streamvid|vidstreamz|fastream|supervideo|vidmoly|mp4upload|uqload|vidoza|videzz|lulu(?:stream|vdo)", "i");
const isHoster = (u) => HOSTER_RE.test(hostOf(u));

const enc = encodeURIComponent;
const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return String(s || ""); } };

function mkItem(src, kind, key, title, poster, year) {
  const t = stripTags(title);
  if (!t) return null;
  return {
    id: src + "-" + String(key).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80),
    ref: src + "|" + (kind === "movie" ? "m" : kind === "anime" ? "a" : "s") + "|" + key,
    title: t.slice(0, 200),
    kind: kind === "movie" ? "movie" : "series",
    genres: [kind === "movie" ? "peliculas" : "series"],
    poster: poster || undefined,
    year: /^\d{4}$/.test(String(year || "")) ? Number(year) : undefined,
  };
}

const A = (base, u) => { u = decodeEntities(u); return u.startsWith("//") ? "https:" + u : u.charAt(0) === "/" ? base + u : u; };
const LANG_NAME = ["Latino", "Castellano", "Subtitulado"];
function langRank(s) {
  s = String(s || "").toLowerCase();
  if (/latino|lat\b/.test(s)) return 0;
  if (/castellano|espa[nñ]ol|cast\b|espa/.test(s)) return 1;
  return 2;
}
const jsonStr = (s) => { try { return JSON.parse('"' + s + '"'); } catch (e) { return String(s || ""); } };
const posterUrl = (p) => { p = String(p || ""); return p.startsWith("//") ? "https:" + p : /^https?:\/\//i.test(p) ? p : undefined; };


function normTitle(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(\d{4}\)/g, "").replace(/[^a-z0-9]+/g, "");
}

//  ALLCALIDAD (motor con API: /api/rest/search, /episodes y /player)
// ====================================================================================================
const AC = "https://allcalidad.re";
async function acJson(path) {
  const r = await kino.fetch(AC + "/api/rest" + path, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: AC + "/" }, timeoutMs: 8000 });
  const t = await r.text();
  if (!r.ok) { log("ac: " + path.slice(0, 40) + " status=" + r.status); throw kino.error("unavailable", "ac status " + r.status); }
  try { return JSON.parse(t); } catch (e) { log("ac: json inválido " + path.slice(0, 40) + " inicio=" + redact(t.slice(0, 80))); throw kino.error("unavailable", "ac respuesta no válida"); }
}
function acImg(o) {
  const im = (o && o.images) || {};
  let p = String(im.poster || im.backdrop || (o && (o.poster || o.still_path)) || "");
  if (!p) return undefined;
  if (/^https?:\/\//i.test(p)) return p;
  if (p.charAt(0) !== "/") p = "/" + p;
  return p.indexOf("/wp-content/") === 0 ? AC + p : AC + "/wp-content/uploads" + p;
}
function acItem(o) {
  const id = String((o && (o._id || o.id)) || "");
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const type = String(o.type || o.post_type || "movies");
  const title = String(o.title || o.name || "").replace(/\s*\(\d{4}\)\s*$/, "").trim();
  const yr = /\b(19|20)\d{2}\b/.exec(String(o.year || o.release_date || ""));
  return mkItem("ac", type === "movies" ? "movie" : "series", id, title, acImg(o), yr && yr[0]);
}
async function acSearch(q, postType) {
  const types = "&post_type=" + (postType || "movies%2Ctvshows%2Canimes");
  const run = async (w) => {
    const d = await acJson("/search?query=" + enc(w) + "&page=1" + types + "&posts_per_page=16");
    return (((d && d.data && d.data.posts) || []).map(acItem)).filter(Boolean);
  };
  let out = await run(q);
  const want = normTitle(q);
  const words = String(q).split(/\s+/).filter((w) => w.length > 3).sort((x, y) => y.length - x.length);
  // La búsqueda del sitio a veces falla con varias palabras: se reintenta con la palabra más larga.
  if (words.length && want.length > 4 && !out.some((it) => normTitle(it.title).indexOf(want) >= 0)) {
    try { const more = await run(words[0]); const seen = new Set(out.map((x) => x.id)); more.forEach((x) => { if (!seen.has(x.id)) out.push(x); }); } catch (e) { /* nada */ }
  }
  if (want.length > 4 && out.some((it) => normTitle(it.title).indexOf(want) >= 0)) out = out.filter((it) => normTitle(it.title).indexOf(want) >= 0);
  log("ac: búsqueda '" + String(q).slice(0, 30) + "' -> " + out.length + (out[0] ? " (" + String(out[0].title).slice(0, 30) + ")" : ""));
  return out;
}
// El sitio no publica un listado conocido: el catálogo se arma buscando por año (como en el plugin FanPelis).
const acCache = new Map();
async function acPage(postType, n) {
  if (n > 1) return { items: [], hasNext: false };
  const hit = acCache.get(postType);
  if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.p;
  const p = acPageGo(postType);
  acCache.set(postType, { t: Date.now(), p });
  p.catch(() => { acCache.delete(postType); });
  return p;
}
async function acPageGo(postType) {
  const res = await Promise.allSettled([2026, 2025, 2024].map((y) => acSearch(String(y), postType)));
  const seen = new Set();
  const items = [];
  res.forEach((r) => { if (r.status === "fulfilled") r.value.forEach((it) => { if (!seen.has(it.id)) { seen.add(it.id); items.push(it); } }); });
  if (!items.length) throw kino.error("unavailable", "ac sin catálogo");
  return { items, hasNext: false };
}
async function acEpisodes(id) {
  const d = await acJson("/episodes?post_id=" + enc(id));
  const out = [];
  for (const e of Array.isArray(d && d.data) ? d.data : []) {
    const eid = e && (e._id || e.id);
    if (!eid || !/^[A-Za-z0-9_-]+$/.test(String(eid))) continue;
    const season = parseInt(e.season_number, 10) || 1;
    const num = parseInt(e.episode_number, 10) || out.length + 1;
    out.push({ season, number: num, ref: "ac|e|" + eid, title: stripTags(String(e.title || "")) || tr("Episodio ", "Episode ") + num, poster: acImg(e) });
  }
  log("ac: episodios " + out.length);
  if (!out.length) throw kino.error("not_found", "ac sin capítulos");
  out.sort((x, y) => (x.season - y.season) || (x.number - y.number));
  return { series: { title: "" }, episodes: out };
}
async function acCandidates(spec) {
  const p = spec.split("|");
  const d = await acJson("/player?post_id=" + enc(p[1]) + "&_any=1");
  const cands = [];
  for (const e of (d && d.data && d.data.embeds) || []) {
    const u = A(AC, e && e.url);
    if (!u || !/^https:\/\//i.test(u)) continue;
    const lang = langRank(String(e.lang || ""));
    if (cands.some((x) => x.url === u)) continue;
    cands.push({ url: u, lang, label: "AllCalidad · " + hostOf(u) + " · " + LANG_NAME[lang], referer: AC + "/" });
  }
  log("ac: servidores " + cands.length + " " + cands.map((c) => hostOf(c.url)).join(","));
  return cands;
}

const HOST_RANK = [/goodstream/i, /vimeos|unlimplay/i, /fastream|ok\.ru/i, /mp4upload/i, /streamwish|hgcloud|vidhide|dhcplay|hlswish|iplayerhls/i, /lulu/i, /voe|uqload|streamtape|streamlare|vidoza|supervideo|vidmoly/i, /paulinito|keki|tnmr/i, /filemoon|byse|mixdrop|mdy|netu|waaw|mega/i];
const rank = (u) => { const h = hostOf(u); const i = HOST_RANK.findIndex((r) => r.test(h)); return i < 0 ? 5 : i; };

async function sleepUpTo(ms) {
  let left = ms;
  while (left > 0) { const t = Math.min(left, 4500); await kino.sleep(t); left -= t; }
  return null;
}
function withTimeout(p, ms) {
  if (typeof kino.sleep !== "function") return p;
  let done = false;
  const stop = (async () => {
    let left = ms;
    while (left > 0 && !done) { const t = Math.min(left, 400); await kino.sleep(t); left -= t; }
    if (done) return new Promise(() => {});
    throw new Error("tardó demasiado");
  })();
  stop.catch(() => {});
  return Promise.race([Promise.resolve(p).then((x) => { done = true; return x; }, (e) => { done = true; throw e; }), stop]);
}

const isDirect = (c) => /\.(m3u8|mp4)(\?|$)/i.test(c.url) && !isDemo(c.url);
const asDirect = (c) => ({ url: c.url, mime: /\.m3u8/i.test(c.url) ? "application/x-mpegurl" : "video/mp4", label: c.label, headers: playHeaders(c.referer || REF) });

async function verifyMedia(m) {
  if (!/mpegurl/i.test(String(m && m.mime))) return true;
  try {
    const r = await withTimeout(kino.fetch(m.url, { headers: m.headers || {} }), 4500);
    if (!r.ok) return false;
    const t = await r.text();
    return /#EXTM3U/.test(String(t).slice(0, 400));
  } catch (e) { return false; }
}

async function directWorks(c) {
  const org = (/^(https?:\/\/[^\/?#]+)/i.exec(c.url) || [])[1] || "";
  const refs = [c.referer || REF, "https://lulustream.com/", "https://luluvdo.com/", org + "/"].filter((x, i, a) => x && a.indexOf(x) === i);
  const tries = refs.map((r) => {
    const m = { url: c.url, mime: /\.m3u8/i.test(c.url) ? "application/x-mpegurl" : "video/mp4", label: c.label, headers: playHeaders(r) };
    return verifyMedia(m).then((ok) => (ok ? { m, r } : null), () => null);
  });
  const res = await Promise.all(tries);
  const hit = res.find(Boolean);
  if (hit) log("resolve: directo abre con referer " + hostOf(hit.r));
  return hit ? hit.m : null;
}

// Devuelve el primer resultado que llegue (no el último): { v, i } o null si ninguno entrega nada.
function firstSuccess(tasks) {
  return new Promise((resolveAll) => {
    let pending = tasks.length;
    if (!pending) { resolveAll(null); return; }
    tasks.forEach((t, i) => {
      Promise.resolve(t).then((v) => { if (v) resolveAll({ v, i }); }, () => {}).then(() => {
        pending--;
        if (pending === 0) resolveAll(null);
      });
    });
  });
}


// ---- PelisGO como respaldo (método del plugin que sí reproduce) ----------------------------------
const PG = "https://pelisgo.online";
const PG_LANG = { cmm5jys20000d12uxchnk1lg7: 0, cmm5jys2d000e12ux0nymuwh4: 1 };
async function getText(url, headers) {
  const r = await kino.fetch(url, { headers: Object.assign({ "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "es-ES,es;q=0.9" }, headers || {}), timeoutMs: 8000 });
  if (!r.ok) throw kino.error("unavailable", "http " + r.status);
  return await r.text();
}
function rscText(h) {
  let t = "";
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\[\s\S])*)"\]\)/g;
  let m;
  while ((m = re.exec(h))) t += jsonStr(m[1]);
  return t;
}
function pgHeaders(referer) {
  return { Origin: PG, Accept: "*/*", "Accept-Language": "es-ES,es;q=0.9", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin", "X-Requested-With": "XMLHttpRequest", Referer: referer || PG + "/", "User-Agent": UA };
}
let pgTok = { token: null, exp: 0 };
async function pgToken() {
  const now = Date.now();
  if (pgTok.token && now < pgTok.exp) return pgTok.token;
  try {
    const r = await kino.fetch(PG + "/api/session/sync", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, pgHeaders()), timeoutMs: 8000 });
    const txt = await r.text();
    if (!r.ok) return null;
    const j = JSON.parse(txt);
    const tok = j && (j.sid || j.sessionId || j.token);
    if (tok) { pgTok = { token: String(tok), exp: now + 9 * 60 * 1000 }; return pgTok.token; }
  } catch (e) { kino.log("pg: session/sync falló " + String((e && e.message) || e).slice(0, 50)); }
  return null;
}
function walkLinks(o, out, lang) {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { o.forEach((x) => walkLinks(x, out, lang)); return; }
  let l = lang;
  const lg = o.languageId || (o.language && (typeof o.language === "string" ? o.language : o.language.id || o.language.name)) || o.lang;
  if (lg) l = PG_LANG[lg] !== undefined ? PG_LANG[lg] : langRank(lg);
  const u = o.url || o.embedUrl || o.embed_url || o.link;
  if (typeof u === "string" && /^https?:\/\//i.test(u) && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u) && !o.isBroken) out.push({ url: u, lang: l === undefined ? 0 : l, label: "PelisGO · " + LANG_NAME[l === undefined ? 0 : l], referer: PG + "/" });
  Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === "object") walkLinks(o[k], out, l); });
}
async function pgStream(kind, id, referer) {
  const url = PG + (kind === "episode" ? "/api/series/episode/" + enc(id) + "/stream" : "/api/movies/" + enc(id) + "/stream");
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await pgToken();
    const h = pgHeaders(referer);
    if (token) h["x-session-id"] = token;
    const r = await kino.fetch(url, { headers: h, timeoutMs: 8000 });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { j = null; }
    kino.log("pg: stream " + kind + " intento " + (attempt + 1) + " status=" + r.status + " bytes=" + txt.length);
    if (r.status === 401 || r.status === 403 || (j && typeof j.error === "string" && /sesi[oó]n/i.test(j.error))) { pgTok = { token: null, exp: 0 }; continue; }
    if (!r.ok || !j) return [];
    const out = [];
    walkLinks(j, out, undefined);
    return out;
  }
  return [];
}
function pgLinks(t, ownId) {
  const out = [];
  const re = /\{"id":"[a-z0-9]+","name":[^{}]*?"url":"(https?:[^"]+)"[^{}]*?\}/g;
  let m;
  while ((m = re.exec(t))) {
    const o = m[0];
    if (/"isBroken":true/.test(o)) continue;
    const ep = /"episodeId":(?:null|"(\w+)")/.exec(o);
    if (ownId && ep && ep[1] && ep[1] !== ownId) continue;
    const lg = /"languageId":"(\w+)"/.exec(o);
    const lang = lg && PG_LANG[lg[1]] !== undefined ? PG_LANG[lg[1]] : 2;
    out.push({ url: jsonStr(m[1]), lang, label: "PelisGO · " + LANG_NAME[lang], referer: PG + "/" });
  }
  return out;
}
async function pgSearch(q) {
  const r = await kino.fetch(PG + "/api/search?q=" + enc(q) + "&limit=24", { headers: pgHeaders(), timeoutMs: 7000 });
  if (!r.ok) throw kino.error("unavailable", "pg búsqueda " + r.status);
  const j = JSON.parse(await r.text());
  const out = [];
  for (const x of (j && Array.isArray(j.results) ? j.results : [])) {
    if (!x || !x.id || !x.slug) continue;
    const isMovie = !(x.type === "serie" || x.type === "series" || x.type === "tv");
    const it = mkItem("pg", isMovie ? "movie" : "series", enc(x.slug) + (isMovie ? "|" + x.id : ""), x.title, x.poster, x.year);
    if (it) out.push(it);
  }
  kino.log("pg: búsqueda '" + String(q).slice(0, 30) + "' -> " + out.length);
  return out;
}
async function pgEpisodeRef(slug, season, ep) {
  const h = await getText(PG + "/series/" + slug + "/temporada/1/episodio/1", { Referer: PG + "/" });
  const t = rscText(h);
  let found = null;
  const re = new RegExp("/series/" + slug.replace(/[^\w-]/g, "") + "/temporada/(\\d+)/episodio/(\\d+)", "g");
  let m;
  while ((m = re.exec(h))) if (+m[1] === season && +m[2] === ep) { found = true; break; }
  const seasons = (function () {
    const i = t.indexOf('"seasons":'); if (i < 0) return null;
    const s = t.indexOf("[", i); if (s < 0) return null;
    let depth = 0, inStr = false;
    for (let k = s; k < t.length; k++) {
      const c = t.charAt(k);
      if (inStr) { if (c === "\\") k++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === "[") depth++; else if (c === "]") { depth--; if (depth === 0) { try { return JSON.parse(t.slice(s, k + 1)); } catch (e) { return null; } } }
    }
    return null;
  })();
  if (seasons) for (const s of seasons) for (const e of (s.episodes || [])) if ((Number(s.number) || 1) === season && (Number(e.number) || 0) === ep) found = true;
  return found ? "e|" + enc(slug) + "|" + season + "|" + ep : null;
}
async function pgCandidates(spec) {
  const p = spec.split("|");
  if (p[0] === "e") {
    const slug = dec(p[1]);
    const page = PG + "/series/" + slug + "/temporada/" + p[2] + "/episodio/" + p[3];
    const t = rscText(await getText(page, { Referer: PG + "/" }));
    const own = (/"episodeId":"(\w+)","episodeTitle"/.exec(t) || [])[1];
    let found = pgLinks(t, own);
    if (!found.length && own) {
      try { found = await pgStream("episode", own, page); } catch (e) { kino.log("pg: stream de capítulo falló " + String((e && e.message) || e).slice(0, 50)); }
    }
    return found;
  }
  const slug = dec(p[1]);
  const page = PG + "/movies/" + slug;
  let cands = [];
  try { cands = await pgStream("movie", p[2], page); } catch (e) { kino.log("pg: api stream falló " + String((e && e.message) || e).slice(0, 50)); }
  if (!cands.length) { try { cands = pgLinks(rscText(await getText(page, { Referer: PG + "/" })), null); } catch (e) { /* sin página */ } }
  return cands;
}

// ---- Título en español (Wikidata, por el número de IMDb) para buscar en los respaldos --------------
async function wikiGet(url) {
  const r = await kino.fetch(url, { headers: { Accept: "application/json", "User-Agent": "PelisKRONOS-Kino/0.1 (plugin de Kino; contacto Ghosti-vc)" }, timeoutMs: 4500 });
  if (!r.ok) throw kino.error("unavailable", "wikidata " + r.status);
  return JSON.parse(await r.text());
}
async function altTitles(imdb) {
  const s = await wikiGet("https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=" + enc("haswbstatement:P345=" + imdb) + "&format=json&origin=*");
  const q = s && s.query && s.query.search && s.query.search[0] && s.query.search[0].title;
  if (!q) return [];
  const e = await wikiGet("https://www.wikidata.org/w/api.php?action=wbgetentities&ids=" + enc(q) + "&props=labels|aliases&languages=es|es-mx|es-419&format=json&origin=*");
  const ent = e && e.entities && e.entities[q];
  const out = [];
  const add = (t) => { t = String(t || "").trim(); if (t && out.indexOf(t) < 0) out.push(t); };
  for (const l of ["es", "es-mx", "es-419"]) if (ent && ent.labels && ent.labels[l]) add(ent.labels[l].value);
  for (const l of ["es", "es-mx", "es-419"]) for (const a of (ent && ent.aliases && ent.aliases[l]) || []) add(a.value);
  kino.log("títulos en español: " + out.length + (out[0] ? " (" + out[0].slice(0, 30) + ")" : ""));
  return out.slice(0, 3);
}
// Título en español pedido a TMDB (es-MX y es-ES); si no hay kino.tmdb o falla, se usa Wikidata.
async function tmAlts(type, tmdb, enTitle) {
  if (!tmdb || typeof kino.tmdb !== "function") return [];
  const path = (type === "series" ? "/tv/" : "/movie/") + tmdb;
  const out = [];
  const add = (s) => { s = String(s || "").trim(); if (s && normTitle(s) !== normTitle(enTitle) && !out.some((o) => normTitle(o) === normTitle(s))) out.push(s); };
  const rs = await Promise.all(["es-MX", "es-ES"].map((l) => tm(path, { language: l }, 5000).catch(() => null)));
  for (const d of rs) if (d) add(type === "series" ? d.name : d.title);
  for (const d of rs) if (d) add(type === "series" ? d.original_name : d.original_title);
  kino.log("títulos en español (TMDB): " + out.length + (out[0] ? " (" + out[0].slice(0, 30) + ")" : ""));
  return out.slice(0, 3);
}
const INFO = {};
function backupInfo(id, type) {
  if (INFO[id]) return INFO[id];
  const p = (async () => {
    const d = await getJson(CINEMETA + "/meta/" + type + "/" + id + ".json");
    const meta = d.meta || {};
    const info = {
      title: String(meta.name || "").trim(),
      year: parseInt(meta.year || meta.releaseInfo, 10) || 0,
      tmdb: parseInt(meta.moviedb_id, 10) || 0,
    };
    info.alts = tmAlts(type, info.tmdb, info.title).then((a) => (a.length ? a : altTitles(id))).catch((e) => { kino.log("títulos en español: " + String((e && e.message) || e).slice(0, 40)); return []; });
    return info;
  })();
  p.catch(() => { delete INFO[id]; });
  INFO[id] = p;
  return p;
}
// Busca primero con el título de Cinemeta; si no aparece, prueba con el título en español.
async function findPick(info, search, kind, tag) {
  const year = info.year;
  const match = (items, titles) => {
    const want = titles.map(normTitle).filter(Boolean);
    const pool = items.filter((it) => it.kind === kind && want.indexOf(normTitle(it.title)) >= 0);
    return pool.find((it) => year && it.year === year) || pool.find((it) => !year || !it.year || Math.abs(it.year - year) <= 1) || null;
  };
  let items = await search(info.title).catch(() => []);
  let pick = match(items, [info.title]);
  if (pick) return pick;
  const alts = await withTimeout(info.alts, 3500).catch(() => []);
  for (const t of alts) {
    if (normTitle(t) === normTitle(info.title)) continue;
    items = await search(t).catch(() => []);
    pick = match(items, [info.title].concat(alts));
    if (pick) { kino.log("respaldo " + tag + ": encontrado con '" + t.slice(0, 30) + "'"); return pick; }
  }
  return null;
}
// Prueba los servidores de un respaldo: primero el mejor idioma, luego el resto; devuelve el primero que abre.
async function playCands(cands, deadline, tag) {
  const left = () => deadline - Date.now();
  const bad = /dood|pinup|agl00\d\.com|playmogo|mixdrop|susanexpect|nupload|netu|waaw|hqq/i;
  cands = cands.filter((c) => !c.cap);
  const usable = cands.filter((c) => !bad.test(hostOf(c.url)));
  if (usable.length) cands = usable;
  cands.sort((a, b) => ((a.lang || 0) * 10 + rank(a.url)) - ((b.lang || 0) * 10 + rank(b.url)));
  const media = async (c) => {
    let v = null;
    if (isDirect(c)) v = await directWorks(c);
    else {
      v = await embedFromHtml(c.url, 0, c.referer || REF);
      if (v && !(await verifyMedia(v))) v = null;
    }
    if (v) { v.label = c.label; kino.log("respaldo " + tag + ": ganó " + hostOf(c.url) + " " + (c.label || "")); }
    return v;
  };
  const minLang = cands.length ? Math.min.apply(null, cands.map((c) => c.lang || 0)) : 0;
  const groups = [cands.filter((c) => (c.lang || 0) === minLang).slice(0, 4), cands.filter((c) => (c.lang || 0) !== minLang).slice(0, 3)];
  for (const g of groups) {
    if (!g.length || left() < 2500) continue;
    const r = await withTimeout(firstSuccess(g.map((c) => media(c).catch(() => null))), Math.max(1500, left() - 500)).catch(() => null);
    if (r && r.v) return r.v;
  }
  return null;
}
async function acResolve(id, season, ep, deadline) {
  const type = season ? "series" : "movie";
  const info = await backupInfo(id, type);
  if (!info.title) return null;
  const kind = type === "series" ? "series" : "movie";
  const pick = await findPick(info, (q) => acSearch(q), kind, "AllCalidad");
  let cands = [];
  if (!pick) {
    kino.log("respaldo AllCalidad: no encontré '" + info.title.slice(0, 30) + "'" + (info.tmdb ? ", pruebo el reproductor por TMDB" : ""));
    if (!info.tmdb) return null;
    cands = [{ url: "https://videoapp.zip/e/" + (type === "movie" ? "movie/" + info.tmdb : "tv/" + info.tmdb + "/" + season + "/" + ep), lang: 0, label: "AllCalidad · videoapp · Latino", referer: AC + "/" }];
  }
  let spec = pick ? "m|" + pick.ref.split("|")[2] : "";
  if (pick && type === "series") {
    const eps = (await acEpisodes(pick.ref.split("|")[2])).episodes;
    const e = eps.find((x) => x.season === season && x.number === ep);
    if (!e) { kino.log("respaldo AllCalidad: sin el episodio " + season + "x" + ep); return null; }
    spec = "e|" + e.ref.split("|")[2];
  }
  if (pick) cands = await acCandidates(spec);
  return await playCands(cands, deadline, "AllCalidad");
}
async function pgResolve(id, season, ep, deadline) {
  const type = season ? "series" : "movie";
  const info = await backupInfo(id, type);
  if (!info.title) return null;
  const kind = type === "series" ? "series" : "movie";
  const pick = await findPick(info, pgSearch, kind, "PelisGO");
  if (!pick) { kino.log("respaldo PelisGO: no encontré '" + info.title.slice(0, 30) + "'"); return null; }
  const p = pick.ref.split("|");
  let spec;
  if (type === "series") {
    spec = await pgEpisodeRef(dec(p[2]), season, ep);
    if (!spec) { kino.log("respaldo PelisGO: sin el episodio " + season + "x" + ep); return null; }
  } else spec = "m|" + p[2] + "|" + p[3];
  const cands = await pgCandidates(spec);
  kino.log("respaldo PelisGO: servidores " + cands.length + " " + cands.map((c) => hostOf(c.url)).join(","));
  return await playCands(cands, deadline, "PelisGO");
}

export async function resolve(ref) {
  await null;
  const t0 = Date.now();
  ref = await tmToImdb(ref);
  const parts = String(ref || "").split(":");
  const id = parts[0];
  if (!/^tt\d+$/.test(id)) throw kino.error("not_found", "ref " + ref);
  const season = parts.length >= 2 ? Number(parts[1]) || 1 : 0;
  const ep = parts.length >= 2 ? Number(parts[2]) || 1 : 0;
  const deadline = t0 + 19000;
  let acP = null;
  const startAc = () => {
    if (!acP) {
      const one = (name, fn) => fn(id, season, ep, deadline).catch((e) => { kino.log("respaldo " + name + " falló: " + String((e && e.message) || e).slice(0, 60)); return null; });
      // AllCalidad y PelisGO arrancan juntos; gana el primero que entregue un video que abre.
      acP = firstSuccess([one("AllCalidad", acResolve), one("PelisGO", pgResolve)]).then((r) => (r && r.v) || null);
    }
    return acP;
  };
  const main = primary(ref, t0);
  main.catch(() => {});
  // El título en español se pide ya, mientras el addon responde: así está listo si hace falta un respaldo.
  backupInfo(id, season ? "series" : "movie").catch(() => {});
  // Prioridad: el addon. Si tarda más de 3,5 s, los respaldos (AllCalidad y PelisGO) arrancan en paralelo.
  let settled = false;
  main.then(() => { settled = true; }, () => { settled = true; });
  if (typeof kino.sleep === "function") {
    (async () => {
      for (let i = 0; i < 9 && !settled; i++) await kino.sleep(400);
      if (!settled) startAc();
    })().catch(() => {});
  }
  try {
    return await main;
  } catch (e) {
    kino.log("addon principal sin video (" + String((e && e.message) || e).slice(0, 50) + "): uso los respaldos");
    const v = await startAc();
    if (v) return v;
    throw e;
  }
}