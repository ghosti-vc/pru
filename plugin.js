// PelisJuanita para Kino. Solo películas y series.
// Token: sha256(cert:paquete::seed:minutoEpoch).minutoEpoch
// Servidores: base64 -> AES-256-CBC (llave e IV fijos del sitio) -> JSON

const BASE = "https://pelisjuanita.com/tv/app";
const CERT = "9381e4d77c1d42a3d02472331249bed8e76a8df6af7082214ea8fcfc30aa653d";
const PKG  = "com.pelisjuanita.app";
const VK   = "TuClaveSecretaSuperSeguraParaServidores2026!#".slice(0, 32);
const KK   = "1234567890123456";
const UA   = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36";
const HDR  = { "User-Agent": UA, Accept: "application/json" };
const SEED_TTL = 3600000;
const MAX_ALT  = 8;

const GEN = {
  accion: "accion", "acción": "accion", comedia: "comedia", drama: "drama",
  terror: "terror", miedo: "terror", animacion: "animacion", "animación": "animacion",
  anime: "anime", documental: "documental", romance: "romance",
  "ciencia ficcion": "ciencia-ficcion", "ciencia ficción": "ciencia-ficcion",
  thriller: "thriller", suspenso: "thriller", infantil: "infantil",
  familia: "infantil", musica: "musica", "música": "musica", deportes: "deportes",
  guerra: "belica", belica: "belica", "bélica": "belica", western: "western",
  misterio: "misterio", fantasia: "fantasia", "fantasía": "fantasia",
  crimen: "crimen", aventura: "aventura"
};

function enc(v) { return encodeURIComponent(String(v)); }

/* ---------- token ---------- */

async function seed() {
  const guardado = await kino.storage.get("seed");
  const cuando = Number(await kino.storage.get("seed_at")) || 0;
  if (guardado && Date.now() - cuando < SEED_TTL) return guardado;
  let s = "pj_sec_seed_2026_init";
  try {
    const r = await kino.fetch(BASE + "/version.php", { headers: HDR, timeoutMs: 12000 });
    if (r.ok) {
      const j = r.json();
      if (j && j.sec_seed) s = String(j.sec_seed);
    }
  } catch {}
  await kino.storage.set("seed", s);
  await kino.storage.set("seed_at", String(Date.now()));
  return s;
}

async function token() {
  const s = await seed();
  const min = Math.floor(Date.now() / 60000);
  const h = await kino.crypto.hash("sha256", CERT + ":" + PKG + "::" + s + ":" + min);
  return "app_version=8&pj_token=" + enc(h + "." + min);
}

