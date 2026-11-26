// Cine 3 Estrellas para Kino — películas y series en latino y subtituladas.
// Fuente: API pública de VideoAPI. Un solo archivo, sin import.

const API = "https://videoapi.la/api/v1/public";
const HOME_API = "https://cine-3-estrellas-five.vercel.app/api/tv/home";
const EMBED_HOST = "videoapp.zip";
const PLAYER_HOST = "vimeos.net";
const IMG = "https://image.tmdb.org/t/p/w500";
const UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

// ---------- idioma ----------
function t(esText, enText) {
  return String(kino.lang || "es-CO").toLowerCase().startsWith("en") ? enText : esText;
}

// ---------- red ----------
async function req(url, opts) {
  const o = opts || {};
  const headers = {
    "user-agent": UA,
    accept: "application/json, text/html;q=0.9, */*;q=0.8",
    "accept-language": "es-419,es;q=0.9,en;q=0.8",
  };
  if (o.headers) for (const k in o.headers) headers[k] = o.headers[k];
  const res = await kino.fetch(url, { headers, method: o.method || "GET" });
  let text = "";
  try {
    text = await res.text();
  } catch (e) {
    text = "";
  }
  return { status: res.status || 0, text, url };
}

async function jsonGet(url) {
  const r = await req(url);
  if (r.status >= 400) throw kino.error("unavailable", "http " + r.status);
  try {
    return JSON.parse(r.text);
  } catch (e) {
    throw kino.error("unavailable", "json");
  }
}

async function page(url, referer) {
  const r = await req(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "sec-fetch-dest": "iframe",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "cross-site",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      referer: referer || "https://" + EMBED_HOST + "/",
    },
  });
  if (r.status >= 400) throw kino.error("unavailable", "http " + r.status);
  return r.text;
}

// ---------- texto ----------
function firstMatch(re, s) {
  const m = String(s).match(re);
  return m ? m[1] : "";
}

function yearOf(v) {
  const s = String(v || "");
  const m = s.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}

