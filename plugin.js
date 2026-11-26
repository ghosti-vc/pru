// PelisMXL — plugin de Kino.
// Catálogo por kino.tmdb (sin clave en el código). Enlaces por la API de MXL.
// La API de MXL está detrás de un WAF de Cloudflare que solo deja pasar al
// cliente de la app original. Se intenta imitar sus cabeceras (User-Agent
// okhttp/4.12.0 y las de dispositivo); si aun así bloquea, se usa el proxy
// OkHttp de Termux (ajuste "proxy", formato /proxy/{dominio}/{ruta}).

const UA = "okhttp/4.12.0";
const APPID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const DEVICE = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const API = ["https://prop.shiwaimov.com", "https://api.shiwaimov.com", "https://check.shiwaimov.com"];
const IMG = "https://image.tmdb.org/t/p/w500";
const MAX_SERVERS = 6;
const MAX_SEASONS = 25;
const MAX_EPISODES = 5000;
const MAX_CANDIDATES = 4;

function log() {
  try { kino.log.apply(null, arguments); } catch (e) {}
}

function en() { return String(kino.lang || "es-CO").toLowerCase().indexOf("en") === 0; }
function pick(pair) { return en() ? pair[1] : pair[0]; }
function tmdbLang() { return en() ? "en-US" : "es-ES"; }

const MSG = {
  down: ["El servidor de MXL no responde ahora. Inténtalo más tarde.",
         "MXL is not answering right now. Try again later."],
  noproxy: ["Falta el proxy. Configúralo y arráncalo en Termux.",
            "The proxy is missing. Set it up and start it in Termux."],
  proxy: ["El proxy del celular no responde. Revísalo en Termux.",
          "The phone proxy is not answering. Check it in Termux."],
  empty: ["Este título no tiene ningún servidor disponible.",
          "This title has no server available."]
};

// Ids de género de TMDB a los géneros de Kino.
const GENRES = {
  28: "accion", 12: "aventura", 16: "animacion", 35: "comedia", 80: "crimen",
  99: "documental", 18: "drama", 10751: "infantil", 14: "fantasia",
  36: "historia", 27: "terror", 10402: "musica", 9648: "misterio",
  10749: "romance", 878: "ciencia-ficcion", 10770: "pelicula-de-tv",
  53: "suspenso", 10752: "guerra", 37: "western"
};

function genresOf(ids) {
  const out = [];
  if (!Array.isArray(ids)) return out;
  for (let i = 0; i < ids.length && out.length < 5; i++) {
    const g = GENRES[ids[i]];
    if (g && out.indexOf(g) === -1) out.push(g);
  }
  return out;
}

function cleanUrl(u) {
  if (!u) return "";
  return String(u).trim()
    .replace(/&amp;/g, "&")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/");
}

