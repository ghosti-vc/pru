
// PELISKronos: catálogo desde Cinemeta, enlaces desde el addon KRONOS4K.
const CINEMETA = "https://v3-cinemeta.strem.io";
const ADDON = "https://addons.4rever.cc";

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

export async function home() {
  const jobs = ROWS.map(async (row) => {
    const data = await getJson(CINEMETA + "/catalog/" + row[1] + "/" + row[2] + ".json");
    const items = (data.metas || []).map(toItem).filter(Boolean).slice(0, 40);
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
  if (Object.keys(c.headers || {}).length === 0) {
    const rb = await openManifest(c.url, { Accept: "*/*" }, ms);
    if (rb.ok) { c.sendHeaders = {}; return { ok: true, why: "m3u8 sin cabeceras" }; }
    return { ok: false, why: ra.why + " / sin cabeceras: " + rb.why };
  }
  return ra;
}

export async function resolve(ref) {
  await null;
  const t0 = Date.now();
  const parts = String(ref || "").split(":");
  const id = parts[0];
  if (!/^tt\d+$/.test(id)) throw kino.error("not_found", "ref " + ref);
  const type = parts.length >= 2 ? "series" : "movie";
  const addonId = type === "series" ? id + ":" + (parts[1] || 1) + ":" + (parts[2] || 1) : id;
  let data;
  try {
    const r = await kino.fetch(ADDON + "/stream/" + type + "/" + addonId + ".json", { headers: { Accept: "application/json" }, timeoutMs: 14000 });
    if (!r.ok) throw kino.error("unavailable", "addon http " + r.status);
    data = await r.json();
  } catch (e) {
    if (e && e.code === "unavailable") throw e;
    throw kino.error("unavailable", "addon " + String((e && e.code) || (e && e.message) || e).slice(0, 40), { userMessage: "El addon de enlaces no respondió a tiempo. Prueba de nuevo." });
  }
  const list = (Array.isArray(data.streams) ? data.streams : [])
    .filter((s) => s && typeof s.url === "string" && s.url.indexOf("https://") === 0);
  if (!list.length) {
    throw kino.error("not_found", "sin enlaces", { userMessage: "Este título no tiene enlaces disponibles ahora." });
  }
  const cands = list.slice(0, 8).map((s) => ({
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
