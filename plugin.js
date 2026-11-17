// Nflix TV: catálogo desde TMDB (kino.tmdb) y reproducción abriendo el reproductor de nflixtv.cc en el navegador oculto de Kino.
const SITE = "https://nflixtv.cc";
const IMG = "https://image.tmdb.org/t/p/w342";
const STILL = "https://image.tmdb.org/t/p/w300";
const enc = encodeURIComponent;

function log(...a) { try { kino.log(...a); } catch { /* sin registro */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function msg(e) { return String((e && e.message) || e).slice(0, 80); }
function dec(s) { try { return decodeURIComponent(s); } catch { return String(s || ""); } }
const nn = (x) => (x == null ? "" : String(x));

// ---- TMDB ---------------------------------------------------------------------------------------
async function unwrapTm(r) {
  for (let i = 0; i < 4 && r != null; i++) {
    if (typeof r === "string") { try { r = JSON.parse(r); continue; } catch { return {}; } }
    if (typeof r.json === "function") { r = await r.json(); continue; }
    if (r.ok === false && r.status) throw new Error("tmdb " + r.status);
    if (r.results || r.seasons || r.episodes || r.id) return r;
    if (r.data != null) { r = r.data; continue; }
    if (r.body != null) { r = r.body; continue; }
    return r;
  }
  return r || {};
}
let tmErr = "";
async function tm(path, params) {
  if (typeof kino.tmdb !== "function") throw kino.error("unavailable", "kino.tmdb no disponible", { userMessage: tr("Este plugin necesita Kino 0.9.53 o más nuevo.", "This plugin needs Kino 0.9.53 or newer.") });
  const p = Object.assign({ language: kino.lang === "en-US" ? "en-US" : "es-MX" }, params || {});
  const qs = Object.keys(p).map((k) => enc(k) + "=" + enc(p[k])).join("&");
  const tries = [() => kino.tmdb(path, p), () => kino.tmdb("/" + path, p), () => kino.tmdb(path + "?" + qs), () => kino.tmdb(path)];
  for (let i = 0; i < tries.length; i++) {
    try {
      const d = await unwrapTm(await tries[i]());
      if (d && typeof d === "object") { if (i) log("tmdb forma " + i + " funciona"); return d; }
    } catch (e) { tmErr = msg(e); log("tmdb " + path + " (forma " + i + "): " + msg(e)); }
  }
  throw new Error("tmdb: " + tmErr);
}

const year4 = (s) => (/^(\d{4})/.exec(nn(s)) || [])[1] || "";
function card(o, type) {
  if (!o || !o.id || (o.media_type && o.media_type !== "tv" && o.media_type !== "movie")) return null;
  const t = type || (o.media_type === "tv" ? "tv" : o.media_type === "movie" ? "movie" : o.first_air_date !== undefined ? "tv" : "movie");
  if (t !== "tv" && t !== "movie") return null;
  const title = nn(o.title || o.name).trim();
  if (!title) return null;
  const y = year4(o.release_date || o.first_air_date);
  const anime = t === "tv" && Array.isArray(o.genre_ids) && o.genre_ids.includes(16) && o.original_language === "ja";
  const dorama = t === "tv" && ["ko", "zh", "th"].includes(o.original_language);
  return {
    id: t + "-" + o.id,
    ref: (t === "tv" ? "s" : "m") + "|" + o.id + "|" + enc(title.slice(0, 80)) + "|" + y,
    title: title.slice(0, 200),
    kind: t === "tv" ? "series" : "movie",
    genres: [t === "movie" ? "peliculas" : anime ? "anime" : dorama ? "doramas" : "series"],
    year: y ? Number(y) : undefined,
    poster: o.poster_path ? IMG + o.poster_path : undefined,
    overview: nn(o.overview).slice(0, 400) || undefined,
  };
}

const ROWS = [
  { id: "tm", title: ["Películas en tendencia", "Trending movies"], genre: "peliculas", path: "trending/movie/week", type: "movie" },
  { id: "pm", title: ["Películas populares", "Popular movies"], genre: "peliculas", path: "movie/popular", type: "movie" },
  { id: "ts", title: ["Series en tendencia", "Trending series"], genre: "series", path: "trending/tv/week", type: "tv" },
  { id: "ps", title: ["Series populares", "Popular series"], genre: "series", path: "tv/popular", type: "tv" },
  { id: "an", title: ["Anime", "Anime"], genre: "anime", path: "discover/tv", type: "tv", q: { with_genres: "16", with_original_language: "ja", sort_by: "popularity.desc" } },
  { id: "do", title: ["Doramas coreanos", "Korean dramas"], genre: "doramas", path: "discover/tv", type: "tv", q: { with_original_language: "ko", sort_by: "popularity.desc" } },
  { id: "tr", title: ["Mejor valoradas", "Top rated"], genre: "peliculas", path: "movie/top_rated", type: "movie" },
];

async function rowPage(r, page) {
  const d = await tm(r.path, Object.assign({ page }, r.q || {}));
  const items = (d.results || []).map((x) => card(x, r.type)).filter(Boolean);
  return { items, hasNext: page < Math.min(Number(d.total_pages) || 1, 20) };
}

export async function home() {
  await null;
  const res = await Promise.allSettled(ROWS.map((r) => rowPage(r, 1)));
  const rows = [];
  res.forEach((x, i) => {
    if (x.status !== "fulfilled") { log("home " + ROWS[i].id + ": " + msg(x.reason)); return; }
    if (x.value.items.length) rows.push({ id: "row-" + ROWS[i].id, title: tr(ROWS[i].title[0], ROWS[i].title[1]), genre: ROWS[i].genre, ref: ROWS[i].id, items: x.value.items.slice(0, 30) });
  });
  if (!rows.length) throw kino.error("unavailable", "inicio sin resultados", { userMessage: tr("No se pudo cargar el catálogo. ", "Could not load the catalog. ") + tmErr });
  return rows;
}

export async function browse(ref, cursor) {
  await null;
  const r = ROWS.find((x) => x.id === String(ref || ""));
  if (!r) throw kino.error("not_found", "catálogo desconocido");
  const n = Math.max(1, parseInt(cursor, 10) || 1);
  const p = await rowPage(r, n);
  const out = { items: p.items };
  if (p.hasNext) out.next = String(n + 1);
  return out;
}

export async function search(query) {
  await null;
  const q = String((query && query.q) || "").replace(/[<>"\\]/g, " ").trim().slice(0, 80);
  if (!q) return [];
  const d = await tm("search/multi", { query: q, include_adult: "false", page: 1 });
  return (d.results || []).map((x) => card(x)).filter(Boolean).slice(0, 40);
}

export async function episodes(ref) {
  await null;
  const p = String(ref || "").split("|");
  if (p[0] === "m") return { series: { title: dec(p[2]) }, episodes: [{ season: 1, number: 1, ref: "e|movie|" + p[1] + "|1|1|" + p[2], title: tr("Película", "Movie") }] };
  if (p[0] !== "s") throw kino.error("not_found", "referencia desconocida");
  const id = p[1];
  const show = await tm("tv/" + id);
  const seasons = (show.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0).slice(0, 30);
  if (!seasons.length) throw kino.error("not_found", "sin capítulos", { userMessage: tr("Este título aún no tiene capítulos.", "No episodes yet.") });
  const res = await Promise.allSettled(seasons.map((s) => tm("tv/" + id + "/season/" + s.season_number)));
  const out = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("temporada " + seasons[i].season_number + ": " + msg(r.reason)); return; }
    (r.value.episodes || []).forEach((e) => {
      const o = { season: e.season_number, number: e.episode_number, ref: "e|tv|" + id + "|" + e.season_number + "|" + e.episode_number + "|" + p[2], title: nn(e.name) || tr("Capítulo ", "Episode ") + e.episode_number };
      if (e.still_path) o.thumbnail = STILL + e.still_path;
      if (e.overview) o.overview = nn(e.overview).slice(0, 400);
      out.push(o);
    });
  });
  if (!out.length) throw kino.error("not_found", "sin capítulos", { userMessage: tr("Este título aún no tiene capítulos.", "No episodes yet.") });
  return { series: { title: dec(p[2]), poster: show.poster_path ? IMG + show.poster_path : undefined }, episodes: out };
}

// ---- Reproducción: reproductor del sitio dentro del navegador oculto -----------------------------------
const BAD = /\.(?:jpe?g|png|gif|webp|svg|vtt|srt|ico|css|js|woff2?)(?:\?|$)|doubleclick|googima|googlesyndication|adservice|analytics|beacon|\/thumbnail|sprite/i;
const kindOf = (u) => (/\.m3u8(\?|$)|\/hls-proxy\/|\/playlist|\/master/i.test(u) ? 0 : /\.mp4(\?|$)/i.test(u) ? 1 : /\.mpd(\?|$)/i.test(u) ? 2 : 3);
const mimeOf = (m, u) => m || (/\.m3u8|hls/i.test(u) ? "application/x-mpegurl" : /\.mpd/i.test(u) ? "application/dash+xml" : "video/mp4");

function playerUrl(type, id, season, episode, title) {
  const q = ["id=" + enc(id), "type=" + type];
  if (type === "tv") q.push("season=" + enc(season), "episode=" + enc(episode));
  if (title) q.push("title=" + enc(title));
  q.push("ui=ship1");
  return SITE + "/rift-player/player.html?" + q.join("&");
}

export async function resolve(ref) {
  await null;
  const p = String(ref || "").split("|");
  let type, id, season, episode, title;
  if (p[0] === "e") { type = p[1]; id = p[2]; season = p[3]; episode = p[4]; title = dec(p[5] || ""); }
  else if (p[0] === "m") { type = "movie"; id = p[1]; title = dec(p[2] || ""); }
  else if (p[0] === "s") { type = "tv"; id = p[1]; season = "1"; episode = "1"; title = dec(p[2] || ""); }
  else throw kino.error("not_found", "referencia desconocida");
  if (!/^\d+$/.test(id)) throw kino.error("not_found", "id inválido");
  if (!kino.browser || typeof kino.browser.capture !== "function") throw kino.error("unavailable", "sin navegador", { userMessage: tr("Este plugin necesita el navegador de Kino.", "This plugin needs Kino's browser.") });
  const url = playerUrl(type, id, season, episode, title);
  log("abriendo reproductor " + type + " " + id + (season ? " " + season + "x" + episode : ""));
  const page = await kino.browser.capture(url, { timeoutMs: 30000, headers: { "Accept-Language": "es-MX,es;q=0.9" } });
  const media = (page && Array.isArray(page.media) ? page.media : []).filter((m) => m && typeof m.url === "string" && /^https?:\/\//.test(m.url));
  log("capturados " + media.length + ": " + media.slice(0, 8).map((m) => m.url.replace(/^https?:\/\//, "").slice(0, 70)).join(" | "));
  const good = media.filter((m) => !BAD.test(m.url)).sort((a, b) => kindOf(a.url) - kindOf(b.url));
  if (!good.length) throw kino.error("not_found", "sin video", { userMessage: tr("No se pudo obtener el video. Prueba de nuevo.", "Could not get the video. Try again.") });
  const f = good[0];
  const out = { url: f.url, mime: mimeOf(f.mime || f.mimeType, f.url) };
  if (f.headers && typeof f.headers === "object") out.headers = f.headers;
  return out;
}
