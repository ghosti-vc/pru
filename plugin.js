// Kino plugin: Kimera (kimeraweb.com) — películas y series.
// El sitio sirve el video sin audio y cada idioma en su propio playlist HLS. resolve() arma un
// master con EXT-X-MEDIA para que el reproductor reciba video y audio juntos; si el ajuste
// "mix" está apagado, entrega el video y los idiomas como audioTracks.

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

function https(value) {
  let url = String(value || "");
  if (url.startsWith("/")) url = CDN + url;
  return url.startsWith(CDN + "/") ? url : undefined;
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
// Cada aparición de una ficha es una tarjeta: portada y título se buscan en la ventana que llega
// hasta la aparición siguiente, así que el orden del HTML no importa.
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
    let poster = image ? https(attr(image[1], "data-src")) || https(attr(image[1], "src")) : undefined;
    if (!poster) {
      const background = /url\((['"]?)(https?:\/\/[^)'"]+)\1\)/i.exec(window);
      if (background) poster = https(background[2]);
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
// /catalog?q=&type=&tag=&sort=&page= trae las fichas dentro del JSON "catalog-initial-data".
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
        poster: https(it.vertical_cover_url) || https(it.cover_url),
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
        info.poster = https(data.cover_url);
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
function absUrl(base, ref) {
  if (/^https?:\/\//i.test(ref)) return ref;
  const origin = (/^(https?:\/\/[^\/]+)/i.exec(base) || [])[1] || "";
  if (ref.startsWith("/")) return origin + ref;
  return base.replace(/[?#].*$/, "").replace(/[^\/]*$/, "") + ref;
}

function absolute(text, base) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      const clean = line.trim();
      if (!clean) return line;
      if (clean[0] === "#") return line.replace(/URI="([^"]+)"/g, (_, u) => 'URI="' + absUrl(base, u) + '"');
      return absUrl(base, clean);
    })
    .join("\n");
}

// Master HLS con el video y los idiomas cosidos. Devuelve null si el video ya trae su audio.
async function master(videoUrl, tracks, headers) {
  const answer = await kino.fetch(videoUrl, { headers });
  if (!answer.ok) throw new Error("video " + answer.status);
  const raw = await body(answer);
  if (!/^#EXTM3U/.test(raw)) throw new Error("el video no es HLS");
  if (/#EXT-X-MEDIA:TYPE=AUDIO/i.test(raw)) return null;

  const out = ["#EXTM3U", "#EXT-X-VERSION:7"];
  const media = [];
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    try {
      const probe = await kino.fetch(track.url, { headers });
      if (!probe.ok) continue;
      if (!/^#EXTM3U/.test(await body(probe))) continue;
      const lang = String(track.lang || "und").toLowerCase().replace(/[^a-z-]/g, "").slice(0, 8) || "und";
      const name = String(track.label || "Audio " + (i + 1)).replace(/["\\]/g, "").slice(0, 40) || "Audio";
      media.push(
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="ka",NAME="' + name + '",LANGUAGE="' + lang +
        '",DEFAULT=' + (i === 0 ? "YES" : "NO") + ',AUTOSELECT=YES,URI="' + track.url + '"'
      );
    } catch (error) {
      log("audio " + i + " descartado: " + String(error.message || error).slice(0, 60));
    }
  }
  if (!media.length) throw new Error("sin audios utilizables");
  out.push(...media);

  if (/#EXT-X-STREAM-INF/i.test(raw)) {
    for (const line of absolute(raw, videoUrl).split(/\r?\n/)) {
      if (!line || /^#EXTM3U/.test(line)) continue;
      out.push(/^#EXT-X-STREAM-INF/i.test(line) ? line.replace(/\s+$/, "") + ',AUDIO="ka"' : line);
    }
  } else {
    out.push('#EXT-X-STREAM-INF:BANDWIDTH=4000000,AUDIO="ka"', videoUrl);
  }
  return out.join("\n");
}

function setting(key, fallback) {
  try {
    const v = typeof kino.config.get === "function" ? kino.config.get(key) : kino.config[key];
    return v === undefined || v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

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
  const url = https(option.url);
  if (!url) throw kino.error("unavailable", "url rara");

  const alternatives = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i] === chosen || !all[i].option.url) continue;
    const label = (all[i].cat + " · " + (all[i].option.name || "Servidor")).slice(0, 48);
    alternatives.push({ label, ref: id + "|" + path + "#" + i });
    if (alternatives.length >= 8) break;
  }

  const audioTracks = [];
  if (String(option.track_mode || "") === "separated") {
    for (const track of option.audio_tracks || []) {
      const trackUrl = https(track.playlist_url);
      if (!trackUrl) continue;
      const lang = String(track.language_code || "und").slice(0, 16);
      const label = String(track.display_name || "").slice(0, 40);
      audioTracks.push(label ? { lang, url: trackUrl, label } : { lang, url: trackUrl });
      if (audioTracks.length >= 8) break;
    }
  }

  const subtitles = [];
  for (const track of option.subtitles || []) {
    const trackUrl = https(track.url);
    if (!trackUrl) continue;
    subtitles.push({ lang: String(track.language_code || "und").slice(0, 16), url: trackUrl, format: "vtt" });
    if (subtitles.length >= 30) break;
  }

  const stream = { mime: "application/vnd.apple.mpegurl", headers, subtitles };
  if (alternatives.length) stream.alternatives = alternatives;

  // Coser el audio: sin esto el video va mudo.
  if (setting("mix", true) !== false && audioTracks.length) {
    try {
      const glued = await master(url, audioTracks, headers);
      if (glued) {
        log("master listo: " + glued.length + "B audios=" + audioTracks.length);
        return { ...stream, url: "data:application/vnd.apple.mpegurl;charset=utf-8," + encodeURIComponent(glued) };
      }
      log("el video ya trae audio");
    } catch (error) {
      log("master falló (" + String(error.message || error).slice(0, 60) + "): video + audioTracks");
      return { ...stream, url, audioTracks };
    }
  }
  return { ...stream, url, audioTracks };
}

// ── Pantalla ─────────────────────────────────────────────────────────────────
const PAGE = (appBar, children) => ({
  type: "Scaffold",
  appBar,
  body: { type: "SingleChildScrollView", children: [{ type: "Column", padding: 16, gap: 16, children }] },
});

const CLOSE = { type: "IconButton", icon: "close", labelText: "Cerrar", labelTextEn: "Close", onPressed: { close: true } };
const BACK = { type: "IconButton", icon: "arrow_back", labelText: "Atrás", labelTextEn: "Back", onPressed: { event: "back" } };

function bar(title, titleEn, leading, actions) {
  const appBar = { type: "AppBar", title, titleEn, mergeWithKinoBar: true, dense: true, leading };
  if (actions) appBar.actions = actions;
  return appBar;
}

const SHARE_BUTTON = {
  type: "IconButton", icon: "share", labelText: "Compartir", labelTextEn: "Share",
  devices: ["phone"], onPressed: { event: "shareOpen" },
};

function shareSheet(state) {
  const attach = state.attach !== false && state.tmdb > 0;
  const children = [
    { type: "Text", text: "Compartir en Kino Social", textEn: "Share to Kino Social", style: "h4" },
    { type: "TextField", key: "shareText", multiline: true, maxLines: 4, maxLength: 500, labelText: "Texto", labelTextEn: "Text", value: state.shareText || "" },
  ];
  if (state.tmdb > 0) {
    children.push({ type: "Switch", key: "shareAttach", labelText: "Adjuntar el título", labelTextEn: "Attach the title", value: attach, onChanged: "shareAttach" });
  }
  children.push({
    type: "Text", style: "caption", color: "muted",
    text: "Llega como borrador: tú lo revisas y lo publicas en Kino Social.",
    textEn: "It arrives as a draft: you review and post it in Kino Social.",
  });
  children.push({ type: "ElevatedButton", key: "shareSend", labelText: "Enviar", labelTextEn: "Send", submit: true });
  return {
    type: "BottomSheet",
    key: "share",
    children: [{ type: "Form", key: "shareForm", onSubmitted: "shareSend", children }],
  };
}

function rail(row) {
  const items = row.items.slice(0, 30).map((item) => ({ ...item, onTap: { event: "openItem", arg: item.ref } }));
  return { type: "titleRail", key: "rail-" + row.id, title: row.title, items, size: "small" };
}

export async function screen({ state = {}, route }) {
  const detail = route && route.name === "detail";

  if (detail) {
    const children = [];
    if (state.error) {
      children.push({ type: "errorState", title: t("No se pudo abrir", "Could not open"), text: state.error });
      children.push({ type: "ElevatedButton", labelText: "Reintentar", labelTextEn: "Retry", onPressed: "retry", autofocus: true });
    } else if (!state.item) {
      children.push({ type: "Skeleton", shape: "block", height: 240 });
      children.push({ type: "Skeleton", shape: "line", lines: 3 });
    } else {
      const item = state.item;
      if (item.poster) children.push({ type: "Image", url: item.poster, aspect: "2:3", width: 160, fit: "cover", fallback: { type: "Text", text: item.title, padding: 12 } });
      children.push({ type: "Text", text: item.title, style: "h2" });
      if (item.meta) children.push({ type: "Text", text: item.meta, style: "caption", color: "muted" });
      if (item.description) children.push({ type: "Text", text: item.description, maxLines: 8 });
      children.push({
        type: "ElevatedButton", key: "play", icon: "play", labelText: "Reproducir", labelTextEn: "Play",
        autofocus: true, onPressed: { event: "play", arg: item.ref },
      });
      const extra = [];
      if (state.tmdb > 0) extra.push({ type: "TextButton", icon: "share", labelText: "Compartir", labelTextEn: "Share", devices: ["phone"], onPressed: { event: "shareOpen" } });
      extra.push({ type: "TextButton", icon: "info", labelText: "Ver ficha en Kino", labelTextEn: "Open in Kino", onPressed: { event: "kinoTitle", arg: item.ref } });
      children.push({ type: "Row", wrap: true, gap: 8, children: extra });
      if (state.episodes && state.episodes.length) {
        children.push({ type: "Divider" });
        children.push({ type: "Text", text: "Episodios", textEn: "Episodes", style: "h4" });
        for (const one of state.episodes.slice(0, 60)) {
          children.push({
            type: "ListTile", key: "ep-" + one.ref, title: one.title, subtitle: "T" + one.season + " · " + one.number,
            onTap: { event: "play", arg: one.ref },
          });
        }
      }
    }
    const tree = PAGE(bar(t("Ficha", "Details"), "Details", BACK), children);
    if (state.shareOpen) tree.body.children[0].children.push(shareSheet(state));
    return tree;
  }

  const children = [
    { type: "TextField", key: "q", kind: "search", labelText: "Buscar en Kimera", labelTextEn: "Search Kimera", onSubmitted: "search" },
  ];
  if (state.error) {
    children.push({ type: "MaterialBanner", role: "error", text: state.error, action: { label: "Reintentar", labelEn: "Retry", onTap: "load" } });
  }
  if (state.query) {
    children.push({ type: "Text", text: "Resultados de «" + state.query + "»", textEn: "Results for “" + state.query + "”", style: "h4" });
    if (state.results && state.results.length) {
      children.push({ type: "titleGrid", key: "results", items: state.results, columns: { compact: 3, expanded: 6 } });
    } else if (state.searching) {
      children.push({ type: "Skeleton", shape: "card", height: 200 });
    } else {
      children.push({ type: "emptyState", title: t("Sin resultados", "No results"), icon: "search" });
    }
  } else if (!state.rows) {
    children.push({ type: "Skeleton", shape: "line", lines: 4 });
  } else {
    for (const row of state.rows) children.push(rail(row));
    if (!state.rows.length) children.push({ type: "emptyState", title: t("Nada por aquí", "Nothing here"), icon: "movie" });
    children.push({ type: "Divider" });
    children.push({ type: "Card", children: [{ type: "settings", key: "cfg" }] });
  }
  const tree = PAGE(bar("Kimera", "Kimera", CLOSE, [SHARE_BUTTON]), children);
  if (state.shareOpen) tree.body.children[0].children.push(shareSheet(state));
  return tree;
}

async function loadDetail(ref) {
  const [id, path] = splitRef(ref);
  if (!id || !path.startsWith("/")) return { error: t("Ficha rara", "Odd item") };
  const answer = await kino.fetch(BASE + path, { headers: HEADERS });
  if (!answer.ok) return { error: t("El título no está disponible", "The title is not available") };
  const data = json(await body(answer), "title-data");
  if (!data) return { error: t("No se pudo leer la ficha", "Could not read the item") };
  const kind = AS_SERIES.has(String(data.type || "")) ? "series" : "movie";
  const item = {
    ref,
    id,
    kind,
    title: decode(data.name).slice(0, 200) || "Kimera",
    poster: https(data.cover_url),
    description: decode(data.description || "").slice(0, 900),
    meta: (data.release_date ? String(data.release_date).slice(0, 4) + " · " : "") + (kind === "series" ? t("Serie", "Series") : t("Película", "Movie")),
  };
  let tmdb = 0;
  if (typeof kino.tmdb === "function" && item.title) {
    try {
      const found = await kino.tmdb(kind === "series" ? "/search/tv" : "/search/movie", { query: item.title, language: "es-CO" });
      const first = (found && found.results && found.results[0]) || null;
      if (first && first.id) tmdb = Number(first.id) || 0;
    } catch {
      tmdb = 0;
    }
  }
  const out = { item, tmdb };
  if (kind === "series") {
    try {
      const list = await episodes(ref);
      out.episodes = list.episodes;
    } catch {
      out.episodes = [];
    }
  }
  return out;
}

export async function screenEvent({ name, arg, value, state = {}, route, installed = {} }) {
  if (name === "open") {
    const asked = (route && ((route.args && route.args.ref) || (route.params && route.params.ref))) || state.ref || "";
    const onDetail = Boolean(route && route.name === "detail");
    if (asked && (!onDetail || !state.item)) {
      try {
        const data = await loadDetail(asked);
        const patch = { state: { ...data, ref: asked, shareOpen: false } };
        if (!onDetail) patch.route = { push: "detail", params: { ref: asked } };
        return patch;
      } catch (error) {
        log("detail falló " + asked + " " + String((error && error.code) || error).slice(0, 60));
        const patch = { state: { ref: asked, item: null, error: t("No se pudo abrir la ficha", "Could not open the page") } };
        if (!onDetail) patch.route = { push: "detail", params: { ref: asked } };
        return patch;
      }
    }
    if (onDetail) return null;
    if (state.rows) return null;
    try {
      const rows = await home();
      return { state: { rows, error: null } };
    } catch (error) {
      return { state: { error: t("Kimera no responde ahora", "Kimera is not answering now") } };
    }
  }

  if (name === "load") {
    return { state: { rows: null, error: null } };
  }

  if (name === "search") {
    const q = String(value || "").trim();
    if (!q) return { state: { query: null, results: [] } };
    const found = await search(q);
    const items = found.slice(0, 60).map((x) => ({
      ...x,
      open: { screen: { args: { ref: x.ref } } },
      onTap: { event: "openItem", arg: x.ref },
    }));
    return { state: { query: q, results: items, searching: false } };
  }

  if (name === "openItem") {
    const ref = String(arg || "");
    log("abrir " + ref);
    try {
      const data = await loadDetail(ref);
      return { state: { ...data, ref, shareOpen: false }, route: { push: "detail", params: { ref } } };
    } catch (error) {
      log("detail falló " + ref + " " + String((error && error.code) || error).slice(0, 60));
      return { state: { ref, item: null, error: t("No se pudo abrir la ficha", "Could not open the page") }, route: { push: "detail", params: { ref } } };
    }
  }

  if (name === "back") return { route: { pop: true } };

  if (name === "retry") {
    const ref = (route && ((route.args && route.args.ref) || (route.params && route.params.ref))) || state.ref || "";
    try {
      const data = await loadDetail(ref);
      return { state: { ...data, ref, shareOpen: false, error: null } };
    } catch (error) {
      log("detail falló " + ref);
      return { state: { ref, item: null, error: t("No se pudo abrir la ficha", "Could not open the page") } };
    }
  }

  if (name === "play") {
    const ref = String(arg || "");
    const item = state.item || {};
    return { go: { play: { ref, kind: item.kind === "series" ? "episode" : "movie", id: item.id, title: item.title } } };
  }

  if (name === "kinoTitle") {
    const item = state.item || {};
    return { go: { title: { ref: String(arg || item.ref || ""), kind: item.kind || "movie", id: item.id, title: item.title } } };
  }

  if (name === "shareOpen") {
    const item = state.item;
    const base = item ? t("Estoy viendo «" + item.title + "» en Kimera", "I'm watching “" + item.title + "” on Kimera") : "Kimera: películas y series en español";
    return { ui: [{ open: "share" }], state: { shareOpen: true, shareText: base.slice(0, 500), attach: state.tmdb > 0 } };
  }

  if (name === "shareAttach") {
    return { state: { attach: value === true } };
  }

  if (name === "shareSend") {
    const form = value && typeof value === "object" ? value : {};
    const inputs = state.inputs || {};
    const shareText = String(form.shareText ?? inputs.shareText ?? state.shareText ?? "").slice(0, 500);
    const attach = form.shareAttach ?? inputs.shareAttach ?? state.attach;
    if (!shareText && !(attach && state.tmdb > 0)) {
      return { toast: t("Escribe algo antes de enviar", "Write something before sending") };
    }
    if (typeof kino.plugins !== "object" || !kino.plugins) {
      return { ui: [{ close: "share" }], toast: t("Actualiza Kino para compartir en Kino Social", "Update Kino to share to Kino Social") };
    }
    const item = state.item || {};
    const payload = { text: shareText, from: "Kimera" };
    if (attach && state.tmdb > 0) payload.title = { kind: item.kind === "series" ? "series" : "movie", tmdb: state.tmdb };
    try {
      await kino.plugins.call("social", "share", payload);
      return { ui: [{ close: "share" }], state: { shareOpen: false }, toast: t("Queda como borrador en Kino Social", "It waits as a draft in Kino Social") };
    } catch (error) {
      const code = String((error && error.code) || "");
      if (code === "provider_missing") {
        if (installed[SOCIAL] !== true) return { go: { installPlugin: { repo: SOCIAL } } };
        return { toast: t("Kino Social está apagado o le falta configurarse", "Kino Social is off or needs setting up") };
      }
      if (code === "not_declared") return { toast: t("Actualiza Kino Social", "Update Kino Social") };
      return { toast: t("No se pudo enviar a Kino Social", "Could not send to Kino Social") };
    }
  }

  return null;
}