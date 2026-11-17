// Cine TV: películas, series, anime y doramas desde varias fuentes, unidas en una sola lista.
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const enc = encodeURIComponent;
const e2 = (s) => enc(s).replace(/~/g, "%7E");

function log(...a) { try { kino.log(...a); } catch { /* sin registro */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function dec(s) { try { return decodeURIComponent(s); } catch { return String(s || ""); } }
function msg(e) { return String((e && e.message) || e).slice(0, 80); }
function decodeEnt(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
function text(s) { return decodeEnt(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()); }
function abs(base, u) { if (!u) return ""; try { return new URL(u, base).href; } catch { return ""; } }
function pathOf(u) { return String(u).replace(/^https?:\/\/[^/]+/, ""); }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }
function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
function attrs(tag) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(tag))) out[(m[1] || m[3]).toLowerCase()] = decodeEnt(m[2] != null ? m[2] : m[4]);
  return out;
}
const TMDB_IMG = "https://image.tmdb.org/t/p/w342";
const TMDB_STILL = "https://image.tmdb.org/t/p/w300";
function tmdb(p, base) { return !p ? undefined : /^https?:/.test(p) ? p : p.startsWith("/") ? (base || TMDB_IMG) + p : undefined; }


const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64bin(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  let out = "", bits = 0, acc = 0;
  for (let i = 0; i < s.length; i++) {
    acc = (acc << 6) | B64.indexOf(s[i]); bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((acc >> bits) & 255); }
  }
  return out;
}
function b64utf8(s) { try { return decodeURIComponent(b64bin(s).split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")); } catch { return b64bin(s); } }
function b64enc(str) {
  const bytes = unescape(encodeURIComponent(str));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes.charCodeAt(i), b = bytes.charCodeAt(i + 1), c = bytes.charCodeAt(i + 2);
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)] + (i + 1 < bytes.length ? B64[((b & 15) << 2) | ((c || 0) >> 6)] : "=") + (i + 2 < bytes.length ? B64[c & 63] : "=");
  }
  return out;
}

// ---- Red (con cookies a mano para los sitios que las piden) -------------------------------------
const jars = {};
function jarSave(u, r) {
  let sc = "";
  try { sc = (r.headers && (r.headers.get ? r.headers.get("set-cookie") : r.headers["set-cookie"])) || ""; } catch { /* sin cabecera */ }
  if (!sc) return;
  const j = jars[hostOf(u)] || (jars[hostOf(u)] = {});
  String(sc).split(/,(?=\s*[^;,\s]+=)/).forEach((c) => {
    const kv = c.split(";")[0].trim();
    const i = kv.indexOf("=");
    if (i > 0) j[kv.slice(0, i)] = kv.slice(i + 1);
  });
}
function jarHeader(u) { const j = jars[hostOf(u)]; return j ? Object.keys(j).map((k) => k + "=" + j[k]).join("; ") : ""; }

