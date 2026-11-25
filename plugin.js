
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

export async function resolve(ref) {
  await null;
  const parts = String(ref || "").split(":");
  const id = parts[0];
  if (!/^tt\d+$/.test(id)) throw kino.error("not_found", "ref " + ref);
  const type = parts.length >= 2 ? "series" : "movie";
  const addonId = type === "series" ? id + ":" + (parts[1] || 1) + ":" + (parts[2] || 1) : id;
  const data = await getJson(ADDON + "/stream/" + type + "/" + addonId + ".json");
  const list = (Array.isArray(data.streams) ? data.streams : [])
    .filter((s) => s && typeof s.url === "string" && s.url.indexOf("https://") === 0);
  if (!list.length) {
    throw kino.error("not_found", "sin enlaces", { userMessage: "Este título no tiene enlaces disponibles ahora." });
  }
  const mk = (s) => ({ url: s.url, mime: /\.mp4(\?|$)/i.test(s.url) ? "video/mp4" : "application/vnd.apple.mpegurl", label: labelOf(s) });
  const main = mk(list[0]);
  const alts = list.slice(1, 9).map(mk);
  if (alts.length) main.alternatives = alts;
  return main;
}