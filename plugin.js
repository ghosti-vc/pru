// PelisJuanita para Kino. Solo películas y series.
// El token lo calcula el plugin: sha256(cert:paquete::seed:minutoEpoch).minutoEpoch
// El seed sale de version.php y se guarda en kino.storage.

const BASE = "https://pelisjuanita.com/tv/app";
const CERT = "9381e4d77c1d42a3d02472331249bed8e76a8df6af7082214ea8fcfc30aa653d";
const PKG  = "com.pelisjuanita.app";
const UA   = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36";
const HDR  = { "User-Agent": UA, Accept: "application/json" };

const GEN = {
  accion: "accion", acción: "accion", comedia: "comedia", drama: "drama",
  terror: "terror", miedo: "terror", animacion: "animacion", animación: "animacion",
  anime: "anime", documental: "documental", romance: "romance",
  "ciencia ficcion": "ciencia-ficcion", "ciencia ficción": "ciencia-ficcion",
  thriller: "thriller", suspenso: "thriller", infantil: "infantil",
  familia: "infantil", musica: "musica", música: "musica", deportes: "deportes",
  guerra: "belica", belica: "belica", bélica: "belica", western: "western",
  misterio: "misterio", fantasia: "fantasia", fantasía: "fantasia",
  crimen: "crimen", aventura: "aventura"
};

function enc(v) { return encodeURIComponent(String(v)); }

/* ---------- token ---------- */

async function seed() {
  const guardado = await kino.storage.get("seed");
  if (guardado) return guardado;
  const r = await kino.fetch(BASE + "/version.php", { headers: HDR, timeoutMs: 12000 });
  const j = r.ok ? r.json() : {};
  const s = (j && j.sec_seed) || "pj_sec_seed_2026_init";
  await kino.storage.set("seed", s);
  return s;
}

async function token() {
  const s = await seed();
  const min = Math.floor(Date.now() / 60000);          // minutos epoch
  const h = await kino.crypto.hash("sha256", CERT + ":" + PKG + "::" + s + ":" + min);
  return "app_version=8&pj_token=" + enc(h + "." + min);
}

async function api(ruta, extra) {
  await kino.sleep(0);
  for (let i = 0; i < 2; i++) {
    const url = BASE + "/" + ruta + (extra ? "&" + extra : "") + "&" + (await token());
    const r = await kino.fetch(url, { headers: HDR, timeoutMs: 12000 });
    if (r.status === 403) { await kino.storage.set("seed", ""); continue; }
    if (!r.ok) throw kino.error("unavailable", ruta + " " + r.status);
    return r.json();
  }
  throw kino.error("auth_required", "token");
}

/* ---------- utilidades ---------- */

function poster(p) {
  if (!p) return undefined;
  if (/^https?:/i.test(p)) return p;
  return "https://image.tmdb.org/t/p/w342" + (p.charAt(0) === "/" ? p : "/" + p);
}

function generos(txt) {
  if (!txt) return undefined;
  const out = [];
  for (const g of String(txt).split(/[,/|]/)) {
    const k = GEN[g.trim().toLowerCase()];
    if (k && out.indexOf(k) < 0) out.push(k);
  }
  return out.length ? out : undefined;
}

function generoFila(cat) {
  const c = String(cat || "").toLowerCase();
  if (c.indexOf("serie") >= 0) return "series";
  if (c.indexOf("estreno") >= 0) return "peliculas";
  if (c.indexOf("vista") >= 0) return "peliculas";
  if (c.indexOf("destacad") >= 0) return "peliculas";
  if (c.indexOf("favorit") >= 0) return "series";
  return "peliculas";
}