async function web(url, opt) {
  const o = opt || {};
  const go = async (extra) => {
    const h = Object.assign({ "User-Agent": UA, "Accept-Language": "es-MX,es;q=0.9" }, o.headers || {});
    const ck = [jarHeader(url), extra].filter(Boolean).join("; ");
    if (ck) h.Cookie = ck;
    const r = await kino.fetch(url, { method: o.method || "GET", headers: h, body: o.body });
    jarSave(url, r);
    return { r, t: String(await r.text()) };
  };
  let x = await go("");
  if (x.r.status === 503) {
    const m = /document\.cookie\s*=\s*['"]ypg_chal=([0-9]{9,12}\.[a-f0-9]{64});/.exec(x.t);
    if (m) x = await go("ypg_chal=" + m[1]);
  }
  if (!x.r.ok) throw kino.error("unavailable", "web " + x.r.status + " " + hostOf(url));
  return x.t;
}
async function jget(url, referer) {
  const t = await web(url, { headers: { Accept: "application/json, text/plain, */*", Referer: referer || "" } });
  try { return JSON.parse(t); } catch { throw kino.error("unavailable", "json inválido " + hostOf(url)); }
}
async function gqlPost(api, site, query, variables, referer) {
  const t = await web(api, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: site, Referer: referer || site + "/", "x-brand-host": hostOf(site), "x-forwarded-host": hostOf(site) },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  let j;
  try { j = JSON.parse(t); } catch { throw kino.error("unavailable", "graphql inválido"); }
  if (!j || j.errors || !j.data) throw kino.error("unavailable", "graphql: " + msg(j && j.errors && j.errors[0] && j.errors[0].message));
  return j.data;
}

// Datos de Next.js incrustados (self.__next_f.push).
function flight(html) {
  let out = "";
  const re = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g;
  let m;
  while ((m = re.exec(html))) { try { out += JSON.parse(m[1]); } catch { /* trozo ilegible */ } }
  return out;
}
function jsonAt(s, start) {
  const open = s[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) return null;
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
function jsonAfter(s, marker) { const i = s.indexOf(marker); return i < 0 ? null : jsonAt(s, i + marker.length); }

// =====================================================================================================
// FUENTES. Cada una ofrece: cats, list(cat, página), search(q), episodes(key), embeds(key, esPelícula)
//   cat: movie | series | anime | dorama | dmovie
//   item: { key, title, year, poster, cat, movie }     episodio: { season, number, key, title, thumb }
//   embed: { url, server, lang }
// =====================================================================================================
const SRC = {};
const nn = (x) => (x == null ? "" : String(x));

// ---- HackStore (API JSON) -----------------------------------------------------------------------
{
  const SITE = "https://hackstore3.net", API = SITE + "/wp-api/v1", PER = 24;
  const TYPES = { movie: "movies", series: "tvshows", anime: "animes" };
  const api = (p, q) => jget(API + p + "?" + Object.keys(q).map((k) => k + "=" + enc(q[k])).join("&"), SITE + "/");
  function item(o, cat) {
    const id = o._id || o.id || o.tmdb_id;
    if (!Number.isInteger(id)) return null;
    const raw = String(o.type || o.postType || (cat === "movie" ? "movies" : cat === "anime" ? "animes" : "tvshows"));
    const kind = /movie/.test(raw) ? "movie" : /anime/.test(raw) ? "anime" : "tvshow";
    const poster = (o.images && o.images.poster) || o.poster || "";
    const year = nn(o.release_date).split("-")[0] || (Array.isArray(o.years) ? nn(o.years[0]) : "");
    return {
      key: kind + ":" + id + ":" + nn(o.slug), title: text(o.title || o.original_title), year,
      poster: poster.startsWith("/") ? SITE + "/wp-content/uploads" + poster : /^https?:/.test(poster) ? poster : undefined,
      cat: kind === "movie" ? "movie" : kind === "anime" ? "anime" : "series", movie: kind === "movie",
    };
  }
  SRC.hs = {
    name: "HackStore", cats: ["movie", "series", "anime"],
    async list(cat, page) {
      const t = TYPES[cat];
      const d = await api("/listing/" + t, { page, orderBy: "latest", order: "desc", postType: t, postsPerPage: PER });
      const posts = (d.data && d.data.posts) || [];
      const pg = (d.data && d.data.pagination) || {};
      return { items: posts.map((p) => item(p, cat)).filter(Boolean), hasNext: "totalPages" in pg ? page < pg.totalPages : posts.length >= PER };
    },
    async search(q) {
      const d = await api("/search", { q, postType: "any", postsPerPage: 24 });
      return ((d.data && d.data.posts) || []).map((p) => item(p)).filter(Boolean);
    },
    async episodes(key) {
      const id = Number(key.split(":")[1]);
      const first = await api("/single/episodes/list", { _id: id, season: 1, page: 1, postsPerPage: 50 });
      let seasons = ((first.data && first.data.seasons) || ["1"]).map(String).filter((s) => /^\d+$/.test(s));
      if (!seasons.includes("1")) seasons.unshift("1");
      const out = [];
      await Promise.all(seasons.map(async (s) => {
        for (let pg = 1; pg <= 6; pg++) {
          const d = s === "1" && pg === 1 ? first : await api("/single/episodes/list", { _id: id, season: s, page: pg, postsPerPage: 50 });
          const posts = (d.data && d.data.posts) || [];
          posts.forEach((e) => {
            const n = Number(e.episode_number) || 1;
            out.push({ season: Number(s), number: n, key: nn(e._id || e.id), title: text(e.title) || "", thumb: tmdb(e.still_path, TMDB_STILL), overview: text(e.overview).slice(0, 400) });
          });
          if (posts.length < 50) break;
        }
      }));
      return out;
    },
    async embeds(key) {
      const id = key.includes(":") ? key.split(":")[1] : key;
      const d = await api("/player", { postId: id, demo: 0 });
      return (((d.data && d.data.embeds) || [])).filter((e) => /^https?:/.test(nn(e.url)) && !/la\.movie/.test(e.url))
        .map((e) => ({ url: e.url, server: nn(e.serverName || e.server), lang: nn(e.lang) }));
    },
    epKeyIsId: true,
  };
}

// ---- PelisJuanita (API JSON) --------------------------------------------------------------------
{
  const SITE = "https://pelisjuanita.org", API = SITE + "/api/rest/v1", PER = 24;
  const KIND = { movie: "movie", series: "serie", anime: "anime" };
  const api = (p, q) => jget(API + p + (q ? "?" + Object.keys(q).map((k) => k + "=" + enc(q[k])).join("&") : ""), SITE + "/");
  function item(o, cat) {
    const id = o.catalog_item_id || o.id || o.tmdb_id;
    if (!Number.isInteger(id)) return null;
    const raw = o.kind || (cat === "series" ? "serie" : cat) || "movie";
    const k = raw === "movie" ? "movie" : raw === "anime" ? "anime" : "serie";
    return {
      key: k + ":" + id + ":" + nn(o.slug), title: text(o.title || o.name || o.original_title),
      year: nn(o.year || nn(o.release_date).slice(0, 4)), poster: tmdb(o.poster_path),
      cat: k === "movie" ? "movie" : k === "anime" ? "anime" : "series", movie: k === "movie",
    };
  }
  SRC.pj = {
    name: "PelisJuanita", cats: ["movie", "series", "anime"],
    async list(cat, page) {
      const d = await api("/listing", { kind: KIND[cat], order: "recent", page });
      const items = d.items || [];
      return { items: items.map((x) => item(x, cat)).filter(Boolean), hasNext: d.pagination && "has_next" in d.pagination ? !!d.pagination.has_next : items.length >= PER };
    },
    async search(q) { const d = await api("/search", { q }); return (d.items || []).map((x) => item(x)).filter(Boolean); },
    async episodes(key) {
      const [kind, id, slug] = key.split(":");
      const det = slug ? await api("/content/" + (kind === "anime" ? "anime" : "serie") + "/" + enc(slug)) : {};
      const seasons = ((det.episode_seasons || []).map((s) => s.season).filter((s) => Number.isInteger(s)));
      const out = [];
      await Promise.all((seasons.length ? seasons : [1]).map(async (s) => {
        const d = await api("/episodes", { item_id: id, season: s, limit: 50, page: 1 });
        (d.episodes || []).forEach((e) => out.push({ season: s, number: Number(e.episode) || 1, key: e.player_url ? "u" + enc(e.player_url) : "", title: text(e.title), thumb: tmdb(e.still_path, TMDB_STILL), overview: text(e.overview).slice(0, 400) }));
      }));
      return out.filter((e) => e.key);
    },
    async embeds(key, movie) {
      let url = "";
      if (!movie && key.startsWith("u")) url = dec(key.slice(1));
      else {
        const [kind, , slug] = key.split(":");
        const det = await api("/content/" + (kind === "movie" ? "movie" : kind === "anime" ? "anime" : "serie") + "/" + enc(slug));
        url = (det.item && det.item.player_url) || "";
      }
      if (!url) return [];
      const html = await web(url, { headers: { Referer: SITE + "/" } });
      const out = [];
      const re = /<iframe[^>]*src=["']([^"']+)["']/gi;
      let m;
      while ((m = re.exec(html))) if (/^https?:/.test(m[1])) out.push({ url: m[1], server: hostOf(m[1]), lang: "" });
      return out;
    },
  };
}

// ---- FuegoCine (feeds de Blogger) ---------------------------------------------------------------
{
  const SITE = "https://www.fuegocine.com", PER = 20;
  const LABEL = { movie: "Movie", series: "Serie", anime: "Anime" };
  const attr = (s, n) => { const m = new RegExp("\\b" + n + "=['\"]([^'\"]*)['\"]", "i").exec(s); return m ? decodeEnt(m[1]) : ""; };
  async function feed(label, q, start, limit) {
    const path = label ? "/feeds/posts/default/-/" + enc(label) : "/feeds/posts/default";
    const url = SITE + path + "?alt=json&start-index=" + start + "&max-results=" + limit + (q ? "&q=" + enc(q) : "");
    const j = await jget(url, SITE + "/");
    return (j.feed && j.feed.entry) || [];
  }
  function item(e) {
    const labels = (e.category || []).map((c) => c.term);
    if (labels.includes("Episode")) return null;
    const link = ((e.link || []).find((l) => l.rel === "alternate") || {}).href || "";
    if (hostOf(link) !== "fuegocine.com") return null;
    const content = (e.content && e.content.$t) || "";
    const ptype = (/data-post-type=['"]([^'"]+)['"]/i.exec(content) || [])[1] || "";
    const title = text((e.title && e.title.$t) || "");
    let serie = false;
    if (/^serie$/i.test(ptype)) serie = true;
    else if (/^movie$/i.test(ptype)) serie = false;
    else if (labels.includes("Movie")) serie = false;
    else serie = labels.includes("Serie") || /temporadas/i.test(title);
    const anime = labels.includes("Anime");
    const cover = /<div\b[^>]*data-post-type=['"][^'"]+['"][^>]*>\s*<img\b[^>]*>/i.exec(content);
    const img = (cover ? attr(cover[0], "src") : "") || (e["media$thumbnail"] && e["media$thumbnail"].url) || "";
    const year = attr(content, "data-year") || ((/\((\d{4})\)/.exec(title) || [])[1] || "");
    return { key: pathOf(link), title: title.replace(/\s*\(\d{4}\)\s*$/, ""), year, poster: /^https?:/.test(img) ? img : undefined, cat: serie ? (anime ? "anime" : "series") : "movie", movie: !serie };
  }
  SRC.fc = {
    name: "FuegoCine", cats: ["movie", "series", "anime"],
    async list(cat, page) {
      const entries = await feed(LABEL[cat], "", (page - 1) * PER + 1, PER);
      const items = entries.map(item).filter(Boolean).filter((x) => cat === "movie" ? x.movie : !x.movie);
      return { items, hasNext: entries.length >= PER };
    },
    async search(q) { return (await feed("", q, 1, 30)).map(item).filter(Boolean); },
    async episodes(key) {
      const page = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const pid = (/<article\b[^>]*data-post-id=['"](\d+)['"]/i.exec(page) || [])[1];
      if (!pid) return [];
      const out = [];
      for (let start = 1; start <= 450;) {
        const entries = await feed("id-" + pid, "", start, 150);
        if (!entries.length) break;
        entries.forEach((e) => {
          const body = (e.content && e.content.$t) || "";
          const title = text((e.title && e.title.$t) || "");
          let s = attr(body, "data-season-number"), n = attr(body, "data-episode-count");
          if (!s || !n) { const m = /(\d+)\s*x\s*(\d+)/i.exec(title); if (m) { s = m[1]; n = m[2]; } }
          const link = ((e.link || []).find((l) => l.rel === "alternate") || {}).href || "";
          if (!s || !n || !link) return;
          out.push({ season: Number(s), number: Number(n), key: pathOf(link), title, thumb: attr(body, "data-backdrop") || undefined });
        });
        start += entries.length;
        if (entries.length < 150) break;
      }
      return out;
    },
    async embeds(key) {
      const page = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const m = /\bconst\s+_SV_LINKS\s*=\s*\[([\s\S]*?)\]\s*;?/i.exec(page);
      if (!m) return [];
      const out = [];
      (m[1].match(/\{[^{}]*\}/g) || []).forEach((b) => {
        const v = {};
        b.replace(/\b(lang|name|quality|url)\s*:\s*['"]([^'"]*)['"]/gi, (_, k, val) => { v[k.toLowerCase()] = decodeEnt(val); return ""; });
        if (/^https?:/.test(nn(v.url).trim())) {
          let u = v.url.trim();
          if (/repfuegocinefree/.test(u)) { try { const t = new URL(u).searchParams.get("link"); if (t && /^https?:/.test(t)) u = t; } catch { /* queda la original */ } }
          out.push({ url: u, server: nn(v.name), lang: nn(v.lang) });
        }
      });
      return out;
    },
  };
}

// ---- CineCalidad (películas, HTML) --------------------------------------------------------------
{
  const SITE = "https://www.cinecalidad.my";
  const PLAYERS = {
    OnlineVoe: ["Voe", "https://voe.sx/e/"], OnlineFilemoon: ["Filemoon", "https://bysedikamoum.com/e/"],
    OnlineDoodstream: ["Doodstream", "https://doodstream.com/e/"], OnlineMega: ["Mega", "https://mega.nz/embed/"],
    OnlineNetu: ["Netu", "https://www.zarato.top/watch_video.php?v="],
  };
  function cards(html) {
    const out = [], seen = new Set();
    html.split(/class="[^"]*\bhome_post_cont\b/i).slice(1).forEach((b) => {
      const a = /<a\b([^>]*href=[^>]*)>/i.exec(b), im = /<img\b([^>]*)>/i.exec(b);
      if (!a || !im) return;
      const path = pathOf(abs(SITE, attrs(a[1]).href));
      const ia = attrs(im[1]);
      const name = text(ia.alt || ia.title);
      if (!/^\/pelicula\//.test(path) || !name || seen.has(path)) return;
      seen.add(path);
      const y = /\((\d{4})\)\s*$/.exec(name);
      out.push({ key: path, title: name.replace(/\s*\(\d{4}\)\s*$/, ""), year: y ? y[1] : "", poster: abs(SITE, ia["data-src"] || ia.src) || undefined, cat: "movie", movie: true });
    });
    return out;
  }
  SRC.cc = {
    name: "CineCalidad", cats: ["movie"],
    async list(cat, page) {
      const html = await web(SITE + (page > 1 ? "/page/" + page + "/" : "/"), { headers: { Referer: SITE + "/" } });
      return { items: cards(html), hasNext: new RegExp("/page/" + (page + 1) + "/?[\"']").test(html) };
    },
    async search(q) { return cards(await web(SITE + "/?s=" + enc(q), { headers: { Referer: SITE + "/" } })); },
    async episodes() { return []; },
    async embeds(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const i = html.indexOf("panel_online");
      const out = [], seen = new Set();
      const re = /<a\b([^>]*\bservice=[^>]*)>/gi;
      let m;
      const chunk = i >= 0 ? html.slice(i) : html;
      while ((m = re.exec(chunk))) {
        const a = attrs(m[1]);
        const p = PLAYERS[a.service];
        if (!p || !/^[\w#-]+$/.test(nn(a.data).trim())) continue;
        const url = p[1] + a.data.trim();
        if (!seen.has(url)) { seen.add(url); out.push({ url, server: p[0], lang: "Latino" }); }
      }
      return out;
    },
  };
}

// ---- Pelisflix (HTML) ---------------------------------------------------------------------------
{
  const SITE = "https://pelisflix200.store";
  function cards(html) {
    const out = [], seen = new Set();
    (html.match(/<article[\s\S]*?<\/article>/gi) || []).forEach((art) => {
      const u = /<a\s+[^>]*href="([^"]+)"/i.exec(art);
      const t = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/i.exec(art) || /alt="([^"]+)"/i.exec(art);
      if (!u || !t) return;
      const path = pathOf(abs(SITE, u[1]));
      if (seen.has(path) || !/^\/(pelicula|serie)s?\//.test(path)) return;
      const im = /<img\b([^>]*)>/i.exec(art);
      const ia = im ? attrs(im[1]) : {};
      seen.add(path);
      const serie = /^\/serie/.test(path);
      out.push({ key: path, title: text(t[1]), year: "", poster: abs(SITE, ia["data-src"] || ia.src) || undefined, cat: serie ? "series" : "movie", movie: !serie });
    });
    return out;
  }
  SRC.pf = {
    name: "Pelisflix", cats: ["movie", "series"],
    async list(cat, page) {
      const html = await web(SITE + (cat === "series" ? "/series" : "/peliculas") + (page > 1 ? "/page/" + page + "/" : ""), { headers: { Referer: SITE + "/" } });
      const items = cards(html).filter((x) => (cat === "series") === !x.movie);
      return { items, hasNext: new RegExp("/page/" + (page + 1) + "/?[\"']").test(html) };
    },
    async search(q) { return cards(await web(SITE + "/?s=" + enc(q), { headers: { Referer: SITE + "/" } })); },
    async episodes(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const seasonUrls = [...new Set(html.match(/href="([^"]+\/temporada\/[^"]+)"/gi) || [])].map((x) => abs(SITE, /href="([^"]+)"/i.exec(x)[1]));
      const pages = seasonUrls.length ? await Promise.all(seasonUrls.map((u) => web(u, { headers: { Referer: SITE + "/" } }).catch(() => ""))) : [html];
      const seen = new Set(), out = [];
      pages.forEach((h) => {
        const re = /<a\s+href="([^"]+\/episodio\/[^"]+-(\d+)x(\d+)\/?)"/gi;
        let m;
        while ((m = re.exec(h))) {
          const path = pathOf(abs(SITE, m[1]));
          if (seen.has(path)) continue;
          seen.add(path);
          out.push({ season: Number(m[2]), number: Number(m[3]), key: path, title: "" });
        }
      });
      return out;
    },
    async embeds(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const out = [], seen = new Set();
      const add = (u) => { if (/^https?:/.test(u) && !seen.has(u) && !/pelisflix/.test(u)) { seen.add(u); out.push({ url: u, server: hostOf(u), lang: "" }); } };
      new Set(html.match(/data-url="([^"]+)"/gi) || []).forEach((x) => {
        try {
          const d = b64utf8(/data-url="([^"]+)"/i.exec(x)[1]);
          if (/nupload\.my/.test(d)) { const t = new URL(d).searchParams.get("url"); if (t) add(t); } else add(d);
        } catch { /* no es base64 */ }
      });
      (html.match(/<iframe[^>]*src="([^"]+)"/gi) || []).forEach((x) => add(/src="([^"]+)"/i.exec(x)[1]));
      return out;
    },
  };
}

