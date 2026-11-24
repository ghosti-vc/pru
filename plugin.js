// Kino plugin: Kimera (kimeraweb.com) — películas y series.
// El sitio entrega el video sin audio y cada idioma en su propio playlist HLS.
// El video se arma como playlist .m3u8 (sin extensión el reproductor no lo reconoce) y los idiomas
// van como audioTracks, que Kino une al video y ofrece en su menú de audio.

const BASE = "https://kimeraweb.com";
const CDN = "https://cloudcdn.sbs";
const TYPES = "movies|series|dramas|animes|donghuas|shorts";
const AS_SERIES = new Set(["series", "dramas", "animes", "donghuas", "shorts"]);
const SOCIAL = "kinotvapp/kino-social";
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

// Cualquier dirección https; un camino suelto se resuelve contra el CDN.
function media(value) {
  let url = String(value || "").trim();
  if (!url) return undefined;
  if (url.startsWith("/")) url = CDN + url;
  return /^https:\/\//i.test(url) ? url : undefined;
}

// Igual que media(), pero garantiza la extensión .m3u8: sin ella Kino no detecta HLS.
function playlist(value) {
  const url = media(value);
  if (!url) return undefined;
  if (/\.m3u8/i.test(url)) return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url + ".m3u8" : url.slice(0, cut) + ".m3u8" + url.slice(cut);
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

// ── Fichas del HTML ───────────────────────────────────────────────────────────
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

// ── Catálogo ─────────────────────────────────────────────────────────────────
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

// ── Episodios ────────────────────────────────────────────────────────────────
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

// ── Reproducción ─────────────────────────────────────────────────────────────
export async function resolve(ref) {
  await null;
  const raw = String(ref || "");
  const cut = raw.indexOf("#");
  const base = cut === -1 ? raw : raw.slice(0, cut);
  const pick = cut === -1 ? "" : raw.slice(cut + 1);
  let [id, path] = splitRef(base);
  if (!id || !path.startsWith("/")) throw kino.error("not_found", "ref " + raw);

  // Una serie se abre por su primer episodio; un episodio ya trae su ruta de reproducción.
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
  const url = playlist(option.url);
  if (!url) throw kino.error("unavailable", "url rara");

  const alternatives = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i] === chosen || !all[i].option.url) continue;
    const label = (all[i].cat + " · " + (all[i].option.name || "Servidor")).slice(0, 48);
    alternatives.push({ label, ref: id + "|" + path + "#" + i });
    if (alternatives.length >= 8) break;
  }

  // El video viene mudo y cada idioma en su playlist: van como audioTracks, el latino primero.
  const audioTracks = [];
  if (String(option.track_mode || "") === "separated") {
    const tracks = (option.audio_tracks || []).slice().sort((a, b) => {
      const ea = String(a.language_code || "").toLowerCase().startsWith("es") ? 0 : 1;
      const eb = String(b.language_code || "").toLowerCase().startsWith("es") ? 0 : 1;
      return ea - eb;
    });
    for (const track of tracks) {
      const trackUrl = playlist(track.playlist_url);
      if (!trackUrl) continue;
      const lang = String(track.language_code || "und").slice(0, 16);
      const label = String(track.display_name || "Audio " + (audioTracks.length + 1)).slice(0, 40);
      audioTracks.push({ lang, url: trackUrl, label });
      if (audioTracks.length >= 8) break;
    }
  }

  const subtitles = [];
  for (const track of option.subtitles || []) {
    const trackUrl = media(track.url);
    if (!trackUrl) continue;
    subtitles.push({ lang: String(track.language_code || "und").slice(0, 16), url: trackUrl, format: "vtt" });
    if (subtitles.length >= 30) break;
  }

  const label = (chosen.cat + " · " + (option.name || "Servidor")).slice(0, 40);
  const stream = { url, headers, label, subtitles, audioTracks };
  if (alternatives.length) stream.alternatives = alternatives;
  log("resolve: video=" + url + " audios=" + audioTracks.length + " subs=" + subtitles.length);
  return stream;
}

// ── Pantalla ─────────────────────────────────────────────────────────────────
async function detail(ref) {
  const [id, path] = splitRef(ref);
  const kind = AS_SERIES.has(path.split("/")[1] || "") ? "series" : "movie";
  const info = { id: (kind === "series" ? "s" : "m") + id, kind, ref, title: "Kimera", poster: undefined, synopsis: "", episodes: [] };
  if (kind === "series") {
    const r = await episodes(ref);
    info.title = r.series.title;
    info.poster = r.series.poster;
    info.episodes = r.episodes.slice(0, 80).map((e) => ({ season: e.season, number: e.number, ref: e.ref, title: e.title }));
    info.total = r.episodes.length;
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
  const arg = { ref: episode ? episode.ref : info.ref, kind: info.kind, id: info.id, title: info.title };
  return arg;
}

function loaded(info) {
  const out = [];
  if (info.poster) out.push({ type: "Image", url: info.poster, alt: info.title, height: 220 });
  out.push({ type: "Text", text: info.title, maxLines: 3, canRequestFocus: true });
  out.push({
    type: "Text",
    text: info.kind === "series" ? t("Serie", "Series") : t("Película", "Movie"),
    canRequestFocus: true,
  });
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

export async function screen({ state, route }) {
  await null;
  const info = state && state.data;
  const title = (info && info.title) || "Kimera";
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar",
      mergeWithKinoBar: true,
      dense: true,
      title,
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