// ---------- tarjetas ----------
function posterOf(p) {
  if (!p) return undefined;
  if (/^https?:\/\//i.test(p)) return p;
  return IMG + (p.startsWith("/") ? p : "/" + p);
}

function movieItem(x) {
  if (!x) return null;
  const tmdb = x.tmdb || x.id;
  if (!tmdb || !x.title) return null;
  const item = {
    id: "m-" + tmdb,
    title: String(x.title),
    kind: "movie",
    ref: "m-" + tmdb,
  };
  const poster = posterOf(x.poster_url || x.poster_path);
  if (poster) item.poster = poster;
  const year = yearOf(x.year || x.release_date);
  if (year) item.year = year;
  return item;
}

function showItem(x) {
  if (!x) return null;
  const tmdb = x.tmdb || x.id;
  if (!tmdb || !x.title) return null;
  const item = {
    id: "t-" + tmdb,
    title: String(x.title),
    kind: "series",
    ref: "t-" + tmdb,
  };
  const poster = posterOf(x.poster_url || x.poster_path);
  if (poster) item.poster = poster;
  const year = yearOf(x.year || x.first_air_date || x.release_date);
  if (year) item.year = year;
  return item;
}

function fromCatalog(x) {
  return x && x.type === "tv" ? showItem(x) : movieItem(x);
}

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    if (!x || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

// ---------- catálogo ----------
async function catalog(type, opts) {
  const o = opts || {};
  let url =
    API +
    "/catalog?type=" +
    (type === "tv" ? "tv" : "movie") +
    "&page=" +
    Math.max(1, Number(o.page) || 1);
  if (o.order) url += "&order=" + encodeURIComponent(o.order);
  if (o.genre) url += "&genre=" + encodeURIComponent(o.genre);
  if (o.search) url += "&search=" + encodeURIComponent(o.search);
  const j = await jsonGet(url);
  const items = (j.items || []).map(fromCatalog).filter(Boolean);
  return { items, hasNext: !!(j.pagination && j.pagination.has_next) };
}

// ---------- portada ----------
const GENRES = [
  ["accion", "Acción", "Action"],
  ["comedia", "Comedia", "Comedy"],
  ["terror", "Terror", "Horror"],
  ["drama", "Drama", "Drama"],
  ["romance", "Romance", "Romance"],
  ["ciencia-ficcion", "Ciencia ficción", "Sci-Fi"],
  ["animacion", "Animación", "Animation"],
];

function row(id, genre, title, items, ref) {
  return { id, genre, title, ref, items: items.slice(0, 60) };
}

export async function home() {
  await kino.sleep(0);
  const results = await Promise.all([
    jsonGet(HOME_API).catch(() => null),
    catalog("tv", { order: "created_at" }).catch(() => null),
    catalog("tv", { order: "views_total" }).catch(() => null),
  ]);
  const appHome = results[0];
  const tvNew = results[1];
  const tvTop = results[2];

  const rows = [];

  if (appHome) {
    const hero = (appHome.heroMovies || []).map(movieItem).filter(Boolean);
    if (hero.length) {
      rows.push(row("destacados", "movies", t("Destacados", "Featured"), hero, "movie:-:views_total"));
    }
    const cats = (appHome.categories || [])
      .filter((c) => c && Array.isArray(c.movies) && c.movies.length)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    for (const c of cats) {
      if (rows.length >= 12) break;
      const items = uniq(c.movies.map(movieItem).filter(Boolean));
      if (!items.length) continue;
      const ref = c.id === "popular" ? "movie:-:views_total" : "movie:-:created_at";
      rows.push(
        row("c-" + String(c.id || rows.length), "movies", String(c.name || t("Películas", "Movies")), items, ref)
      );
    }
  }

  if (tvNew && tvNew.items.length) {
    rows.unshift(row("series-nuevas", "series", t("Series recientes", "Recent series"), tvNew.items, "tv:-:created_at"));
  }
  if (tvTop && tvTop.items.length) {
    rows.push(row("series-populares", "series", t("Series populares", "Popular series"), tvTop.items, "tv:-:views_total"));
  }

  for (const g of GENRES) {
    if (rows.length >= 20) break;
    try {
      const got = await catalog("movie", { genre: g[0] });
      if (!got.items.length) continue;
      rows.push(row("g-" + g[0], "movies", t(g[1], g[2]), got.items, "movie:" + g[0] + ":created_at"));
    } catch (e) {}
  }

  if (!rows.length) {
    throw kino.error("unavailable", "portada", {
      userMessage: t("No pude cargar el catálogo ahora.", "Could not load the catalog now."),
    });
  }
  return rows;
}

// ---------- búsqueda ----------
export async function search(query, opts) {
  await kino.sleep(0);
  const q = String(query || "").trim();
  if (!q) return { items: [] };
  const page_ = Number((opts && opts.page) || 1);
  const parts = await Promise.all([
    catalog("movie", { search: q, page: page_ }).catch(() => null),
    catalog("tv", { search: q, page: page_ }).catch(() => null),
  ]);
  const items = uniq([].concat(parts[0] ? parts[0].items : [], parts[1] ? parts[1].items : [])).slice(0, 100);
  const hasNext = !!(parts[0] && parts[0].hasNext) || !!(parts[1] && parts[1].hasNext);
  return { items, hasNext };
}

// ---------- navegar ----------
export async function browse(ref, opts) {
  await kino.sleep(0);
  const parts = String(ref || "movie:-:created_at").split(":");
  const type = parts[0] === "tv" ? "tv" : "movie";
  const genre = parts[1] && parts[1] !== "-" ? parts[1] : "";
  const order = parts[2] || "created_at";
  const page_ = Number((opts && opts.page) || 1);
  return await catalog(type, { genre, order, page: page_ });
}

// ---------- episodios ----------
function epItem(tmdb, season, episode, label) {
  const tag = "T" + season + "E" + String(episode).padStart(2, "0");
  return {
    id: "t-" + tmdb + "-" + season + "-" + episode,
    title: label ? tag + " · " + label : tag,
    season,
    episode,
    kind: "episode",
    ref: "t-" + tmdb + "-" + season + "-" + episode,
  };
}

function pushRange(items, tmdb, seasons, total) {
  const per = Math.max(1, Math.ceil(total / Math.max(1, seasons)));
  for (let s = 1; s <= seasons; s++) {
    for (let e = 1; e <= per; e++) {
      if (items.length >= 3000) return;
      items.push(epItem(tmdb, s, e, ""));
    }
  }
}

export async function episodes(ref) {
  await kino.sleep(0);
  const tmdb = String(ref).split("-")[1];
  if (!tmdb) {
    throw kino.error("not_found", "sin id", {
      userMessage: t("No pude abrir esta serie.", "Could not open this series."),
    });
  }

  const items = [];
  const why = [];

  if (typeof kino.tmdb === "function") {
    try {
      const show = await kino.tmdb("/tv/" + tmdb, { language: "es-CO" });
      const seasons = (show && show.seasons) || [];
      why.push("tmdb:" + seasons.length);
      for (const s of seasons) {
        if (!s || !s.season_number) continue;
        const n = Math.min(Number(s.episode_count) || 0, 200);
        for (let e = 1; e <= n; e++) items.push(epItem(tmdb, s.season_number, e, ""));
      }
    } catch (e) {
      why.push("tmdb:" + ((e && e.code) || "err"));
    }
  } else {
    why.push("tmdb:sin-api");
  }

  if (!items.length) {
    try {
      const j = await jsonGet(API + "/wordpress/lookup?type=tv&tmdb=" + encodeURIComponent(tmdb));
      const it = j && (j.item || j);
      why.push("lookup:" + (it && it.title ? "ok" : "vacio"));
      if (it) {
        const seasons = Math.max(1, Number(it.number_of_seasons) || 1);
        const total = Math.max(1, Number(it.number_of_episodes) || 1);
        pushRange(items, tmdb, seasons, total);
      }
    } catch (e) {
      why.push("lookup:" + ((e && e.code) || "err"));
    }
  }

  if (!items.length) {
    why.push("vacio");
    throw kino.error("not_found", why.join(","), {
      userMessage: t("No pude listar los episodios.", "Could not list the episodes."),
    });
  }

  kino.log("cine3", "episodios", tmdb, items.length);
  return { items };
}

// ---------- video ----------
function findStream(html) {
  const text = String(html).replace(/\\\//g, "/");
  const block = firstMatch(/"stream_urls"\s*:\s*\[([\s\S]{0,4000}?)\]/, text);
  const re = /"(https?:[^"\\]+)"/g;
  let m;
  while ((m = re.exec(block))) {
    const u = m[1].trim();
    if (/\.(m3u8|mp4)(\?|$)/i.test(u)) return u;
  }
  const any = text.match(/https?:\/\/[^\s"'\\<>]+?\.m3u8[^\s"'\\<>]*/i);
  if (any && any.length) return any[0];
  const mp4 = text.match(/https?:\/\/[^\s"'\\<>]+?\.mp4[^\s"'\\<>]*/i);
  return mp4 && mp4.length ? mp4[0] : "";
}

function playerUrl(html) {
  const m = String(html).match(
    /https:\/\/vimeos\.net\/embed-[A-Za-z0-9]+\.html\?cf=[A-Za-z0-9_.\-]+/
  );
  return m ? m[0] : "";
}

function subsFrom(html) {
  const out = [];
  const block = firstMatch(/"default_subs"\s*:\s*(\[[\s\S]{0,4000}?\])/, html);
  if (!block) return out;
  const re = /\{[^{}]*?"lang"\s*:\s*"([^"]*)"[^{}]*?"url"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(block))) {
    const url = m[2].replace(/\\\//g, "/");
    if (!/^https?:\/\//i.test(url)) continue;
    const probe = url + " " + m[1];
    const lang = /_spa|spanish|espa/i.test(probe) ? "es" : /_eng|english|ingl/i.test(probe) ? "en" : "";
    const label = lang === "es" ? "Español" : lang === "en" ? "Inglés" : String(m[1] || "Sub");
    out.push({ url, label, lang });
  }
  return out;
}

function streamHeaders() {
  return {
    Referer: "https://" + PLAYER_HOST + "/",
    Origin: "https://" + PLAYER_HOST,
    "User-Agent": UA,
    Accept: "*/*",
  };
}

// ---------- resolve ----------
export async function resolve(ref) {
  await kino.sleep(0);
  const parts = String(ref).split("-");
  const kind = parts[0] === "t" ? "tv" : "movie";
  const tmdb = parts[1];
  if (!tmdb) {
    throw kino.error("not_found", "sin id", {
      userMessage: t("No pude abrir este título.", "Could not open this title."),
    });
  }

  let path = "/e/" + kind + "/" + encodeURIComponent(tmdb);
  if (kind === "tv") {
    path += "/" + (parts[2] || "1") + "/" + (parts[3] || "1");
  }

  const outer = await page("https://" + EMBED_HOST + path);
  let html = outer;

  if (!findStream(html)) {
    const inner = playerUrl(html);
    if (!inner) {
      throw kino.error("unavailable", "sin reproductor", {
        userMessage: t("Este título no tiene video disponible.", "This title has no video available."),
      });
    }
    html = await page(inner, "https://" + EMBED_HOST + "/");
    kino.log("cine3", "reproductor", kind, tmdb);
  }

  const url = findStream(html);
  if (!url) {
    throw kino.error("not_found", "sin video", {
      userMessage: t("Este título no tiene video disponible.", "This title has no video available."),
    });
  }

  const headers = streamHeaders();
  const stream = {
    url,
    mime: /\.mp4(\?|$)/i.test(url) ? "video/mp4" : "application/vnd.apple.mpegurl",
    headers,
  };

  const subs = subsFrom(html);
  if (subs.length) stream.subtitles = subs.map((s) => ({ url: s.url, label: s.label, lang: s.lang, headers }));

  return stream;
}