// ---- DoramasFlix (GraphQL) ----------------------------------------------------------------------
{
  const SITE = "https://doramasflix.io", API = "https://user-api.fluxcedene.net/graphql", PER = 24;
  const gql = (q, v, ref) => gqlPost(API, SITE, q, v, ref || SITE + "/doramas");
  function item(x, movie) {
    const title = text(x.name_es || x.name);
    if (!title || !x.slug) return null;
    return { key: (movie ? "m:" : "s:") + (x._id || "-") + ":" + x.slug, title, year: "", poster: tmdb(x.poster || x.poster_path), cat: movie ? "dmovie" : "dorama", movie: !!movie };
  }
  const EPF = "slug episode_number name name_es still_path backdrop overview";
  async function allEps(sid, extra, ref, withIds) {
    const out = [];
    for (let p = 1; p <= 15; p++) {
      const d = await gql("{paginationEpisode(filter:{serie_id:" + JSON.stringify(sid) + extra + "},page:" + p + ",limit:100){items{" + EPF + (withIds ? " _id season_number" : "") + "} pageInfo{hasNextPage}}}", null, ref);
      const data = d.paginationEpisode;
      if (!data || !Array.isArray(data.items)) throw kino.error("unavailable", "capítulos inválidos");
      out.push(...data.items);
      if (!(data.pageInfo && data.pageInfo.hasNextPage)) break;
    }
    return out;
  }
  const epOut = (x, s) => ({ season: s, number: Number(x.episode_number) || 1, key: nn(x._id || "-") + ":" + x.slug, title: text(x.name_es || x.name), thumb: tmdb(x.still_path || x.backdrop, TMDB_STILL), overview: text(x.overview).slice(0, 400) });
  SRC.fx = {
    name: "DoramasFlix", cats: ["dorama", "dmovie"],
    async list(cat, page) {
      const field = cat === "dmovie" ? "paginationMovie" : "paginationDorama";
      const d = await gql("query C($page:Int,$limit:Int){" + field + "(page:$page,limit:$limit){pageInfo{hasNextPage} items{_id slug name name_es poster_path poster}}}", { page, limit: PER });
      const data = d[field];
      if (!data || !Array.isArray(data.items)) throw kino.error("unavailable", "catálogo vacío");
      return { items: data.items.map((x) => item(x, cat === "dmovie")).filter(Boolean), hasNext: !!(data.pageInfo && data.pageInfo.hasNextPage) };
    },
    async search(q) {
      const d = await gql("query S($input:String,$limit:Int){searchDorama(input:$input,limit:$limit){_id slug name name_es poster_path poster} searchMovie(input:$input,limit:$limit){_id slug name name_es poster_path poster}}", { input: q.replace(/[<>"\\]/g, " "), limit: 20 });
      return (d.searchDorama || []).map((x) => item(x, false)).concat((d.searchMovie || []).map((x) => item(x, true))).filter(Boolean);
    },
    async episodes(key) {
      const [, id, slug] = key.split(":");
      if (id && id !== "-") {
        try {
          const items = await allEps(id, "", SITE + "/doramas/" + slug, true);
          const out = items.map((x) => (Number(x.season_number) >= 0 ? epOut(x, Number(x.season_number)) : null));
          if (out.length && out.every(Boolean)) return out;
        } catch (e) { log("flix capítulos rápidos: " + msg(e)); }
      }
      const url = SITE + "/doramas/" + slug;
      const f = flight(await web(url));
      const m = /\{"serie_id":"([0-9a-f]{24})","seasons":/.exec(f);
      if (!m) return [];
      const meta = jsonAt(f, m.index);
      const seasons = ((meta && meta.seasons) || []).map((s) => Number(s.season_number)).filter((n) => n >= 0);
      const lists = await Promise.all(seasons.map((sn) => allEps(m[1], ",season_number:" + sn, url, false).then((it) => it.map((x) => epOut(x, sn)))));
      return [].concat(...lists);
    },
    async embeds(key, movie) {
      const parts = key.split(":");
      let id = parts[movie ? 1 : 0], slug = parts[movie ? 2 : 1];
      const pageUrl = SITE + (movie ? "/peliculas/" : "/capitulos/") + slug;
      const pagePromise = web(pageUrl).then(flight).catch(() => "");
      if (!id || id === "-") {
        const f = await pagePromise;
        const m = movie ? /\{"movie":\{"_id":"([0-9a-f]{24})"/.exec(f) : /\{"episode":\{"_id":"([0-9a-f]{24})"/.exec(f);
        if (!m) return [];
        id = m[1];
      }
      const field = movie ? "getMovieLinks" : "getEpisodeLinks";
      const [d, f] = await Promise.all([gql("{" + field + "(id:" + JSON.stringify(id) + "){links_online{link server lang is_recommended}}}", null, pageUrl), pagePromise]);
      const links = (d[field] && d[field].links_online) || [];
      const sv = {}, lg = {};
      (jsonAfter(f, '"listServers":') || []).forEach((x) => { if (x && x.code_flix != null) sv[String(x.code_flix)] = x.name; });
      (jsonAfter(f, '"langs":') || []).forEach((x) => { if (x && x.code_flix != null) lg[String(x.code_flix)] = x.name; });
      return links.filter((x) => x && /^https?:/.test(nn(x.link))).map((x) => ({ url: x.link, server: sv[String(x.server)] || nn(x.server), lang: lg[String(x.lang)] || nn(x.lang), rec: !!x.is_recommended }));
    },
  };
}

// ---- DoramasYT (HTML + AJAX) --------------------------------------------------------------------
{
  const SITE = "https://www.doramasyt.com";
  function cards(html, cat) {
    const out = [], seen = new Set();
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      const path = pathOf(abs(SITE, attrs(m[1]).href || ""));
      if (!/^\/dorama\/[^/?#]+\/?$/.test(path) || seen.has(path)) continue;
      const im = /<img\b([^>]*)>/i.exec(m[2]);
      const ia = im ? attrs(im[1]) : {};
      const h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(m[2]);
      const title = (h3 ? text(h3[1]) : "") || text(ia.alt) || text(m[2]);
      if (!title) continue;
      seen.add(path);
      out.push({ key: path, title, year: "", poster: abs(SITE, ia["data-src"] || ia.src) || undefined, cat, movie: cat === "dmovie" });
    }
    return out;
  }
  SRC.yt = {
    name: "DoramasYT", cats: ["dorama", "dmovie"],
    async list(cat, page) {
      const html = await web(SITE + (cat === "dmovie" ? "/peliculas" : "/doramas") + (page > 1 ? "?p=" + page : ""));
      const items = cards(html, cat);
      return { items, hasNext: items.length > 0 && new RegExp("[?&]p=" + (page + 1) + "(?!\\d)").test(html) };
    },
    async search(q) { return cards(await web(SITE + "/buscar?q=" + enc(q)), "dorama"); },
    async episodes(key) {
      const url = SITE + key;
      const html = await web(url);
      const csrf = (/<meta[^>]*name="csrf-token"[^>]*content="([^"]*)"/i.exec(html) || /<meta[^>]*content="([^"]*)"[^>]*name="csrf-token"/i.exec(html) || [])[1] || "";
      const sec = /<section\b[^>]*caplist[^>]*>/i.exec(html);
      const ajax = sec ? attrs(sec[0])["data-ajax"] : "";
      if (!csrf || !ajax) return [];
      const post = async (u, fields) => JSON.parse(await web(abs(url, u), { method: "POST", body: Object.keys(fields).map((k) => enc(k) + "=" + enc(fields[k])).join("&"), headers: { Referer: url, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded" } }));
      const meta = await post(ajax, { _token: csrf });
      const per = Number(meta.perpage) || 50;
      if (!meta.paginate_url) return [];
      const pages = [];
      for (let p = 1; p <= Math.ceil((meta.eps || []).length / per) && p <= 20; p++) pages.push(p);
      const res = await Promise.all(pages.map((p) => post(meta.paginate_url, { _token: csrf, p })));
      const out = [];
      res.forEach((d) => (d.caps || []).forEach((c) => {
        const u = pathOf(abs(url, c.url || ""));
        if (u) out.push({ season: 1, number: Number(c.episodio) || out.length + 1, key: u, title: "", thumb: abs(url, c.thumb || "") || undefined });
      }));
      return out;
    },
    async embeds(key, movie) {
      let path = key;
      if (movie) { const eps = await SRC.yt.episodes(key); if (!eps.length) return []; path = eps[0].key; }
      const url = SITE + path;
      const html = await web(url);
      const dm = /<div\b[^>]*\bplayer\b[^>]*>/i.exec(html);
      const pk = dm ? attrs(dm[0])["data-key"] || "" : "";
      const btns = [];
      const re = /<button\b([^>]*play-video[^>]*)>([\s\S]*?)<\/button>/gi;
      let m;
      while ((m = re.exec(html))) { const a = attrs(m[1]); btns.push({ name: text(m[2]), token: a["data-player"] || "", api: a["data-usa-api"] === "1" }); }
      const found = await Promise.all(btns.slice(0, 5).map(async (b) => {
        try {
          const target = abs(url, b.api ? pk + b.token + "&player=" + enc(b.name) : b.token);
          if (hostOf(target) !== hostOf(SITE)) return { url: target, server: b.name, lang: "" };
          const f = /<iframe\b[^>]*\bsrc=["']([^"']+)/i.exec(await web(target, { headers: { Referer: url } }));
          return f ? { url: abs(target, f[1]), server: b.name, lang: "" } : null;
        } catch (e) { log("yt reproductor: " + msg(e)); return null; }
      }));
      return found.filter(Boolean);
    },
  };
}

// ---- DoramaExpress (HTML) -----------------------------------------------------------------------
{
  const SITE = "https://doramaexpress.com", ALT = "https://yandispoiler.net";
  async function page(path) {
    try { return await web(SITE + path); } catch (e) {
      log("express: alterno " + msg(e));
      return web(ALT + path.replace(/^\/serie\//, "/series/").replace(/^\/episodio\//, "/episodios/"));
    }
  }
  function cards(html) {
    const out = [], seen = new Set();
    html.split(/class="[^"]*\bdisplay-item\b/i).slice(1).forEach((b) => {
      const am = /<a\b([^>]*href=[^>]*)>/i.exec(b);
      if (!am) return;
      const a = attrs(am[1]);
      const path = pathOf(abs(SITE, a.href || "")).replace(/^\/series\//, "/serie/");
      const movie = path.startsWith("/movies/");
      if ((!movie && !path.startsWith("/serie/")) || seen.has(path)) return;
      const im = /<img\b([^>]*)>/i.exec(b);
      const ia = im ? attrs(im[1]) : {};
      const title = text(a.title) || text(ia.alt);
      if (!title) return;
      seen.add(path);
      out.push({ key: path, title, year: "", poster: abs(SITE, ia["data-src"] || ia.src) || undefined, cat: movie ? "dmovie" : "dorama", movie });
    });
    return out;
  }
  SRC.ex = {
    name: "DoramaExpress", cats: ["dorama", "dmovie"],
    async list(cat, p) {
      const html = await page((cat === "dmovie" ? "/movies/" : "/serie/") + (p > 1 ? "page/" + p + "/" : ""));
      const tot = /Page\s+\d+\s+of\s+(\d+)/i.exec(html);
      return { items: cards(html).filter((x) => (cat === "dmovie") === x.movie), hasNext: tot ? p < Number(tot[1]) : false };
    },
    async search(q) { return cards(await page("/?s=" + enc(q))); },
    async episodes(key) {
      const html = await page(key);
      const i = html.indexOf("yan-list-episodes");
      if (i < 0) return [];
      const j = html.indexOf("yan-list-servers", i);
      const chunk = html.slice(i, j > i ? j : i + 200000);
      const out = [], seen = new Set();
      const re = /onclick="[^"]*?(https?:\/\/[^'"\s]+\/episodios?\/[^'"\s]+)/gi;
      let m;
      while ((m = re.exec(chunk))) {
        const path = pathOf(m[1]).replace(/^\/episodios\//, "/episodio/");
        if (seen.has(path)) continue;
        seen.add(path);
        const nm = /-(\d+)x(\d+)\/?$/.exec(path);
        out.push({ season: nm ? Number(nm[1]) : 1, number: nm ? Number(nm[2]) : out.length + 1, key: path, title: "" });
      }
      return out;
    },
    async embeds(key) {
      const html = await page(key);
      const i = html.indexOf("yan-list-servers");
      if (i < 0) return [];
      const out = [], seen = new Set();
      html.slice(i).split(/id="yan-lang-grid-/i).slice(1).forEach((g) => {
        const id = g.slice(0, g.indexOf('"'));
        if (id === "downloads") return;
        const lang = id.startsWith("kr-") ? "Subtitulado" : id.startsWith("mx-") ? "Latino" : id;
        const re = /<[^>]*\bdata-url="([^"]+)"[^>]*>/gi;
        let m;
        while ((m = re.exec(g))) {
          if (!/loadSource/.test(m[0])) continue;
          const a = attrs(m[0]);
          if (a["data-locked"] && !["0", "false"].includes(a["data-locked"])) continue;
          const u = decodeEnt(m[1]);
          if (/^https?:/.test(u) && !seen.has(u)) { seen.add(u); out.push({ url: u, server: hostOf(u), lang }); }
        }
      });
      return out;
    },
  };
}


// ---- SoloLatino (HTML + API con sesión) ---------------------------------------------------------
{
  const SITE = "https://sololatino.net";
  const PATH = { movie: "/peliculas", series: "/series", anime: "/animes", dorama: "/doramas" };
  function catOf(u) { return /\/(serie|series|tv)\//.test(u) ? "series" : /\/anime\//.test(u) ? "anime" : "movie"; }
  function cards(html) {
    const out = [], seen = new Set();
    (html.match(/<div[^>]*class=["'][^"']*\bcard\b[^"']*["'][\s\S]*?<\/a>[\s\S]*?<\/div>/gi) || []).forEach((b) => {
      const hm = /href=["']([^"']*\/(?:pelicula|peliculas|serie|series|tv|anime)\/[^"']+)["']/i.exec(b);
      if (!hm) return;
      const path = pathOf(abs(SITE, hm[1]));
      if (seen.has(path)) return;
      const tm = /alt=["']([^"']+)["']/i.exec(b) || /class=["']card__title["'][^>]*>([^<]+)</i.exec(b);
      const title = text(tm ? tm[1] : "");
      if (!title) return;
      seen.add(path);
      const img = (/src=["'](https?:\/\/image\.tmdb\.org\/[^"']+)["']/i.exec(b) || /<img[^>]+?src=["'](https?:\/\/[^"']+)["']/i.exec(b) || [])[1] || "";
      const year = text((/class=["']card__year["'][^>]*>([^<]+)</i.exec(b) || [])[1] || "");
      const cat = catOf(path);
      out.push({ key: path, title, year, poster: img && !/no-poster/.test(img) ? img : undefined, cat, movie: cat === "movie" });
    });
    return out;
  }
  SRC.sl = {
    name: "SoloLatino", cats: ["movie", "series", "anime", "dorama"],
    async list(cat, page) {
      const html = await web(SITE + PATH[cat] + (page > 1 ? "?page=" + page : ""), { headers: { Referer: SITE + "/" } });
      let items = cards(html);
      if (cat === "dorama") items = items.map((x) => Object.assign(x, { cat: "dorama", movie: false }));
      else items = items.filter((x) => x.cat === cat);
      return { items, hasNext: items.length >= 12 && new RegExp("[?&]page=" + (page + 1) + "(?!\\d)").test(html) };
    },
    async search(q) {
      const j = await jget(SITE + "/api/search/suggest?q=" + enc(q), SITE + "/");
      return (Array.isArray(j) ? j : []).filter((x) => x && x.url && x.type !== "person" && !/\/persona\//.test(x.url)).map((x) => {
        const path = pathOf(abs(SITE, x.url));
        const cat = catOf(path);
        return { key: path, title: text(x.title || x.name), year: nn(x.year), poster: abs(SITE, x.image || x.poster || x.cover || "") || undefined, cat, movie: cat === "movie" };
      }).filter((x) => x.title);
    },
    async episodes(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const out = [], seen = new Set();
      const re = /<a[^>]+href=["']([^"']+\/temporada-(\d+)\/episodio-(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html))) {
        const path = pathOf(abs(SITE, m[1]));
        if (seen.has(path)) continue;
        seen.add(path);
        const nm = /<p[^>]*class=["'][^"']*text-sm[^"']*font-semibold[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(m[4]);
        const pl = /<p[^>]*class=["'][^"']*line-clamp-2[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(m[4]);
        const th = /<img[^>]+?src=["'](https?:\/\/[^"']+)["']/i.exec(m[4]);
        out.push({ season: Number(m[2]), number: Number(m[3]), key: path, title: text(nm ? nm[1] : ""), thumb: th ? th[1] : undefined, overview: text(pl ? pl[1] : "").slice(0, 400) });
      }
      return out;
    },
    async embeds(key) {
      const url = SITE + key;
      const out = [];
      let html = "";
      try {
        await web(SITE + "/sanctum/csrf-cookie", { headers: { Referer: SITE + "/" } }).catch(() => "");
        html = await web(url, { headers: { Referer: SITE + "/" } });
        const xsrf = dec((jars[hostOf(SITE)] || {})["XSRF-TOKEN"] || "");
        const btns = [];
        const re = /<button[^>]*data-player-token=["']([^"']+)["'][^>]*>([\s\S]*?)<\/button>/gi;
        let m;
        while ((m = re.exec(html))) btns.push({ t: m[1], label: text(m[2]) });
        const seen = new Set();
        await Promise.all(btns.map(async (b) => {
          try {
            const r = await web(SITE + "/api/player-url", { method: "POST", body: JSON.stringify({ t: b.t }), headers: { "Content-Type": "application/json", Accept: "application/json", "X-XSRF-TOKEN": xsrf, Origin: SITE, Referer: url } });
            const u = (JSON.parse(r) || {}).url;
            if (!u || seen.has(u)) return;
            seen.add(u);
            out.push({ url: u, server: /pelisserieshoy/.test(u) ? "PREMIUM" : b.label || hostOf(u), lang: "Latino", rec: /pelisserieshoy/.test(u) });
          } catch (e) { log("sololatino servidor: " + msg(e)); }
        }));
      } catch (e) { log("sololatino: " + msg(e)); }
      if (!out.length) {
        // Respaldo: reproductor por id de IMDb.
        let mid = "";
        const ep = /\/temporada-(\d+)\/episodio-(\d+)/.exec(key);
        const tt = /(tt\d{7,10})/.exec(html);
        if (ep && tt) mid = tt[1] + "-" + ep[1] + "x" + String(ep[2]).padStart(2, "0");
        else if (!ep && tt) mid = tt[1];
        if (mid) {
          out.push({ url: "https://player.pelisserieshoy.com/f/" + mid, server: "PREMIUM", lang: "Latino", rec: true });
          out.push({ url: "https://embed69.org/f/" + mid, server: "embed69", lang: "Latino" });
        }
      }
      return out;
    },
  };
}


// ---- SeriesTurcas (HTML) ------------------------------------------------------------------------
{
  const SITE = "https://tbg.seriesturcastv.to";
  function cards(html) {
    const out = [], seen = new Set();
    const re = /<a\s+href="([^"]+)"\s+title="([^"]+)"\s+class="poster"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      if (hostOf(m[1]) !== "tbg.seriesturcastv.to" || seen.has(m[1])) continue;
      const title = text(m[2]);
      if (!title) continue;
      seen.add(m[1]);
      const im = /<img\s+src="([^"]+)/i.exec(m[3]);
      out.push({ key: pathOf(m[1]), title, year: "", poster: im ? abs(SITE, decodeEnt(im[1])) : undefined, cat: "turca", movie: false });
    }
    return out;
  }
  SRC.st = {
    name: "SeriesTurcas", cats: ["turca"],
    async list(cat, page) {
      const all = cards(await web(SITE + "/series/", { headers: { Referer: SITE + "/" } }));
      const start = (page - 1) * 30;
      return { items: all.slice(start, start + 30), hasNext: start + 30 < all.length };
    },
    async search(q) { return cards(await web(SITE + "/?s=" + enc(q), { headers: { Referer: SITE + "/" } })); },
    async episodes(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const out = [], seen = new Set();
      const re = /<a\s+class=["']episod["']\s+href=["']([^"']+)["']>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html))) {
        const label = text(m[2]);
        const n = /cap[ií]tulo\s*(\d+)/i.exec(label);
        if (!n || seen.has(n[1]) || hostOf(m[1]) !== "tbg.seriesturcastv.to") continue;
        seen.add(n[1]);
        out.push({ season: 1, number: Number(n[1]), key: pathOf(m[1]), title: label });
      }
      return out;
    },
    async embeds(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const urls = [];
      (html.match(/<div[^>]+id=["']tab\d+["'][^>]*>[\s\S]*?<iframe[^>]+src=["']([^"']+)["']/gi) || []).forEach((b) => { const f = /src=["']([^"']+)["']/i.exec(b.slice(b.indexOf("<iframe"))); if (f) urls.push(f[1]); });
      (html.match(/data-s\d*=["']([^"']+)["']/gi) || []).forEach((x) => {
        try {
          const raw = b64bin(/["']([^"']+)["']/.exec(x)[1].replace(/\|/g, ""));
          const rev = raw.split("").reverse().join("");
          const key = [86, 110, 51, 72, 106, 87, 56, 102];
          const dec2 = rev.split("").map((c, i) => String.fromCharCode(((((c.charCodeAt(0) - 5 + 256) % 256)) ^ key[i % key.length]))).join("");
          const f = /src=["']([^"']+)["']/.exec(dec2);
          if (f) urls.push(f[1]); else if (/^http/.test(dec2)) urls.push(dec2);
        } catch { /* pestaña ilegible */ }
      });
      const seen = new Set();
      return urls.map((u) => abs(SITE, decodeEnt(u))).filter((u) => /^https?:/.test(u) && !/netusia/.test(u) && !seen.has(u) && seen.add(u)).map((u) => ({ url: u, server: hostOf(u), lang: "Subtitulado" }));
    },
  };
}

// ---- LaCartoons (HTML) --------------------------------------------------------------------------
{
  const SITE = "https://www.lacartoons.com";
  function cards(html) {
    const out = [], seen = new Set();
    const re = /<a\s+href="(\/serie\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      const nm = /<p\s+class="nombre-serie"[^>]*>([\s\S]*?)<\/p>/i.exec(m[2]);
      const title = text(nm ? nm[1] : "");
      if (!title || seen.has(m[1])) continue;
      seen.add(m[1]);
      const im = /<img[^>]+src="([^"]+)/i.exec(m[2]);
      out.push({ key: m[1], title, year: "", poster: im ? abs(SITE, decodeEnt(im[1])) : undefined, cat: "cartoon", movie: false });
    }
    return out;
  }
  SRC.lc = {
    name: "LaCartoons", cats: ["cartoon"],
    async list(cat, page) {
      const html = await web(SITE + (page > 1 ? "/?page=" + page : "/"), { headers: { Referer: SITE + "/" } });
      return { items: cards(html), hasNext: new RegExp('href="/\\?page=' + (page + 1) + '"').test(html) };
    },
    async search(q) { return cards(await web(SITE + "/?Titulo=" + enc(q), { headers: { Referer: SITE + "/" } })); },
    async episodes(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const out = [], seen = new Set();
      const re = /<a[^>]+href="([^"]*serie\/capitulo\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html))) {
        const label = text(m[2]);
        const n = /(?:cap[ií]tulo|eps?)\s*(\d+)/i.exec(label);
        if (!n) continue;
        let season = 1;
        try { season = Number(new URL(abs(SITE, m[1])).searchParams.get("t")) || 1; } catch { /* temporada 1 */ }
        const k = season + "x" + n[1];
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ season, number: Number(n[1]), key: pathOf(abs(SITE, decodeEnt(m[1]))), title: label });
      }
      return out;
    },
    async embeds(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const out = [];
      (html.match(/<iframe[^>]+src="([^"]+)"/gi) || []).forEach((x) => {
        let u = /src="([^"]+)"/i.exec(x)[1];
        if (u.startsWith("//")) u = "https:" + u;
        if (/ok\.ru|vk\.com|vkvideo|video_ext\.php|rpmvid/i.test(u)) out.push({ url: u, server: hostOf(u), lang: "Latino" });
      });
      return out;
    },
  };
}


// ---- AllCalidad (API JSON) ----------------------------------------------------------------------
{
  const SITE = "https://allcalidad.re", API = SITE + "/api/rest", IMG = SITE + "/wp-content/uploads", PER = 24;
  const TYPES = { movie: "movies", series: "tvshows", anime: "animes" };
  const api = (p, q) => jget(API + p + "?" + Object.keys(q).map((k) => k + "=" + enc(q[k])).join("&"), SITE + "/");
  function item(o) {
    if (!o || typeof o !== "object") return null;
    const id = nn(o._id || o.id);
    if (!id) return null;
    const type = nn(o.type || "movies");
    const kind = type === "animes" ? "anime" : type === "tvshows" ? "series" : "movie";
    const poster = (o.images && o.images.poster) || "";
    const year = (/^(\d{4})/.exec(nn(o.release_date)) || /\((\d{4})\)/.exec(nn(o.title)) || [])[1] || "";
    return {
      key: type + ":" + id + ":" + nn(o.slug), title: text(nn(o.title || o.name).replace(/\s*\(\d{4}\)$/, "")), year,
      poster: poster ? (/^https?:/.test(poster) ? poster : IMG + poster) : undefined,
      cat: kind, movie: kind === "movie",
    };
  }
  SRC.ac = {
    name: "AllCalidad", cats: ["movie", "series", "anime"],
    async list(cat, page) {
      const d = await api("/listing", { page, post_type: TYPES[cat], posts_per_page: PER });
      const posts = (d.data && d.data.posts) || (Array.isArray(d.data) ? d.data : []);
      return { items: posts.map(item).filter(Boolean), hasNext: posts.length >= PER };
    },
    async search(q) {
      const d = await api("/search", { query: q, post_type: "movies,tvshows,animes" });
      const posts = (d.data && d.data.posts) || (Array.isArray(d.data) ? d.data : []);
      return posts.map(item).filter(Boolean);
    },
    async episodes(key) {
      const d = await api("/episodes", { post_id: key.split(":")[1] });
      const data = Array.isArray(d.data) ? d.data : (d.data && d.data.episodes) || [];
      return data.map((e) => ({
        season: parseInt(e.season_number, 10) || 1, number: parseInt(e.episode_number, 10) || 1, key: nn(e._id || e.id),
        title: text(e.title) || "", overview: text(e.overview).slice(0, 400), thumb: e.still_path ? tmdb(e.still_path, TMDB_STILL) : undefined,
      })).filter((e) => e.key);
    },
    async embeds(key) {
      const id = key.includes(":") ? key.split(":")[1] : key;
      const d = await api("/player", { post_id: id, _any: 1 });
      return ((d.data && d.data.embeds) || []).filter((e) => /^https?:/.test(nn(e.url)))
        .map((e) => ({ url: e.url, server: hostOf(e.url), lang: nn(e.lang) || "Latino" }));
    },
  };
}

// =====================================================================================================
// ANIME: TioAnime, Latanime, AnimeFLV, AnimeAV1, JKAnime y MonosChinos
// =====================================================================================================
const aTitle = (t) => { const x = text(t); return x.replace(/\s*[-–(\[]?\s*(?:sub\s*)?(?:espa[ñn]ol|latino|castellano)\b.*$/i, "").trim() || x; };
const aNum = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? Math.floor(n) || 1 : 1; };
const aSrv = (u, base) => { let x = nn(u).trim().replace(/\\\//g, "/"); if (x.startsWith("//")) x = "https:" + x; return /^https?:\/\//.test(x) ? x : abs(base, x); };
function aPush(out, seen, url, server, lang) { if (!url || seen.has(url) || !/^https?:/.test(url)) return; seen.add(url); out.push({ url, server: server || hostOf(url), lang }); }
const aPost = (url, form, referer, extra) => web(url, {
  method: "POST", body: Object.keys(form).map((k) => enc(k) + "=" + enc(form[k])).join("&"),
  headers: Object.assign({ "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Referer: referer, Origin: abs(url, "/").replace(/\/$/, "") }, extra || {}),
});
const aItem = (key, title, poster) => ({ key, title: aTitle(title), year: "", poster: poster || undefined, cat: "anime", movie: false });

// ---- TioAnime ------------------------------------------------------------------------------------
{
  const SITE = "https://tioanime.com";
  const cards = (html) => (html.match(/<article class="anime">[\s\S]*?<\/article>/g) || []).map((a) => {
    const l = /<a href="(\/anime\/[^"]+)"/.exec(a), t = /<h3 class="title">([^<]+)<\/h3>/.exec(a), i = /<img[^>]+src="([^"]+)"/.exec(a);
    return l && t ? aItem(l[1], t[1], i ? abs(SITE, i[1]) : "") : null;
  }).filter(Boolean);
  SRC.ta = {
    name: "TioAnime", cats: ["anime"],
    async list(cat, page) { const it = cards(await web(SITE + "/directorio?p=" + page, { headers: { Referer: SITE + "/" } })); return { items: it, hasNext: it.length >= 12 }; },
    async search(q) { return cards(await web(SITE + "/directorio?q=" + enc(q), { headers: { Referer: SITE + "/" } })); },
    async episodes(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const slug = (/\/anime\/([^/?#]+)/.exec(key) || [])[1] || "";
      const m = /var\s+episodes\s*=\s*(\[[\s\S]*?\]);/.exec(html);
      let list = []; try { list = m ? JSON.parse(m[1]) : []; } catch { /* sin lista */ }
      return list.map((n) => ({ season: 1, number: aNum(n), key: "/ver/" + slug + "-" + n, title: "", thumb: SITE + "/uploads/thumbs/" + slug + "-" + n + ".jpg" }));
    },
    async embeds(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const m = /var\s+videos\s*=\s*(\[[\s\S]*?\]);/.exec(html);
      let v = []; try { v = m ? JSON.parse(m[1]) : []; } catch { /* sin servidores */ }
      const out = [], seen = new Set();
      v.forEach((x) => { if (Array.isArray(x) && x.length >= 2) aPush(out, seen, aSrv(x[1], SITE), nn(x[0]), /lat/i.test(nn(x[0])) ? "Latino" : "Subtitulado"); });
      return out;
    },
  };
}

// ---- Latanime (latino) --------------------------------------------------------------------------
{
  const SITE = "https://latanime.org";
  const cards = (html) => {
    const out = [], seen = new Set();
    for (const m of html.matchAll(/<a\b[^>]*href=["'](?:https:\/\/latanime\.org)?(\/anime\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (seen.has(m[1])) continue;
      const t = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(m[2]);
      if (!t || !text(t[1])) continue;
      const i = /<img\b[^>]*(?:data-src|src)=["']([^"']+)/i.exec(m[2]);
      seen.add(m[1]);
      out.push(aItem(m[1], t[1], i ? abs(SITE, i[1]) : ""));
    }
    return out;
  };
  SRC.la = {
    name: "Latanime", cats: ["anime"],
    async list(cat, page) { const it = cards(await web(SITE + "/animes?page=" + page, { headers: { Referer: SITE + "/" } })); return { items: it, hasNext: it.length >= 12 }; },
    async search(q) { return cards(await web(SITE + "/buscar?q=" + enc(q), { headers: { Referer: SITE + "/" } })); },
    async episodes(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const cover = (/property=["']og:image["']\s+content=["']([^"']+)/i.exec(html) || [])[1];
      const seen = new Set(), out = [];
      for (const m of html.matchAll(/href=["'](?:https:\/\/latanime\.org)?(\/ver\/[^"']+-episodio-(\d+))["']/gi)) {
        const n = Number(m[2]);
        if (seen.has(n)) continue;
        seen.add(n);
        out.push({ season: 1, number: n, key: m[1], title: "", thumb: cover });
      }
      return out;
    },
    async embeds(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const out = [], seen = new Set();
      for (const m of html.matchAll(/<a\b[^>]*class=["'][^"']*\bplay-video\b[^"']*["'][^>]*data-player=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        aPush(out, seen, aSrv(b64utf8(m[1]).trim(), SITE), text(m[2]), "Latino");
      }
      return out;
    },
  };
}

// ---- AnimeFLV (espejo) ---------------------------------------------------------------------------
{
  const SITE = "https://animeflv.or.at";
  const cards = (html) => {
    const out = [], seen = new Set();
    for (const a of html.match(/<article[^>]*class="[^"]*Anime[^"]*"[^>]*>[\s\S]*?<\/article>/g) || []) {
      const l = /<a[^>]+href="(?:https?:\/\/animeflv\.or\.at)?(\/anime\/[^"/]+)\/?"/.exec(a), t = /<h3[^>]*class="Title"[^>]*>([^<]+)<\/h3>/.exec(a), i = /<img[^>]+src="([^"]+)"/.exec(a);
      if (!l || !t || seen.has(l[1])) continue;
      seen.add(l[1]);
      out.push(aItem(l[1], t[1], i ? abs(SITE, i[1]) : ""));
    }
    return out;
  };
  SRC.af = {
    name: "AnimeFLV", cats: ["anime"],
    async list(cat, page) { const it = cards(await web(SITE + "/anime/" + (page > 1 ? "page/" + page + "/" : ""), { headers: { Referer: SITE + "/" } })); return { items: it, hasNext: it.length >= 12 }; },
    async search(q) { return cards(await web(SITE + "/?s=" + enc(q), { headers: { Referer: SITE + "/" } })); },
    async episodes(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const cover = (/<figure class="Image">\s*<img[^>]+src="([^"]+)"/.exec(html) || [])[1];
      const m = /var\s+anime_episodes\s*=\s*(\[[\s\S]*?\]);/.exec(html);
      let list = []; try { list = m ? JSON.parse(m[1]) : []; } catch { /* sin lista */ }
      return list.filter((x) => Array.isArray(x) && x.length >= 2).map((x) => ({ season: 1, number: aNum(x[0]), key: pathOf(abs(SITE, nn(x[1]))), title: "", thumb: cover ? abs(SITE, cover) : undefined }));
    },
    async embeds(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const out = [], seen = new Set();
      for (const m of html.matchAll(/<button[^>]*data-src="([A-Za-z0-9+/=]{10,})"/g)) aPush(out, seen, b64utf8(m[1]).trim(), "", "Subtitulado");
      return out;
    },
  };
}

// ---- AnimeAV1 ------------------------------------------------------------------------------------
{
  const SITE = "https://animeav1.com";
  const cards = (html) => {
    const out = [], seen = new Set();
    for (const a of html.match(/<article[^>]*>[\s\S]*?<\/article>/g) || []) {
      const l = /href="(\/media\/[^"/?#]+)"/.exec(a), t = /<h3[^>]*>([^<]+)<\/h3>/.exec(a), i = /<img[^>]+src="([^"]+)"/.exec(a);
      if (!l || !t || seen.has(l[1])) continue;
      seen.add(l[1]);
      out.push(aItem(l[1], t[1], i ? abs(SITE, i[1]) : ""));
    }
    return out;
  };
  SRC.aa = {
    name: "AnimeAV1", cats: ["anime"],
    async list(cat, page) { const it = cards(await web(SITE + "/catalogo" + (page > 1 ? "?page=" + page : ""), { headers: { Referer: SITE + "/" } })); return { items: it, hasNext: it.length >= 12 }; },
    async search(q) { return cards(await web(SITE + "/catalogo?search=" + enc(q), { headers: { Referer: SITE + "/catalogo" } })); },
    async episodes(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/catalogo" } });
      const cover = (/<img[^>]+src="(https:\/\/cdn\.animeav1\.com\/covers\/[^"]+)"/.exec(html) || [])[1];
      const seen = new Set(), out = [];
      for (const m of html.matchAll(/href="(\/media\/[^"/]+\/(\d+))"/g)) {
        const n = Number(m[2]);
        if (seen.has(n)) continue;
        seen.add(n);
        out.push({ season: 1, number: n, key: m[1], title: "", thumb: cover });
      }
      return out;
    },
    async embeds(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const out = [], seen = new Set();
      for (const m of html.matchAll(/<iframe[^>]+src="([^"]+)"/g)) {
        const u = aSrv(decodeEnt(m[1]), SITE);
        if (/zilla/i.test(u)) aPush(out, seen, u.replace("/play/", "/m3u8/"), "Zilla HLS", "Subtitulado");
        aPush(out, seen, u, "", "Subtitulado");
      }
      return out;
    },
  };
}

// ---- JKAnime -------------------------------------------------------------------------------------
{
  const SITE = "https://jkanime.net";
  const cards = (html) => {
    const out = [], seen = new Set();
    for (const a of html.match(/<div class="anime__item">[\s\S]*?<\/div>\s*<\/div>/g) || []) {
      const l = /<a\s+href="(?:https:\/\/jkanime\.net)?(\/[^/"]+\/?)"/.exec(a), t = /<h5><a[^>]*>([^<]+)<\/a><\/h5>/.exec(a), i = /data-setbg="([^"]+)"/.exec(a);
      if (!l || !t || seen.has(l[1])) continue;
      seen.add(l[1]);
      out.push(aItem(l[1], t[1], i ? abs(SITE, i[1]) : ""));
    }
    return out;
  };
  SRC.jk = {
    name: "JKAnime", cats: ["anime"],
    async list(cat, page) { const it = cards(await web(SITE + "/directorio/" + (page > 1 ? page + "/" : ""), { headers: { Referer: SITE + "/" } })); return { items: it, hasNext: it.length >= 12 }; },
    async search(q) { return cards(await web(SITE + "/buscar/" + enc(q) + "/", { headers: { Referer: SITE + "/" } })); },
    async episodes(key) {
      const page = SITE + key;
      const html = await web(page, { headers: { Referer: SITE + "/" } });
      const slug = key.replace(/^\/|\/$/g, "");
      const cover = (/data-setbg="([^"]+)"/.exec(html) || /property="og:image"\s+content="([^"]+)"/.exec(html) || [])[1];
      const id = (/ajax\/episodes\/(\d+)\//.exec(html) || /data-anime="(\d+)"/.exec(html) || [])[1];
      const token = (/<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/.exec(html) || [])[1];
      const seen = new Set(), out = [];
      const add = (n, img) => { n = aNum(n); if (seen.has(n)) return; seen.add(n); out.push({ season: 1, number: n, key: "/" + slug + "/" + n + "/", title: "", thumb: img ? "https://cdn.jkdesa.com/assets/images/animes/video/image/" + img : abs(SITE, cover || "") || undefined }); };
      if (id && token) {
        try {
          let last = 1;
          for (let p = 1; p <= Math.min(last, 12); p++) {
            const r = await aPost(SITE + "/ajax/episodes/" + id + "/" + p, { _token: token }, page, { "X-CSRF-TOKEN": token });
            const d = JSON.parse(r) || {};
            if (p === 1) last = Number(d.last_page) || 1;
            (d.data || []).forEach((e) => add(e.number, e.image));
          }
        } catch (e) { log("jkanime episodios: " + msg(e)); }
      }
      if (!out.length) for (const m of html.matchAll(new RegExp("href=[\"'](?:https://jkanime\\.net)?/" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/(\\d+)/?[\"']", "g"))) add(m[1]);
      return out;
    },
    async embeds(key) {
      const url = SITE + key;
      const html = await web(url, { headers: { Referer: SITE + "/" } });
      const out = [], seen = new Set();
      for (const m of html.matchAll(/video\[\d+\]\s*=\s*['"]<iframe[^>]+src=['"]([^'"]+)['"]/g)) {
        const u = aSrv(m[1], SITE);
        if (!/jkplayer/i.test(u)) continue;
        try {
          const p = await web(u, { headers: { Referer: url } });
          const s = /['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/.exec(p);
          if (s) aPush(out, seen, s[1].replace(/\\\//g, "/"), "JKPlayer", "Subtitulado");
        } catch (e) { log("jkplayer: " + msg(e)); }
      }
      const sv = /servers\s*=\s*(\[[\s\S]*?\]);/.exec(html);
      let list = []; try { list = sv ? JSON.parse(sv[1]) : []; } catch { /* sin lista */ }
      list.forEach((s) => { try { aPush(out, seen, b64utf8(nn(s.remote)).trim(), nn(s.server), /lat/i.test(nn(s.lang)) ? "Latino" : "Subtitulado"); } catch { /* servidor inválido */ } });
      return out;
    },
  };
}

// ---- MonosChinos ---------------------------------------------------------------------------------
{
  const SITE = "https://vww.monoschinos2.net";
  const cards = (html) => {
    const out = [], seen = new Set();
    for (const m of html.matchAll(/<a[^>]+href="(?:\.|https?:\/\/vww\.monoschinos2\.net)?\/anime\/([^"\/?#]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const key = "/anime/" + m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      const i = /data-src="([^"]+)"/.exec(m[2]) || /<img[^>]+src="([^"]+)"/.exec(m[2]);
      const t = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/.exec(m[2]) || /\balt="([^"]+)"/.exec(m[2]);
      const title = t && text(t[1]) ? t[1] : m[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      out.push(aItem(key, title, i ? abs(SITE, i[1]) : ""));
    }
    return out;
  };
  SRC.mc = {
    name: "MonosChinos", cats: ["anime"],
    async list(cat, page) { const it = cards(await web(SITE + "/animes" + (page > 1 ? "?p=" + page : ""), { headers: { Referer: SITE + "/" } })); return { items: it, hasNext: it.length >= 12 }; },
    async search(q) { return cards(await web(SITE + "/animes?buscar=" + enc(q), { headers: { Referer: SITE + "/animes" } })); },
    async episodes(key) {
      const page = SITE + key;
      const html = await web(page, { headers: { Referer: SITE + "/" } });
      const cover = (/data-src="(https?:\/\/[^"]*\/cdn\/img\/portada\/[^"]+)"/.exec(html) || [])[1];
      const i = (/data-i="(\d+)"/.exec(html) || [])[1], u = (/data-u="([^"]+)"/.exec(html) || [])[1];
      if (!i || !u) return [];
      const seen = new Set(), out = [];
      for (let p = 1; p <= 12; p++) {
        let r = "";
        try { r = await aPost(SITE + "/ajax_pagination", { acc: "episodes", i, u, p }, page); } catch (e) { if (p === 1) throw e; break; }
        let added = 0;
        for (const m of r.matchAll(/href="(?:https?:\/\/vww\.monoschinos2\.net)?(\/ver\/[^"]+-episodio-(\d+))"/g)) {
          const n = Number(m[2]);
          if (seen.has(n)) continue;
          seen.add(n); added++;
          out.push({ season: 1, number: n, key: m[1], title: "", thumb: cover });
        }
        if (!added) break;
      }
      return out;
    },
    async embeds(key) {
      const url = SITE + key;
      const html = await web(url, { headers: { Referer: SITE + "/" } });
      const enc1 = (/data-encrypt="([^"]+)"/.exec(html) || [])[1];
      if (!enc1) return [];
      const r = await aPost(SITE + "/ajax_pagination", { acc: "opt", i: enc1 }, url);
      const out = [], seen = new Set();
      for (const m of r.matchAll(/<button[^>]+data-player="([^"]+)"[^>]*>([^<]+)<\/button>/g)) aPush(out, seen, b64utf8(m[1]).trim(), text(m[2]), "Subtitulado");
      return out;
    },
  };
}


// =====================================================================================================
// PROVEEDORES POR TÍTULO: se consultan al reproducir, buscando el mismo título en cada sitio.
// =====================================================================================================
const TP = {};
const STOP = new Set(["el", "la", "los", "las", "de", "del", "un", "una", "y", "en", "the", "of", "and", "a", "an"]);
function slugOf(s) { return norm(String(s || "").replace(/https?:\/\/[^/]+/, "").replace(/^\/?(serie|series|pelicula|movies|ver-pelicula|ver-serie|capitulo)\//, "").replace(/[-_/]+/g, " ")).replace(/ /g, "-"); }
function toks(s) { const t = norm(String(s || "").replace(/https?:\/\/[^/]+/, "").replace(/^\/?(serie|series|pelicula|movies|ver-pelicula|ver-serie|capitulo)\//, "").replace(/[-_/]+/g, " ")).split(" ").filter(Boolean); const f = t.filter((x) => !STOP.has(x)); return f.length ? f : t; }
function similar(title, slug, year) {
  if (!title || !slug) return 0;
  const a = toks(title), b = toks(slug);
  if (!a.length || !b.length) return 0;
  const ya = new Set(a.filter((x) => /^\d{4}$/.test(x))), yb = new Set(b.filter((x) => /^\d{4}$/.test(x)));
  if (year) ya.add(String(year));
  if (ya.size && yb.size && ![...ya].some((y) => yb.has(y))) return 0;
  if (slugOf(title) === slugOf(slug)) return 2;
  const A = a.filter((x) => !/^\d{4}$/.test(x)), B = b.filter((x) => !/^\d{4}$/.test(x));
  if (!A.length || !B.length) return 0;
  const inter = A.filter((x) => B.includes(x)).length;
  return inter / (A.length + B.length - inter);
}
function bestOf(q, slugs, min) {
  return [...new Set(slugs)].map((sl) => ({ sl, sc: Math.max(...q.titles.map((t) => similar(t, sl, q.year))) })).filter((x) => x.sc >= (min || 0.85)).sort((a, b) => b.sc - a.sc).map((x) => x.sl);
}
const hasCjk = (s) => /[가-힯一-鿿぀-ヿ]/.test(s);
const langOf = (x) => (/lat/i.test(x) ? "Latino" : /cast|esp|spanish/i.test(x) ? "Castellano" : "Subtitulado");
async function searchAll(q, fn) {
  const terms = q.titles.filter((t) => t && !hasCjk(t)).slice(0, 2);
  const res = await Promise.allSettled(terms.map(fn));
  return [].concat(...res.map((r) => (r.status === "fulfilled" ? r.value : [])));
}
const nextData = (html) => { const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html); try { return m ? JSON.parse(m[1]).props.pageProps : null; } catch { return null; } };
function videosOf(v, tag) {
  const out = [];
  Object.keys(v || {}).forEach((lang) => (v[lang] || []).forEach((s) => { if (s && s.result) out.push({ url: s.result, server: tag + " " + nn(s.cyberlocker), lang: langOf(lang) }); }));
  return out;
}

TP.poseidon = async (q) => {
  const B = "https://www.poseidonhd2.co", h = { Referer: B + "/" };
  const found = await searchAll(q, async (t) => { const pp = nextData(await web(B + "/search?q=" + enc(t), { headers: h })); return pp ? ((q.movie ? pp.movies : pp.series) || pp.movies || pp.series || []) : []; });
  const slugs = found.map((i) => i.url && i.url.slug).filter(Boolean);
  for (const sl of bestOf(q, slugs).slice(0, 2)) {
    let p = "/" + sl.replace(/^\/|\/$/g, "");
    p = p.replace(/^\/movies\//, "/pelicula/").replace(/^\/series\//, "/serie/");
    if (q.movie !== /^\/pelicula\//.test(p)) continue;
    const pp = nextData(await web(B + (q.movie ? p : p + "/temporada/" + q.season + "/episodio/" + q.episode), { headers: h }));
    const obj = pp && (q.movie ? pp.thisMovie : pp.episode);
    const out = obj ? videosOf(obj.videos, "Poseidon") : [];
    if (out.length) return out;
  }
  return [];
};
TP.cuevana = async (q) => {
  const B = "https://wv3.cuevana3.eu", h = { Referer: B + "/" };
  const re = q.movie ? /href=["']\/ver-pelicula\/([^"']+)["']/g : /href=["']\/ver-serie\/([^"']+)["']/g;
  const slugs = (await searchAll(q, async (t) => { const html = await web(B + "/search?q=" + enc(t), { headers: h }); return [...html.matchAll(re)].map((m) => m[1].replace(/\/$/, "")); }));
  for (const sl of bestOf(q, slugs).slice(0, 3)) {
    const pp = nextData(await web(B + (q.movie ? "/ver-pelicula/" + sl : "/episodio/" + sl + "-temporada-" + q.season + "-episodio-" + q.episode), { headers: h }));
    const meta = pp && (q.movie ? pp.thisMovie : pp.serie);
    if (meta && q.year && meta.releaseDate && Math.abs(Number(String(meta.releaseDate).slice(0, 4)) - Number(q.year)) > 1) continue;
    const obj = pp && (q.movie ? pp.thisMovie : pp.episode);
    const out = obj ? videosOf(obj.videos, "Cuevana") : [];
    if (out.length) return out;
  }
  return [];
};
TP.pelisplus = async (q) => {
  if (!q.movie) return [];
  const B = "https://www.pelisplushd.la", h = { Referer: B + "/" };
  const paths = await searchAll(q, async (t) => [...(await web(B + "/search?s=" + enc(t), { headers: h })).matchAll(/<a[^>]+href=["'](\/pelicula\/[^"']+)["']/g)].map((m) => m[1]));
  for (const p of bestOf(q, paths).slice(0, 2)) {
    const html = await web(B + p, { headers: h });
    let pairs = [...html.matchAll(/<li[^>]+data-url=["']([^"']+)["'][^>]*data-name=["']([^"']*)["']/g)].map((m) => [m[1], m[2]]);
    if (!pairs.length) pairs = [...html.matchAll(/data-url=["']([^"']+)["']/g)].map((m) => [m[1], "Latino"]);
    const out = pairs.filter((x) => /^https?:/.test(x[0])).map((x) => ({ url: x[0], server: "PelisPlus " + hostOf(x[0]), lang: langOf(x[1]) }));
    if (out.length) return out;
  }
  return [];
};
TP.serieskao = async (q) => {
  const B = "https://serieskao.top", h = { Referer: B + "/" };
  const re = q.movie ? /<a[^>]+href=["'](\/pelicula\/[^"']+)["']/g : /<a[^>]+href=["'](\/serie\/[^"']+)["']/g;
  const paths = await searchAll(q, async (t) => [...(await web(B + "/search?s=" + enc(t), { headers: h })).matchAll(re)].map((m) => m[1]));
  for (const p of bestOf(q, paths).slice(0, 2)) {
    let html = "";
    if (q.movie) html = await web(B + p, { headers: h });
    else {
      const slug = p.replace(/\/$/, "").split("/").pop();
      try { html = (JSON.parse(await web(B + "/api/episodio/serie/" + slug + "/" + q.season + "/" + q.episode, { headers: { Referer: B + p, Accept: "application/json" } })) || {}).html || ""; } catch { /* sin API */ }
      if (!/vidurl/.test(html)) html = await web(B + "/serie/" + slug + "/temporada/" + q.season + "/capitulo/" + q.episode, { headers: h }).catch(() => "");
    }
    const v = [...new Set([...html.matchAll(/(?:data-url|src)=['"](\/vidurl\/[^'"]+)['"]/g)].map((m) => m[1]))];
    if (v.length) return v.map((u) => ({ url: B + u, server: "SeriesKao", lang: "Latino" }));
  }
  return [];
};
TP.seriesmetro = async (q) => {
  if (q.movie) return [];
  const B = "https://www3.seriesmetro.net";
  const cards = await searchAll(q, async (t) => [...(await web(B + "/?s=" + enc(t), { headers: { Referer: B + "/" } })).matchAll(/<a[^>]+href=["'](https?:\/\/www3\.seriesmetro\.net\/serie\/[^"']+)["']/g)].map((m) => m[1]));
  for (const card of bestOf(q, cards).slice(0, 2)) {
    const slug = card.replace(/\/$/, "").split("/").pop();
    let html = await web(B + "/capitulo/" + slug + "-temporada-" + q.season + "-capitulo-" + q.episode + "/", { headers: { Referer: card } }).catch(() => "");
    if (!/trembed/.test(html)) {
      const sh = await web(card, { headers: { Referer: B + "/" } }).catch(() => "");
      const link = [...new Set([...sh.matchAll(/href=["'](https?:\/\/www3\.seriesmetro\.net\/capitulo\/[^"']+)["']/g)].map((m) => m[1]))].find((u) => new RegExp("temporada-" + q.season + "-capitulo-" + q.episode + "(?:/|$|[?#])").test(u));
      if (link) html = await web(link, { headers: { Referer: card } }).catch(() => "");
    }
    const tr = [...new Set([...html.matchAll(/src=["'](https?:\/\/www3\.seriesmetro\.net\/\?trembed=\d+[^"']+)["']/g)].map((m) => decodeEnt(m[1])))];
    const out = [];
    await Promise.all(tr.map(async (u) => { try { (await web(u, { headers: { Referer: B + "/" } })).replace(/<iframe[^>]+src=["']([^"']+)["']/gi, (_, s) => { if (/^https?:/.test(s) && !/cloudflare|google|facebook/.test(s)) out.push({ url: s, server: "SeriesMetro", lang: "Subtitulado" }); return ""; }); } catch { /* servidor caído */ } }));
    if (out.length) return out;
  }
  return [];
};
TP.tioplus = async (q) => {
  const B = "https://tioplus.app", h = { Referer: B + "/" };
  const type = q.movie ? "pelicula" : "serie";
  const slugs = await searchAll(q, async (t) => [...(await web(B + "/search/" + enc(t), { headers: h })).matchAll(new RegExp("href=[\"']https?://tioplus\\.app/" + type + "/([^\"'/]+)[\"']", "g"))].map((m) => m[1]));
  for (const sl of bestOf(q, slugs).slice(0, 2)) {
    const url = B + "/" + type + "/" + sl + (q.movie ? "" : "/season/" + q.season + "/episode/" + q.episode);
    const html = await web(url, { headers: h }).catch(() => "");
    const items = [...html.matchAll(/<li[^>]*data-server=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/li>/g)];
    const out = [];
    await Promise.all(items.map(async (m) => {
      try {
        const p = await web(B + "/player/" + b64enc(m[1]), { headers: { Referer: url } });
        const d = (/window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/.exec(p) || /<iframe[^>]+src=['"]([^'"]+)['"]/i.exec(p) || [])[1];
        if (d && /^https?:/.test(d)) out.push({ url: d, server: "TioPlus " + text(m[2]).replace(/Reproducir/g, "").trim(), lang: "Latino" });
      } catch { /* servidor caído */ }
    }));
    if (out.length) return out;
  }
  return [];
};
TP.anime = async (q) => {
  if (q.movie || (q.season && q.season > 1)) return [];
  const out = [];
  await Promise.all(["la", "ta", "af", "aa", "jk", "mc"].map(async (k) => {
    try {
      const found = await searchAll(q, (t) => SRC[k].search(t));
      const best = found.map((x) => ({ x, sc: Math.max(...q.titles.map((t) => similar(t, x.title, "") )) })).filter((o) => o.sc >= 0.85).sort((a, b) => b.sc - a.sc)[0];
      if (!best) return;
      const eps = await epsOf({ src: k, key: best.x.key });
      const ep = eps.find((e) => e.number === (q.episode || 1));
      if (ep) (await SRC[k].embeds(ep.key)).forEach((o) => out.push(Object.assign({ src: k }, o)));
    } catch (e) { log("anime " + k + ": " + msg(e)); }
  }));
  return out;
};
function b64Servers(html, re, tag) {
  const out = [];
  for (const m of html.matchAll(re)) {
    try {
      let d = b64utf8(m[1]);
      if (/iframe\/\?url=|watch\//.test(d)) { const u = new URL(d).searchParams.get("url"); if (u) d = u; }
      const lbl = text(m[2]).toUpperCase();
      if (/^https?:/.test(d)) out.push({ url: d, server: tag + " " + hostOf(d), lang: /CASTELLANO|ESP/.test(lbl) ? "Castellano" : /SUB/.test(lbl) ? "Subtitulado" : "Latino" });
    } catch { /* base64 inválido */ }
  }
  return out;
}
TP.seriesflix = async (q) => {
  if (q.movie) return [];
  const B = "https://seriesflixhd.lol", h = { Referer: B + "/" };
  const slugs = await searchAll(q, async (t) => [...(await web(B + "/?s=" + enc(t), { headers: h })).matchAll(/href=["'](?:https?:\/\/[^/]+)?\/serie\/([^/"']+)\/?["']/g)].map((m) => m[1]));
  for (const sl of bestOf(q, slugs, 0.8).slice(0, 2)) {
    const html = await web(B + "/episodio/" + sl + "-" + q.season + "x" + q.episode + "/", { headers: h }).catch(() => "");
    const out = b64Servers(html, /<div[^>]*data-url=["']([^"']+)["'][^>]*class=["'][^"']*Button\s+sgty[^"']*["'][^>]*>([\s\S]*?)<\/div>/g, "SeriesFlix");
    if (out.length) return out;
  }
  return [];
};
TP.pelisflixhd = async (q) => {
  if (!q.movie) return [];
  const B = "https://pelisflixhd.win", h = { Referer: B + "/" };
  const slugs = await searchAll(q, async (t) => [...(await web(B + "/?s=" + enc(t), { headers: h })).matchAll(/<a[^>]*href=["'](?:https?:\/\/[^/]+)?\/pelicula\/([^/"']+)\/?["']/g)].map((m) => m[1]));
  for (const sl of bestOf(q, slugs, 0.8).slice(0, 2)) {
    const html = await web(B + "/pelicula/" + sl + "/", { headers: h }).catch(() => "");
    const out = b64Servers(html, /<li[^>]*data-server=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/g, "PelisflixHD");
    if (out.length) return out;
  }
  return [];
};
TP.cinecalidad2 = async (q) => {
  if (!q.movie) return [];
  const B = "https://www.cinecalidad.am", h = { Referer: B + "/" };
  const links = await searchAll(q, async (t) => [...(await web(B + "/?s=" + enc(t), { headers: h })).matchAll(/href=["']https?:\/\/www\.cinecalidad\.am\/ver-pelicula\/([^"'/]+)\/?["']/g)].map((m) => m[1]));
  for (const sl of bestOf(q, links).slice(0, 2)) {
    const html = await web(B + "/ver-pelicula/" + sl + "/", { headers: h }).catch(() => "");
    const out = [...html.matchAll(/<li[^>]+class=["'][^"']*dooplay_player_option[^"']*["'][^>]*data-option=["']([^"']+)["']/g)].map((m) => m[1]).filter((u) => /^https?:/.test(u) && !/youtube|trailer/.test(u)).map((u) => ({ url: u, server: "CineCalidad " + hostOf(u), lang: "Latino" }));
    if (out.length) return out;
  }
  return [];
};
async function titleProviders(q) {
  const names = Object.keys(TP);
  const res = await Promise.allSettled(names.map((n) => TP[n](q)));
  const out = [];
  res.forEach((r, i) => { if (r.status === "fulfilled") r.value.forEach((o) => out.push(Object.assign({ src: "tp" }, o))); else log("proveedor " + names[i] + ": " + msg(r.reason)); });
  log("proveedores por título: " + out.length);
  return out;
}

// =====================================================================================================
// MOTOR: unir fuentes, catálogo, búsqueda, capítulos y reproducción
// =====================================================================================================
const ORDER = ["la", "ta", "af", "aa", "jk", "mc", "hs", "pj", "ac", "sl", "fx", "fc", "cc", "pf", "st", "yt", "ex", "lc"];
const SITE_OF = { ac: "https://allcalidad.re", la: "https://latanime.org", ta: "https://tioanime.com", af: "https://animeflv.or.at", aa: "https://animeav1.com", jk: "https://jkanime.net", mc: "https://vww.monoschinos2.net", st: "https://tbg.seriesturcastv.to", lc: "https://www.lacartoons.com", tp: "", sl: "https://sololatino.net", hs: "https://hackstore3.net", pj: "https://pelisjuanita.org", fc: "https://www.fuegocine.com", cc: "https://www.cinecalidad.my", pf: "https://pelisflix200.store", fx: "https://doramasflix.io", yt: "https://www.doramasyt.com", ex: "https://doramaexpress.com" };
const ROWS = [
  { id: "movie", title: ["Películas", "Movies"], genre: "peliculas" },
  { id: "series", title: ["Series", "Series"], genre: "series" },
  { id: "anime", title: ["Anime", "Anime"], genre: "anime" },
  { id: "dorama", title: ["Doramas", "Dramas"], genre: "doramas" },
  { id: "dmovie", title: ["Películas asiáticas", "Asian movies"], genre: "doramas" },
  { id: "cartoon", title: ["Caricaturas", "Cartoons"], genre: "series" },
];
const GENRE = { movie: "peliculas", series: "series", anime: "anime", dorama: "doramas", dmovie: "doramas", cartoon: "series" };
const srcs = () => ORDER.filter((k) => SRC[k]);

// Une los resultados de varias fuentes: el mismo título se vuelve una sola tarjeta con varias fuentes.
function mergeLists(lists) {
  const groups = new Map(), order = [];
  const longest = lists.reduce((n, l) => Math.max(n, l.items.length), 0);
  for (let i = 0; i < longest; i++) {
    for (const l of lists) {
      const it = l.items[i];
      if (!it || !it.title) continue;
      const y = Number(it.year) || 0;
      let k = (it.movie ? "m" : "s") + ":" + norm(it.title);
      if (!k.endsWith(":")) { /* clave válida */ } else continue;
      let g = groups.get(k);
      if (g && it.movie && y && g.y && Math.abs(g.y - y) > 1) { k += ":" + y; g = groups.get(k); }
      if (!g) { g = { movie: !!it.movie, title: it.title, year: it.year || "", y, poster: it.poster, cat: it.cat, alts: [] }; groups.set(k, g); order.push(g); }
      if (!g.poster && it.poster) g.poster = it.poster;
      if (!g.year && it.year) { g.year = it.year; g.y = y; }
      if (!g.alts.some((a) => a.src === l.src)) g.alts.push({ src: l.src, key: it.key });
    }
  }
  return order;
}
const altStr = (alts) => alts.slice(0, 8).map((a) => a.src + "~" + e2(a.key)).join(",");
function parseAlts(s) {
  return String(s || "").split(",").filter(Boolean).map((x) => { const i = x.indexOf("~"); return { src: x.slice(0, i), key: dec(x.slice(i + 1)) }; }).filter((a) => SRC[a.src]);
}
function toCards(groups) {
  return groups.map((g) => ({
    id: "g-" + (g.movie ? "m-" : "s-") + norm(g.title).replace(/ /g, "-").slice(0, 48) + (g.y ? "-" + g.y : ""),
    ref: "g|" + (g.movie ? "m" : "s") + "|" + enc(g.title.slice(0, 80)) + "|" + g.year + "|" + altStr(g.alts),
    title: g.title.slice(0, 200),
    kind: g.movie ? "movie" : "series",
    genres: [GENRE[g.cat] || "peliculas"],
    year: g.y || undefined,
    poster: g.poster,
  }));
}

async function listAll(cat, page) {
  const ks = srcs().filter((k) => SRC[k].cats.includes(cat));
  const res = await Promise.allSettled(ks.map((k) => SRC[k].list(cat, page)));
  const lists = [];
  let hasNext = false;
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("lista " + ks[i] + "/" + cat + ": " + msg(r.reason)); return; }
    lists.push({ src: ks[i], items: r.value.items || [] });
    if (r.value.hasNext) hasNext = true;
  });
  return { items: toCards(mergeLists(lists)), hasNext, ok: lists.map((l) => l.src + ":" + l.items.length).join(" ") };
}

export async function home() {
  await null;
  const res = await Promise.allSettled(ROWS.map((r) => listAll(r.id, 1)));
  const rows = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("home " + ROWS[i].id + ": " + msg(r.reason)); return; }
    log("home " + ROWS[i].id + " -> " + r.value.ok);
    if (r.value.items.length) rows.push({ id: "row-" + ROWS[i].id, title: tr(ROWS[i].title[0], ROWS[i].title[1]), genre: ROWS[i].genre, ref: ROWS[i].id, items: r.value.items.slice(0, 30) });
  });
  if (!rows.length) throw kino.error("unavailable", "inicio sin resultados", { userMessage: tr("No se pudo cargar el catálogo.", "Could not load the catalog.") });
  return rows;
}

export async function browse(ref, cursor) {
  await null;
  const cat = String(ref || "");
  if (!ROWS.some((r) => r.id === cat)) throw kino.error("not_found", "catálogo desconocido");
  const n = Math.max(1, parseInt(cursor, 10) || 1);
  const p = await listAll(cat, n);
  const out = { items: p.items };
  if (p.hasNext) out.next = String(n + 1);
  return out;
}

export async function search(query) {
  await null;
  const q = String((query && query.q) || "").replace(/[<>"\\]/g, " ").trim().slice(0, 80);
  if (!q) return [];
  const ks = srcs();
  const res = await Promise.allSettled(ks.map((k) => SRC[k].search(q)));
  const lists = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("búsqueda " + ks[i] + ": " + msg(r.reason)); return; }
    lists.push({ src: ks[i], items: (r.value || []).slice(0, 20) });
  });
  const cards = toCards(mergeLists(lists));
  log("búsqueda: " + cards.length + " (" + lists.map((l) => l.src + ":" + l.items.length).join(" ") + ")");
  return cards;
}

// ---- Capítulos ----------------------------------------------------------------------------------
const epCache = new Map();
async function epsOf(a) {
  const k = a.src + "~" + a.key;
  if (!epCache.has(k)) epCache.set(k, SRC[a.src].episodes(a.key).catch((e) => { epCache.delete(k); throw e; }));
  return epCache.get(k);
}

export async function episodes(ref) {
  await null;
  const p = String(ref || "").split("|");
  if (p[0] !== "g" || !p[4]) throw kino.error("not_found", "referencia desconocida");
  const title = dec(p[2]);
  const alts = parseAlts(p[4]);
  if (p[1] === "m") return { series: { title }, episodes: [{ season: 1, number: 1, ref: "p|1|1|" + p[4] + "||" + p[2] + "|" + p[3], title: tr("Película", "Movie") }] };
  const res = await Promise.allSettled(alts.map((a) => epsOf(a)));
  let best = null, bestAlt = null;
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("capítulos " + alts[i].src + ": " + msg(r.reason)); return; }
    if (!best || r.value.length > best.length) { best = r.value; bestAlt = alts[i]; }
  });
  if (!best || !best.length) throw kino.error("not_found", "sin capítulos", { userMessage: tr("Este título aún no tiene capítulos.", "No episodes yet.") });
  const seen = new Set(), out = [];
  best.slice().sort((a, b) => a.season - b.season || a.number - b.number).forEach((e) => {
    const k = e.season + "x" + e.number;
    if (seen.has(k)) return;
    seen.add(k);
    const o = { season: e.season, number: e.number, ref: "p|" + e.season + "|" + e.number + "|" + p[4] + "|" + bestAlt.src + "~" + e2(e.key) + "|" + p[2] + "|" + p[3], title: e.title || tr("Capítulo ", "Episode ") + e.number };
    if (e.thumb) o.thumbnail = e.thumb;
    if (e.overview) o.overview = e.overview;
    out.push(o);
  });
  log("capítulos: " + out.length + " (" + bestAlt.src + ")");
  return { series: { title }, episodes: out };
}

// ---- Reproducción -------------------------------------------------------------------------------
const BAD_MEDIA = /(?:\.jpe?g|\.png|\.gif|\.webp|\.vtt|\.srt|\/thumbnail|googima|doubleclick|yandex)/i;

function unwrap(u) {
  try {
    const x = new URL(u);
    if (x.hostname === "embedshortener.co") {
      const tok = x.pathname.split("/").pop().split(".")[1];
      const j = JSON.parse(b64utf8(tok));
      const t = b64utf8(String(j.link));
      if (/^https?:\/\//.test(t)) return t;
    }
  } catch { /* se queda tal cual */ }
  return u;
}
const isDirect = (u) => /\.(?:m3u8|mp4)(?:\?|$)/i.test(u) && !BAD_MEDIA.test(u);


// ---- Extracción rápida (sin navegador) ----------------------------------------------------------
function unpackJs(p, a, c, k) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const baseN = (n, b) => { let r = ""; while (n > 0) { r = chars[n % b] + r; n = Math.floor(n / b); } return r || "0"; };
  if (a < 2 || a > 62 || c < 0 || c > 100000) return "";
  const lookup = {};
  for (let i = 0; i < c; i++) { const key = baseN(i, a); lookup[key] = k[i] ? k[i] : key; }
  return p.replace(/\b\w+\b/g, (w) => (w in lookup ? lookup[w] : w));
}
function mediaFromPage(page, referer) {
  const cleaned = decodeEnt(String(page).replace(/\\\//g, "/").replace(/\\u0026/g, "&"));
  const f = /\b(?:var|let|const)\s+links\s*=\s*(\{[^{}]+\})/.exec(cleaned);
  if (f) { try { const l = JSON.parse(f[1]); const r = ["hls4", "hls3", "hls2"].map((k) => l[k]).filter((x) => typeof x === "string" && x).map((x) => abs(referer, x)); if (r.length) return r; } catch { /* sigue */ } }
  const s = /sources?\s*:\s*\[([^\]]+)\]/i.exec(cleaned);
  if (s) { const m = s[1].match(/https?:\/\/[^"'\s,]+(?:\.m3u8|\.mp4)[^"'\s,]*/gi); if (m && m.length) return m; }
  const h = /["']hls["']\s*:\s*["'](https?:\/\/[^"']+)["']/i.exec(cleaned);
  if (h) return [h[1]];
  const m3 = /https?:\/\/[^\s'"<>\\]+\.m3u8(?:\?[^\s'"<>\\]*)?/i.exec(cleaned);
  if (m3) return [m3[0]];
  const mp = /https?:\/\/[^\s'"<>\\]+\.mp4(?:\?[^\s'"<>\\]*)?/i.exec(cleaned);
  return mp ? [mp[0]] : [];
}
const NO_QUICK = /byse|filemoon|mega\.nz|zarato|netu|drive\.google|okhd|ok\.ru|embed69|mp4\.nu/i;
async function quickMedia(url) {
  const h = hostOf(url);
  if (/vidara\.(to|so)$/.test(h)) {
    const code = (/\/(?:e|player)\/([^/?#]+)/.exec(url) || [])[1];
    if (!code) return null;
    const t = await web("https://" + new URL(url).hostname + "/api/stream", { method: "POST", body: JSON.stringify({ filecode: code, device: "web", codecs: [] }), headers: { "Content-Type": "application/json", Accept: "application/json", Referer: url } });
    const d = JSON.parse(t) || {};
    const u = d.streaming_url || d.file || d.url || (d.data && (d.data.streaming_url || d.data.url));
    return u && /^https?:/.test(u) ? { url: u, referer: url } : null;
  }
  if (NO_QUICK.test(h + url)) return null;
  const origin = "https://" + new URL(url).hostname + "/";
  let page = await web(url, { headers: { Referer: origin } });
  const redirect = /window\.location\.href\s*=\s*['"](https?:\/\/[^'"\s]+)['"]/.exec(page);
  if (redirect) page = await web(decodeEnt(redirect[1]), { headers: { Referer: url } });
  if (/countries are not allowed|no longer available as it expired|human to start the video/i.test(page)) return null;
  let src = mediaFromPage(page, url);
  if (!src.length) {
    const re = /eval\(function\(p,a,c,k,e,[a-zA-Z]\)[\s\S]*?\}\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
    let m;
    while ((m = re.exec(page)) && !src.length) src = mediaFromPage(unpackJs(m[1].replace(/\\'/g, "'"), +m[2], +m[3], m[4].split("|")), url);
  }
  const good = src.find((x) => /^https?:/.test(x) && !BAD_MEDIA.test(x));
  return good ? { url: good, referer: url } : null;
}

async function capture(o) {
  const url = unwrap(o.url);
  if (isDirect(url)) return { url, mime: /\.m3u8/i.test(url) ? "application/x-mpegurl" : "video/mp4", headers: { Referer: SITE_OF[o.src] + "/" } };
  try {
    const q = await quickMedia(url);
    if (q) { log("rápido " + hostOf(url)); return { url: q.url, mime: /\.m3u8/i.test(q.url) ? "application/x-mpegurl" : "video/mp4", headers: { Referer: q.referer } }; }
  } catch (e) { log("rápido " + hostOf(url) + ": " + msg(e)); }
  if (!kino.browser || typeof kino.browser.capture !== "function") throw new Error("sin navegador");
  const page = await kino.browser.capture(url, { timeoutMs: 15000, headers: { Referer: SITE_OF[o.src] ? SITE_OF[o.src] + "/" : "https://" + hostOf(url) + "/" } });
  const media = page && Array.isArray(page.media) ? page.media : [];
  log("captura " + o.src + " " + hostOf(url) + ": " + media.length);
  const first = media.find((x) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url) && !BAD_MEDIA.test(x.url));
  if (!first) throw new Error("sin medios");
  const out = { url: first.url, mime: first.mime || first.mimeType || (/\.m3u8(\?|$)/i.test(first.url) ? "application/x-mpegurl" : "video/mp4") };
  out.headers = first.headers && typeof first.headers === "object" ? first.headers : { Referer: url };
  return out;
}

function firstSuccess(tasks) {
  return new Promise((done) => {
    let pending = tasks.length;
    if (!pending) { done(null); return; }
    tasks.forEach((t) => {
      Promise.resolve(t).then((v) => { if (v) done(v); }, (e) => log("falló: " + msg(e))).then(() => { if (--pending === 0) done(null); });
    });
  });
}

function rank(o) {
  const lang = /latino|\blat\b|mx/i.test(o.lang + " " + o.server) ? 0 : /castell|espa/i.test(o.lang) ? 1 : /sub|vose|kr/i.test(o.lang) ? 3 : 2;
  const h = hostOf(o.url);
  const host = /goodstream|vimeos|unlimplay|voe\.|filemoon|byse|streamwish|vidara|okhd|vidhide|doodstream|ok\.ru/i.test(h) ? 0 : /drive\.google/.test(h) ? 4 : /mega\.nz|zarato|netu/.test(h) ? 6 : 2;
  return lang * 10 + host + (o.rec ? 0 : 1);
}

async function playFrom(opts) {
  const seen = new Set();
  const list = opts.filter((o) => { const u = unwrap(o.url); if (seen.has(u)) return false; seen.add(u); return true; }).sort((a, b) => rank(a) - rank(b));
  log("servidores: " + list.slice(0, 8).map((o) => o.src + "/" + hostOf(o.url) + "/" + (o.lang || "-")).join(" | "));
  for (let i = 0; i < Math.min(list.length, 9); i += 3) {
    const got = await firstSuccess(list.slice(i, i + 3).map((o) => capture(o)));
    if (got) return got;
  }
  return null;
}

async function embedsFor(a, epKey, movie) {
  const list = await SRC[a.src].embeds(movie ? a.key : epKey, movie);
  return list.map((o) => Object.assign({ src: a.src }, o));
}


// Títulos alternativos (original e inglés) desde TMDB, si Kino lo ofrece.
async function altTitles(title, year, movie) {
  try {
    if (typeof kino.tmdb !== "function") return [];
    const params = { query: title, language: "en-US" };
    if (year && movie) params.year = year;
    let r = await kino.tmdb(movie ? "search/movie" : "search/tv", params);
    if (typeof r === "string") r = JSON.parse(r);
    else if (r && typeof r.json === "function") r = await r.json();
    const x = r && r.results && r.results[0];
    if (!x) return [];
    return [x.original_title || x.original_name, x.title || x.name].filter((t) => t && norm(t) !== norm(title));
  } catch (e) { log("tmdb títulos: " + msg(e)); return []; }
}

export async function resolve(ref) {
  await null;
  const p = String(ref || "").split("|");
  let movie, season, number, alts, primary = null, title = "", year = "";
  if (p[0] === "g" && p[1] === "m" && p[4]) { movie = true; alts = parseAlts(p[4]); title = dec(p[2]); year = p[3]; }
  else if (p[0] === "p" && p[3] != null) {
    season = Number(p[1]); number = Number(p[2]); alts = parseAlts(p[3]); title = dec(p[5] || ""); year = p[6] || "";
    if (p[4]) { const i = p[4].indexOf("~"); primary = { src: p[4].slice(0, i), key: dec(p[4].slice(i + 1)) }; } else movie = true;
    title = dec(p[5] || ""); year = p[6] || "";
  } else throw kino.error("not_found", "referencia desconocida");
  if (!alts.length) throw kino.error("not_found", "sin fuentes");
  const q = { titles: [title, title.replace(/\(.*?\)/g, "").trim()].filter((t, i, a) => t && a.indexOf(t) === i), year, season, episode: number, movie };

  let got = null;
  if (movie) {
    const res = await Promise.allSettled(alts.map((a) => embedsFor(a, "", true)));
    const opts = [];
    res.forEach((r, i) => { if (r.status === "fulfilled") opts.push(...r.value); else log("servidores " + alts[i].src + ": " + msg(r.reason)); });
    got = await playFrom(opts);
  } else {
    if (primary && SRC[primary.src]) {
      try { got = await playFrom(await embedsFor(primary, primary.key, false)); } catch (e) { log("principal " + primary.src + ": " + msg(e)); }
    }
    if (!got) {
      const others = alts.filter((a) => !primary || a.src !== primary.src);
      const res = await Promise.allSettled(others.map(async (a) => {
        const eps = await epsOf(a);
        const ep = eps.find((e) => e.season === season && e.number === number);
        return ep ? embedsFor(a, ep.key, false) : [];
      }));
      const opts = [];
      res.forEach((r) => { if (r.status === "fulfilled") opts.push(...r.value); });
      got = await playFrom(opts);
    }
  }
  if (!got && title) {
    // Último recurso: buscar el mismo título en los demás sitios.
    try { got = await playFrom(await titleProviders(q)); } catch (e) { log("respaldo: " + msg(e)); }
  }
  if (!got && title) {
    // Último recurso: buscar el mismo título en otros sitios.
    const titles = [title].concat(await altTitles(title, year, movie));
    const opts = await titleProviders({ titles, year, movie: !!movie, season, episode: number });
    got = await playFrom(opts);
  }
  if (got) return got;
  throw kino.error("not_found", "sin video directo", { userMessage: tr("No se pudo obtener el video. Prueba de nuevo.", "Could not get the video. Try again.") });
}