function item(d) {
  const serie = String(d.tipo || "").toUpperCase() === "SERIES";
  const slug = d.slug || d.id;
  const anio = String(d.fecha_estreno || d.año || "").slice(0, 4);
  const it = {
    id: (serie ? "s:" : "m:") + slug,
    title: d.titulo || d.nombre || "",
    kind: serie ? "series" : "movie",
    poster: poster(d.img_frente || d.img_fondo),
    plot: d.sinopsis || undefined,
    genres: generos(d.genero),
    ids: d.TMDbId ? { tmdb: String(d.TMDbId) } : undefined
  };
  if (anio) it.year = Number(anio) || undefined;
  if (d.es_adulto === 1 || d.es_adulto === "1") it.adult = true;
  return it;
}

/* ---------- servidores ---------- */

// Devuelve [{ nombre, url }]. Mientras no conozcamos el AES del sitio, se intenta
// base64 (doble) -> JSON -> URLs sueltas.
async function decifrar(txt) {
  await kino.sleep(0);
  if (!txt) return [];
  let raw = String(txt);
  for (let i = 0; i < 2; i++) {
    try { raw = atob(raw); } catch { break; }
  }
  let lista = [];
  try {
    const j = JSON.parse(raw);
    const arr = Array.isArray(j) ? j : (j && (j.servidores || j.datos)) || [];
    for (const s of arr) {
      const url = typeof s === "string" ? s : (s && (s.url || s.enlace || s.link));
      if (url) lista.push({ nombre: (s && (s.nombre || s.nombre_servidor)) || "Servidor", url: String(url) });
    }
    if (lista.length) return lista;
  } catch {}
  const re = /https?:\/\/[^\s"'<>\\]+/g;
  const m = raw.match(re) || [];
  for (const u of m) lista.push({ nombre: "Servidor", url: u });
  return lista;
}

function esDirecto(url) {
  return /\.(m3u8|mp4|mkv|webm)(\?|$)/i.test(url);
}

// Abre el embed en el navegador oculto y se queda con el primer medio real.
async function capturar(url) {
  await kino.sleep(0);
  const r = await kino.browser.capture(url, {
    captureAll: kino.browser.captureAll === true,
    timeoutMs: 20000
  });
  const cands = [];
  if (r && r.url) cands.push({ url: r.url, headers: r.headers });
  if (r && Array.isArray(r.urls)) for (const u of r.urls) cands.push({ url: u.url || u, headers: u.headers });
  for (const c of cands) {
    if (!c.url) continue;
    if (/imasdk|ads-twitter|doubleclick|google-analytics|jwpltx/i.test(c.url)) continue;
    if (esDirecto(c.url)) return c;
  }
  return null;
}

/* ---------- catálogo ---------- */

export async function home() {
  await kino.sleep(0);
  const j = await api("home.php?q=&pagina=1");
  const filas = [];
  for (const sec of (j && j.sections) || []) {
    const items = [];
    for (const d of sec.data || []) {
      if (String(d.tipo || "").toUpperCase() === "TV") continue;
      if (!(d.slug || d.id)) continue;
      items.push(item(d));
      if (items.length >= 60) break;
    }
    if (!items.length) continue;
    filas.push({ title: sec.categoria, genre: generoFila(sec.categoria), items });
    if (filas.length >= 20) break;
  }
  return filas;
}

export async function search({ query, cursor }) {
  await kino.sleep(0);
  const q = String(query || "").trim();
  if (!q) return { items: [] };
  const pag = Number(cursor) || 1;
  const j = await api("buscar.php?q=" + enc(q) + "&pagina=" + pag);
  const items = [];
  for (const d of (j && j.datos) || []) {
    if (!(d.slug || d.id)) continue;
    items.push(item(d));
    if (items.length >= 100) break;
  }
  const total = Number(j && j.total_paginas) || 1;
  const out = { items };
  if (pag < total && items.length) out.next = String(pag + 1);
  return out;
}

export async function episodes(ref) {
  await kino.sleep(0);
  const p = String(ref || "").split(":");
  const slug = p[1];
  if (!slug) return [];
  const det = await api("series.php?slug=" + enc(slug));
  const d = (det && det.datos) || det || {};
  const n = Number(d.temporadas) || 1;
  const out = [];
  for (let t = 1; t <= Math.min(n, 30); t++) {
    const j = await api("series.php?slug=" + enc(slug) + "&t=" + t);
    const eps = (j && (j.episodios || (j.datos && j.datos.episodios))) || [];
    for (const e of eps) {
      const num = Number(e.numero || e.episodio || 0);
      out.push({
        id: "s:" + slug + ":" + t + ":" + num,
        title: e.titulo || "Episodio " + num,
        kind: "episode",
        season: t,
        episode: num
      });
      if (out.length >= 300) return out;
    }
  }
  return out;
}

/* ---------- reproducción ---------- */

export async function resolve(ref) {
  await kino.sleep(0);
  const p = String(ref || "").split(":");
  let det;
  if (p[0] === "m") {
    det = await api("movies.php?slug=" + enc(p[1]));
  } else if (p[0] === "s") {
    det = await api("series.php?slug=" + enc(p[1]) + "&t=" + enc(p[2]) + "&e=" + enc(p[3]));
  } else {
    throw kino.error("not_found", "ref");
  }
  const d = (det && (det.datos || det)) || {};
  const lista = await decifrar(d.servidores);
  if (!lista.length) throw kino.error("unavailable", "sin servidores");

  const alternativas = [];
  for (const s of lista) {
    const url = s.url;
    if (esDirecto(url)) {
      const stream = { url, mime: /\.m3u8/i.test(url) ? "application/x-mpegURL" : "video/mp4" };
      const resto = lista.filter(x => x.url !== url).slice(0, 8)
        .map(x => ({ label: x.nombre, ref: ref }));
      if (resto.length) stream.alternatives = resto;
      return stream;
    }
    try {
      const cap = await capturar(url);
      if (cap) {
        const stream = {
          url: cap.url,
          mime: /\.m3u8/i.test(cap.url) ? "application/x-mpegURL" : "video/mp4"
        };
        if (cap.headers) stream.headers = cap.headers;
        const resto = lista.filter(x => x.url !== url).slice(0, 8)
          .map(x => ({ label: x.nombre, ref: ref }));
        if (resto.length) stream.alternatives = resto;
        return stream;
      }
    } catch {}
  }
  throw kino.error("unavailable", "sin captura");
}

/* ---------- compartir ---------- */

async function compartir(titulo, tmdb, tipo) {
  await kino.sleep(0);
  if (typeof kino.plugins !== "object") return { aviso: "Actualiza Kino" };
  try {
    return await kino.plugins.call("social", "share", {
      text: "La estoy viendo en Kino: " + titulo,
      title: tmdb ? { kind: tipo || "movie", tmdb: String(tmdb) } : undefined,
      from: "pelisjuanita"
    });
  } catch (e) {
    if (e && e.code === "provider_missing") {
      return { go: { installPlugin: { repo: "kinotvapp/kino-social" } } };
    }
    return { aviso: "No se pudo abrir Compartir" };
  }
}

/* ---------- pantalla ---------- */

export async function screen() {
  await kino.sleep(0);
  return {
    route: "main",
    tree: {
      type: "Scaffold",
      appBar: {
        type: "AppBar",
        mergeWithKinoBar: true,
        dense: true,
        title: "PelisJuanita",
        leading: { close: true }
      },
      body: {
        type: "SingleChildScrollView",
        children: [
          { type: "Text", text: "Películas y series en español. Abre un título y toca Reproducir." },
          {
            type: "ElevatedButton",
            labelText: "Compartir la app",
            onPressed: { event: "compartir" }
          }
        ]
      }
    }
  };
}

export async function screenEvent(ev) {
  await kino.sleep(0);
  if (!ev || ev.name !== "compartir") return null;
  const r = await compartir("PelisJuanita", null, "movie");
  if (r && r.go) return { go: r.go };
  return { toast: (r && (r.aviso || "Borrador guardado en Kino Social")) || "Borrador guardado en Kino Social" };
}