async function api(ruta, extra) {
  await kino.sleep(0);
  for (let i = 0; i < 2; i++) {
    const url = BASE + "/" + ruta + (extra ? "&" + extra : "") + "&" + (await token());
    const r = await kino.fetch(url, { headers: HDR, timeoutMs: 12000 });
    if (r.status === 403) {
      await kino.storage.set("seed", "");
      await kino.storage.set("seed_at", "0");
      continue;
    }
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
  const exacto = GEN[c.trim()];
  if (exacto) return exacto;
  for (const k in GEN) {
    if (c.indexOf(k) >= 0) return GEN[k];
  }
  if (c.indexOf("serie") >= 0 || c.indexOf("favorit") >= 0) return "series";
  return "peliculas";
}

function item(d) {
  const serie = String(d.tipo || "").toUpperCase() === "SERIES";
  const slug = d.slug || d.id;
  const anio = String(d.fecha_estreno || d["año"] || "").slice(0, 4);
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

function normServidor(s) {
  if (typeof s === "string") return { nombre: "Servidor", url: s };
  if (!s) return null;
  const url = s.url || s.enlace || s.link || s.servidor || s.embed || s.file;
  if (!url) return null;
  return {
    nombre: s.nombre || s.name || s.label || s.titulo || "Servidor",
    url: String(url)
  };
}

/* ---------- servidores ---------- */

async function decifrar(txt) {
  await kino.sleep(0);
  if (!txt) return [];
  if (VK.length !== 32) throw kino.error("unavailable", "llave");
  let plano = "";
  try {
    plano = await kino.crypto.decrypt("aes-256-cbc", {
      key: VK, iv: KK, data: String(txt).replace(/\s+/g, ""),
      keyEncoding: "utf8", ivEncoding: "utf8",
      inputEncoding: "base64", outputEncoding: "utf8"
    });
  } catch (e) {
    throw kino.error("unavailable", "descifrado");
  }
  let arr = [];
  try {
    const j = JSON.parse(plano);
    arr = Array.isArray(j) ? j : (j && j.servidores) || [];
  } catch {
    arr = (String(plano).match(/https?:\/\/[^\s"'<>\\]+/g) || []);
  }
  const out = [];
  for (const s of arr) {
    const n = normServidor(s);
    if (n) out.push(n);
  }
  return out;
}

function esDirecto(url) {
  return /\.(m3u8|mp4|mkv|webm)(\?|$)/i.test(url);
}

async function capturar(url) {
  await kino.sleep(0);
  const r = await kino.browser.capture(url, {
    captureAll: kino.browser.captureAll === true,
    timeoutMs: 20000
  });
  const cands = [];
  if (r && r.url) cands.push({ url: r.url, headers: r.headers });
  if (r && Array.isArray(r.urls)) {
    for (const u of r.urls) cands.push({ url: u.url || u, headers: u.headers });
  }
  for (const c of cands) {
    if (!c.url) continue;
    if (/imasdk|ads-twitter|doubleclick|google-analytics|jwpltx|googletag/i.test(c.url)) continue;
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
  const slug = String(ref || "").split(":")[1];
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

async function detalle(ref) {
  const p = String(ref || "").split(":");
  if (p[0] === "m") return api("movies.php?slug=" + enc(p[1]));
  if (p[0] === "s") return api("series.php?slug=" + enc(p[1]) + "&t=" + enc(p[2]) + "&e=" + enc(p[3]));
  throw kino.error("not_found", "ref");
}

export async function prepare(ref) {
  await kino.sleep(0);
  const base = String(ref || "").split("#")[0];
  try { await detalle(base); } catch {}
  return true;
}

export async function resolve(ref) {
  await kino.sleep(0);
  const partes = String(ref || "").split("#");
  const base = partes[0];
  const pedido = Number(partes[1]) || 0;

  const det = await detalle(base);
  const d = (det && (det.datos || det)) || {};
  const lista = await decifrar(d.servidores);
  if (!lista.length) throw kino.error("unavailable", "sin servidores");

  const alternativas = [];
  for (let i = 0; i < lista.length && alternativas.length < MAX_ALT; i++) {
    if (i === pedido) continue;
    alternativas.push({ label: lista[i].nombre, ref: base + "#" + i });
  }

  const orden = [pedido];
  for (let i = 0; i < lista.length; i++) {
    if (i !== pedido) orden.push(i);
  }

  for (const i of orden) {
    const s = lista[i];
    if (!s) continue;
    let stream = null;
    if (esDirecto(s.url)) {
      stream = { url: s.url, mime: /\.m3u8/i.test(s.url) ? "application/x-mpegURL" : "video/mp4" };
    } else {
      try {
        const cap = await capturar(s.url);
        if (cap) {
          stream = { url: cap.url, mime: /\.m3u8/i.test(cap.url) ? "application/x-mpegURL" : "video/mp4" };
          if (cap.headers) stream.headers = cap.headers;
        }
      } catch {}
    }
    if (stream) {
      if (alternativas.length) stream.alternatives = alternativas;
      return stream;
    }
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

function rutaActual() {
  const a = kino.route && (kino.route.name || kino.route.route);
  if (typeof a === "string" && a) return a;
  const b = kino.screen && kino.screen.route;
  return typeof b === "string" && b ? b : "main";
}

function argsActuales() {
  const a = (kino.route && kino.route.args) || (kino.screen && kino.screen.args) || {};
  return a && typeof a === "object" ? a : {};
}

function barra(titulo, leading) {
  return { type: "AppBar", mergeWithKinoBar: true, dense: true, title: titulo, leading };
}

function tarjetas(items) {
  const out = [];
  for (const it of items) {
    out.push({
      type: "ListTile",
      leading: it.poster ? { type: "Image", url: it.poster, width: 56, height: 84, fit: "cover" } : undefined,
      title: it.title + (it.year ? " (" + it.year + ")" : ""),
      subtitle: it.kind === "series" ? "Serie" : "Película",
      onTap: { event: "detalle", args: { ref: it.id, title: it.title, tmdb: it.ids && it.ids.tmdb, kind: it.kind } }
    });
  }
  return out;
}

async function pantallaMain() {
  let filas = [];
  try { filas = await home(); } catch {}
  const kids = [
    { type: "Text", text: "Películas y series en español. Toca un título para abrirlo.", canRequestFocus: true },
    { type: "ElevatedButton", labelText: "Compartir la app", onPressed: { event: "compartirApp" } }
  ];
  for (const f of filas.slice(0, 10)) {
    kids.push({ type: "Text", text: f.title, canRequestFocus: true });
    for (const t of tarjetas(f.items.slice(0, 10))) kids.push(t);
  }
  if (!filas.length) {
    kids.push({ type: "Text", text: "No se pudo cargar el catálogo. Revisa tu conexión y vuelve a abrir.", canRequestFocus: true });
  }
  return {
    route: "main",
    tree: { type: "Scaffold", appBar: barra("PelisJuanita", { close: true }), body: { type: "SingleChildScrollView", children: kids } }
  };
}

async function pantallaDetalle(a) {
  const ref = String(a.ref || "");
  if (!ref) return pantallaMain();
  const titulo = String(a.title || "Título");
  const serie = a.kind === "series";
  const kids = [
    { type: "Text", text: titulo, size: 20, weight: "bold", canRequestFocus: true },
    { type: "Text", text: serie ? "Serie" : "Película", canRequestFocus: true },
    { type: "ElevatedButton", labelText: "Reproducir", onPressed: { event: "play", args: { ref } } },
    { type: "ElevatedButton", labelText: "Compartir", onPressed: { event: "compartirTitulo", args: { title: titulo, tmdb: a.tmdb, kind: a.kind } } }
  ];
  if (serie) {
    let eps = [];
    try { eps = await episodes(ref); } catch {}
    if (eps.length) {
      kids.push({ type: "Text", text: "Capítulos", canRequestFocus: true });
      for (const e of eps.slice(0, 100)) {
        kids.push({
          type: "ListTile",
          title: e.title,
          subtitle: "Temporada " + e.season + " · Episodio " + e.episode,
          onTap: { event: "play", args: { ref: e.id } }
        });
      }
    }
  }
  return {
    route: "detalle",
    tree: { type: "Scaffold", appBar: barra(titulo, { back: true }), body: { type: "SingleChildScrollView", children: kids } }
  };
}

export async function screen() {
  await kino.sleep(0);
  const a = argsActuales();
  if (rutaActual() === "detalle") return pantallaDetalle(a);
  return pantallaMain();
}

export async function screenEvent(ev) {
  await kino.sleep(0);
  const name = ev && ev.name;
  const a = (ev && ev.args) || {};
  if (name === "detalle") {
    return { go: { screen: { route: "detalle", args: { ref: a.ref, title: a.title, tmdb: a.tmdb, kind: a.kind } } } };
  }
  if (name === "play" && a.ref) {
    return { go: { play: { ref: String(a.ref) } } };
  }
  if (name === "compartirTitulo") {
    const r = await compartir(String(a.title || "PelisJuanita"), a.tmdb, a.kind);
    if (r && r.go) return { go: r.go };
    return { toast: (r && r.aviso) || "Borrador guardado en Kino Social" };
  }
  if (name === "compartirApp") {
    const r = await compartir("PelisJuanita", null, "movie");
    if (r && r.go) return { go: r.go };
    return { toast: (r && r.aviso) || "Borrador guardado en Kino Social" };
  }
  return null;
}