function isM3u8(u) { return /\.m3u8(?:[?#]|$)/i.test(u); }
function isMp4(u) { return /\.mp4(?:[?#]|$)/i.test(u); }

function blocked(body) {
  return /blocked_resolve|you have been blocked|Attention Required|cf-error-details|cloudflare/i
    .test(String(body || "").slice(0, 900));
}

function proxyFailed(body) {
  return /"(upstream_error|proxy_error)"/.test(String(body || "").slice(0, 200));
}

// Cabeceras calcadas del cliente de la app original.
function apiHeaders() {
  const now = new Date();
  let offset = "";
  try {
    const mins = -now.getTimezoneOffset();
    const abs = Math.abs(mins);
    offset = (mins < 0 ? "-" : "+") + ("0" + Math.floor(abs / 60)).slice(-2) + ":" + ("0" + (abs % 60)).slice(-2);
  } catch (e) {
    offset = "-05:00";
  }
  return {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Content-Type": "application/json",
    "clientType": "android_mxl",
    "platformid": "android",
    "devicemodel": "android",
    "deviceId": DEVICE,
    "versionCode": "80",
    "rnVersion": "2.13.0",
    "lang": en() ? "en" : "es",
    "timezone": "GMT" + offset,
    "token": ""
  };
}

async function bodyOf(r) {
  try { return await r.text(); } catch (e) {}
  try { return JSON.stringify(await r.json()); } catch (e) { return ""; }
}

// Dirección del proxy, sin la barra final. Vacía cuando no hay.
function proxyBase() {
  let raw = "";
  try { raw = String(kino.config.get("proxy") || "").trim(); } catch (e) { return ""; }
  if (!raw) return "";
  if (raw.indexOf("http://") !== 0 && raw.indexOf("https://") !== 0) raw = "http://" + raw;
  return raw.replace(/\/+$/, "");
}

function viaProxy(base, url) {
  return base + "/proxy/" + String(url).replace(/^https?:\/\//, "");
}

// Pide un texto: primero por el proxy si está puesto, después directo.
async function getText(url, headers) {
  const h = headers || {};
  const base = proxyBase();
  if (base) {
    try {
      const r = await kino.fetch(viaProxy(base, url), { headers: h });
      const text = await bodyOf(r);
      if (text && !proxyFailed(text)) return text;
    } catch (e) {}
  }
  const r = await kino.fetch(url, { headers: h });
  return bodyOf(r);
}

// Una ruta de la API de MXL, probando los tres hosts del servicio.
async function mxlJson(path) {
  const sep = path.indexOf("?") === -1 ? "?" : "&";
  const full = path + sep + "appid=" + APPID;
  const base = proxyBase();
  let last = "";
  let tried = 0;
  let proxyOk = false;

  for (let i = 0; i < API.length; i++) {
    if (base) {
      tried++;
      try {
        const r = await kino.fetch(viaProxy(base, API[i] + full), { headers: apiHeaders() });
        const text = await bodyOf(r);
        if (text && !proxyFailed(text) && !blocked(text)) {
          proxyOk = true;
          try {
            const data = JSON.parse(text);
            if (data) return data;
            last = "vacío";
          } catch (e) { last = "json"; }
        } else {
          last = proxyFailed(text) ? "proxy" : "bloqueado";
        }
      } catch (e) {
        last = "proxy";
      }
    }
    tried++;
    try {
      const r = await kino.fetch(API[i] + full, { headers: apiHeaders() });
      const text = await bodyOf(r);
      if (blocked(text)) { last = "bloqueado"; continue; }
      if (!r.ok) { last = "http " + r.status; continue; }
      try {
        const data = JSON.parse(text);
        if (data) return data;
        last = "vacío";
      } catch (e) { last = "json"; }
    } catch (e) {
      last = (e && e.code) || "red";
    }
  }

  log("mxl sin respuesta", path, last, "proxy", base ? "sí" : "no", "intentos", tried);
  if (!base) throw kino.error("unavailable", "mxl sin proxy", { userMessage: pick(MSG.noproxy) });
  if (last === "proxy" || !proxyOk) {
    throw kino.error("unavailable", "mxl proxy", { userMessage: pick(MSG.proxy) });
  }
  throw kino.error("unavailable", "mxl " + last, { userMessage: pick(MSG.down) });
}

async function tmdb(path, params) {
  if (typeof kino.tmdb !== "function") throw kino.error("unavailable", "kino.tmdb");
  const p = { language: tmdbLang() };
  if (params) for (const k in params) p[k] = params[k];
  return kino.tmdb(path, p);
}

function toItem(r, kind) {
  const title = String(r.title || r.name || "Sin título").slice(0, 200);
  const year = String(r.release_date || r.first_air_date || "").slice(0, 4);
  const series = kind === "series";
  const item = {
    id: (series ? "tv" : "mv") + r.id,
    ref: (series ? "tv:" : "mv:") + r.id,
    title: title,
    kind: kind,
    poster: r.poster_path ? IMG + r.poster_path : undefined,
    overview: r.overview ? String(r.overview).slice(0, 500) : undefined,
    genres: genresOf(r.genre_ids),
    adult: r.adult === true,
    ids: { tmdb: r.id }
  };
  if (/^\d{4}$/.test(year)) item.year = year;
  if (typeof r.vote_average === "number" && r.vote_average > 0) {
    item.rating = Math.round(r.vote_average * 10) / 10;
  }
  return item;
}

// ---------------------------------------------------------- estado del ajuste

export async function settingsStatus() {
  const base = proxyBase();
  if (!base) return { estado: "Sin proxy. Arranca el proxy en Termux y escribe su dirección." };
  try {
    const r = await kino.fetch(base + "/health", { headers: { "User-Agent": UA } });
    const text = await bodyOf(r);
    if (r.ok && /"status"\s*:\s*"ok"/.test(text)) return { estado: "Proxy conectado." };
    return { estado: "El proxy responde, pero no como se espera." };
  } catch (e) {
    return { estado: "El proxy no responde. Arráncalo en Termux." };
  }
}

// ---------------------------------------------------------------- búsqueda

export async function search(query) {
  const q = String((query && query.q) || "").trim();
  if (!q) return [];
  let data;
  try {
    data = await tmdb("/search/multi", { query: q, include_adult: "false" });
  } catch (e) {
    throw kino.error("unavailable", "tmdb search", { userMessage: pick(MSG.down) });
  }
  const out = [];
  const results = (data && data.results) || [];
  for (let i = 0; i < results.length && out.length < 60; i++) {
    const r = results[i];
    if (r.media_type === "movie") out.push(toItem(r, "movie"));
    else if (r.media_type === "tv") out.push(toItem(r, "series"));
  }
  return out;
}

// -------------------------------------------------------------------- Home

const ROWS = [
  { id: "trending", path: "/trending/all/week", genre: null, title: ["Tendencias", "Trending"] },
  { id: "movies", path: "/movie/popular", genre: "peliculas", title: ["Películas populares", "Popular movies"] },
  { id: "series", path: "/tv/popular", genre: "series", title: ["Series populares", "Popular series"] },
  { id: "top", path: "/movie/top_rated", genre: "peliculas", title: ["Mejor calificadas", "Top rated"] },
  { id: "airing", path: "/tv/on_the_air", genre: "series", title: ["Series al aire", "On the air"] }
];

export async function home() {
  const out = [];
  for (let i = 0; i < ROWS.length; i++) {
    const row = ROWS[i];
    try {
      const data = await tmdb(row.path, {});
      const items = [];
      const results = (data && data.results) || [];
      for (let j = 0; j < results.length && items.length < 30; j++) {
        const r = results[j];
        let kind = null;
        if (row.id === "trending") {
          if (r.media_type === "movie") kind = "movie";
          else if (r.media_type === "tv") kind = "series";
        } else if (row.id === "movies" || row.id === "top") kind = "movie";
        else kind = "series";
        if (kind) items.push(toItem(r, kind));
      }
      if (!items.length) continue;
      const node = { id: row.id, title: pick(row.title), items: items };
      if (row.genre) node.genre = row.genre;
      out.push(node);
    } catch (e) {
      log("fila", row.id, (e && e.message) || e);
    }
  }
  if (!out.length) throw kino.error("unavailable", "home vacía", { userMessage: pick(MSG.down) });
  return out;
}

// --------------------------------------------------------------- episodios

export async function episodes(ref) {
  await null;
  const parts = String(ref || "").split(":");
  const id = Number(parts[1]);
  if (!id) throw kino.error("not_found", "ref de serie");
  const show = await tmdb("/tv/" + id, {});
  const all = (show && show.seasons) || [];
  const seasons = [];
  for (let i = 0; i < all.length && seasons.length < MAX_SEASONS; i++) {
    if (Number(all[i].season_number) > 0) seasons.push(Number(all[i].season_number));
  }
  const out = [];
  for (let s = 0; s < seasons.length; s++) {
    const sn = seasons[s];
    let data;
    try {
      data = await tmdb("/tv/" + id + "/season/" + sn, {});
    } catch (e) {
      log("temporada", sn, (e && e.message) || e);
      continue;
    }
    const eps = (data && data.episodes) || [];
    for (let e = 0; e < eps.length; e++) {
      const ep = eps[e];
      const n = Number(ep.episode_number);
      if (!n) continue;
      const node = {
        season: sn,
        number: n,
        ref: "ep:" + id + ":" + sn + ":" + n,
        title: String(ep.name || ("Episodio " + n)).slice(0, 200)
      };
      if (ep.overview) node.overview = String(ep.overview).slice(0, 500);
      if (ep.still_path) node.still = IMG + ep.still_path;
      if (/^\d{4}-\d{2}-\d{2}$/.test(ep.air_date || "")) node.airDate = ep.air_date;
      out.push(node);
      if (out.length >= MAX_EPISODES) break;
    }
    if (out.length >= MAX_EPISODES) break;
  }
  if (!out.length) throw kino.error("not_found", "sin episodios");
  return {
    series: {
      title: String(show.name || "Serie").slice(0, 200),
      poster: show.poster_path ? IMG + show.poster_path : undefined
    },
    episodes: out
  };
}

// ---------------------------------------------------------------- resolver

async function validateM3u8(url, referer) {
  try {
    const h = { "User-Agent": UA, "Accept": "*/*", "Range": "bytes=0-2048" };
    if (referer) h.Referer = referer;
    const text = await getText(url, h);
    return text.indexOf("#EXTM3U") !== -1;
  } catch (e) {
    return false;
  }
}

function m3u8In(text) {
  const out = [];
  const re = /https?:\/\/[^"'\s<>\\]+?\.m3u8[^"'\s<>\\]*/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (out.indexOf(m[0]) === -1) out.push(m[0]);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

function mp4In(text) {
  const out = [];
  const re = /https?:\/\/[^"'\s<>\\]+?\.mp4[^"'\s<>\\]*/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (out.indexOf(m[0]) === -1) out.push(m[0]);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

// Un servidor de MXL: manifiesto directo, archivo directo o página intermedia con el enlace dentro.
async function playable(url) {
  const u = cleanUrl(url);
  if (!u) return null;
  if (isM3u8(u)) {
    return (await validateM3u8(u)) ? { url: u, mime: "application/vnd.apple.mpegurl" } : null;
  }
  if (isMp4(u)) return { url: u, mime: "video/mp4" };

  let origin = u;
  const m = /^https?:\/\/[^/]+/.exec(u);
  if (m) origin = m[0];

  let text = "";
  try {
    text = await getText(u, {
      "User-Agent": UA, "Referer": origin + "/", "Origin": origin, "Accept": "*/*"
    });
  } catch (e) {
    return null;
  }
  if (!text) return null;
  if (text.indexOf("#EXTM3U") !== -1) return { url: u, mime: "application/vnd.apple.mpegurl" };
  if (blocked(text)) return null;

  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  const flat = json ? JSON.stringify(json) : text;

  const lists = m3u8In(flat);
  for (let i = 0; i < lists.length; i++) {
    if (await validateM3u8(lists[i], u)) return { url: lists[i], mime: "application/vnd.apple.mpegurl" };
  }
  const files = mp4In(flat);
  if (files.length) return { url: files[0], mime: "video/mp4" };

  const iframe = /<iframe[^>]+src=["']([^"']+)["']/i.exec(text);
  if (iframe && iframe[1]) {
    let embed = cleanUrl(iframe[1]);
    if (embed.indexOf("http") !== 0) {
      embed = origin + (embed.charAt(0) === "/" ? "" : "/") + embed;
    }
    return playable(embed);
  }
  return null;
}

function lazyRef(kind, id, sn, ep, index) {
  return kind === "ep"
    ? "ep:" + id + ":" + sn + ":" + ep + ":" + index
    : "mv:" + id + ":" + index;
}

export async function resolve(ref) {
  await null;
  const parts = String(ref || "").split(":");
  const kind = parts[0];
  const id = parts[1];
  if (!id || (kind !== "mv" && kind !== "ep")) throw kino.error("not_found", "ref");

  let path;
  if (kind === "mv") path = "/api/v1/movie/" + encodeURIComponent(id) + "/servers";
  else path = "/api/v1/tv/" + encodeURIComponent(id) + "/season/" + encodeURIComponent(parts[2]) +
    "/episode/" + encodeURIComponent(parts[3]) + "/servers";

  const data = await mxlJson(path);
  const raw = (data && data.servers) || [];
  const list = [];
  for (let i = 0; i < raw.length && list.length < MAX_SERVERS; i++) {
    const s = raw[i] || {};
    const u = cleanUrl(s.url || s.link || s.a);
    if (!u || !/^https?:\/\//i.test(u)) continue;
    list.push({ url: u, name: String(s.name || s.label || s.b || "Servidor").slice(0, 40) });
  }
  if (!list.length) throw kino.error("not_found", "sin servidores", { userMessage: pick(MSG.empty) });

  const index = Number(parts.length > (kind === "ep" ? 4 : 2) ? parts[kind === "ep" ? 4 : 2] : 0) || 0;
  const order = [];
  if (list[index]) order.push(index);
  for (let i = 0; i < list.length; i++) if (i !== index) order.push(i);

  let stream = null;
  let used = -1;
  for (let i = 0; i < order.length && !stream; i++) {
    const found = await playable(list[order[i]].url);
    if (found) { stream = found; used = order[i]; }
    else log("servidor sin enlace", list[order[i]].name);
  }
  if (!stream) throw kino.error("not_found", "sin enlace reproducible", { userMessage: pick(MSG.empty) });

  const alternatives = [];
  for (let i = 0; i < list.length && alternatives.length < 8; i++) {
    if (i === used) continue;
    alternatives.push({
      label: list[i].name,
      ref: lazyRef(kind, id, parts[2], parts[3], i)
    });
  }

  const out = { url: stream.url, mime: stream.mime };
  if (stream.mime === "application/vnd.apple.mpegurl") {
    out.headers = { "User-Agent": UA, "Referer": "https://prop.shiwaimov.com/" };
  }
  if (alternatives.length) out.alternatives = alternatives;
  return out;
}