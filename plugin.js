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
const SOCIAL   = "kinotvapp/kino-social";
const SHEET    = "compartir";

const GEN = {
  accion: "accion", "acción": "accion", comedia: "comedia", drama: "drama",
  terror: "terror", miedo: "terror", animacion: "animacion", "animación": "animacion",
  anime: "anime", documental: "documental", documentales: "documentales",
  romance: "romance", "ciencia ficcion": "ciencia-ficcion", "ciencia ficción": "ciencia-ficcion",
  thriller: "suspenso", suspenso: "suspenso", intriga: "suspenso",
  infantil: "infantil", familia: "familia", musica: "musical", "música": "musical",
  musical: "musical", deportes: "deportes", deportivo: "deportivo",
  guerra: "belica", belica: "belica", "bélica": "belica", western: "western",
  misterio: "misterio", fantasia: "fantasia", "fantasía": "fantasia",
  crimen: "crimen", policial: "crimen", aventura: "aventura", historia: "historia",
  biografia: "biografia", "biografía": "biografia", reality: "reality",
  clasicos: "clasicos", "clásicos": "clasicos", noticias: "noticias",
  entretenimiento: "entretenimiento", shonen: "shonen", isekai: "isekai",
  mecha: "mecha", escolar: "escolar"
};

let cache = { filas: null, mapa: null, detalle: null, error: null };

function enc(v) { return encodeURIComponent(String(v)); }
function en(ctx) { return String((ctx && ctx.lang) || kino.lang || "").startsWith("en"); }
function t(es, ingles, ctx) { return en(ctx) ? ingles : es; }
function idSeguro(s) { return String(s || "").replace(/[^A-Za-z0-9._~-]/g, "-").slice(0, 110) || "x"; }

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
  if (/^https:/i.test(p)) return p;
  if (/^http:/i.test(p)) return p;
  return "https://image.tmdb.org/t/p/w342" + (p.charAt(0) === "/" ? p : "/" + p);
}

function generos(txt) {
  if (!txt) return undefined;
  const out = [];
  for (const g of String(txt).split(/[,/|]/)) {
    const k = GEN[g.trim().toLowerCase()];
    if (k && out.indexOf(k) < 0 && out.length < 5) out.push(k);
  }
  return out.length ? out : undefined;
}

function generoFila(cat) {
  const c = String(cat || "").toLowerCase();
  const exacto = GEN[c.trim()];
  if (exacto) return exacto;
  for (const k in GEN) {
    if (k.length > 3 && c.indexOf(k) >= 0) return GEN[k];
  }
  if (c.indexOf("serie") >= 0) return "series";
  return "peliculas";
}

function item(d) {
  const serie = String(d.tipo || "").toUpperCase() === "SERIES";
  const slug = String(d.slug || d.id || "");
  if (!slug) return null;
  const anio = String(d.fecha_estreno || d["año"] || "").slice(0, 4);
  const it = {
    id: (serie ? "s-" : "m-") + idSeguro(slug),
    ref: (serie ? "s:" : "m:") + slug,
    title: d.titulo || d.nombre || "Sin título",
    kind: serie ? "series" : "movie",
    poster: poster(d.img_frente || d.img_fondo),
    plot: d.sinopsis || undefined,
    genres: generos(d.genero),
    ids: d.TMDbId ? { tmdb: Number(d.TMDbId) || undefined } : undefined
  };
  if (anio && Number(anio) > 1880) it.year = Number(anio);
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
  let n = 0;
  for (const sec of (j && j.sections) || []) {
    const items = [];
    for (const d of sec.data || []) {
      if (String(d.tipo || "").toUpperCase() === "TV") continue;
      const it = item(d);
      if (!it) continue;
      items.push(it);
      if (items.length >= 60) break;
    }
    if (!items.length) continue;
    n++;
    filas.push({
      id: "fila-" + n + "-" + idSeguro(sec.categoria || "x").slice(0, 30),
      title: sec.categoria || "Fila " + n,
      genre: generoFila(sec.categoria),
      items
    });
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
    const it = item(d);
    if (!it) continue;
    items.push(it);
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
  if (!slug) return { episodes: [] };
  const det = await api("series.php?slug=" + enc(slug));
  const d = (det && det.datos) || det || {};
  const n = Number(d.temporadas) || 1;
  const out = [];
  for (let t = 1; t <= Math.min(n, 30); t++) {
    const j = await api("series.php?slug=" + enc(slug) + "&t=" + t);
    const eps = (j && (j.episodios || (j.datos && j.datos.episodios))) || [];
    let pos = 0;
    for (const e of eps) {
      pos++;
      const num = Math.min(Math.max(Number(e.numero || e.episodio || pos) || pos, 1), 99999);
      out.push({
        season: t,
        number: num,
        ref: "s:" + slug + ":" + t + ":" + num,
        title: e.titulo || undefined
      });
      if (out.length >= 5000) return { episodes: out };
    }
  }
  return { episodes: out };
}

/* ---------- reproducción ---------- */

async function detalle(ref) {
  const p = String(ref || "").split(":");
  if (p[0] === "m" && p[1]) return api("movies.php?slug=" + enc(p[1]));
  if (p[0] === "s" && p[1]) {
    if (p[3]) return api("series.php?slug=" + enc(p[1]) + "&t=" + enc(p[2]) + "&e=" + enc(p[3]));
    return api("series.php?slug=" + enc(p[1]));
  }
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
  if (!lista.length) {
    throw kino.error("unavailable", "sin servidores", {
      userMessage: t("No hay ningún servidor disponible para este título.", "There is no server available for this title.")
    });
  }

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
  throw kino.error("unavailable", "sin captura", {
    userMessage: t("No se pudo abrir el video. Prueba otro servidor.", "The video would not open. Try another server.")
  });
}

/* ---------- compartir ---------- */

async function enviarCompartir(v, share, installed, ctx) {
  await kino.sleep(0);
  const texto = String(v.shareText || "").trim().slice(0, 500);
  const conTitulo = !!share && v.shareTitle !== false;
  if (!texto && !conTitulo) {
    return { toast: t("Escribe algo o adjunta el título.", "Write something or attach the title.", ctx) };
  }
  if (typeof kino.plugins !== "object") {
    return { toast: t("Actualiza Kino para compartir en Kino Social.", "Update Kino to share on Kino Social.", ctx) };
  }
  const arg = { from: "PelisJuanita" };
  if (texto) arg.text = texto;
  if (conTitulo) arg.title = { kind: share.kind === "series" ? "series" : "movie", tmdb: Number(share.tmdb) };
  try {
    await kino.plugins.call("social", "share", arg);
    return {
      ui: [{ close: SHEET }],
      state: { share: null },
      toast: t("Listo: tienes el borrador en Kino Social para revisarlo y publicarlo.",
               "Done: the draft waits in Kino Social for you to review and post it.", ctx)
    };
  } catch (e) {
    const code = e && e.code;
    if (code === "provider_missing" && (!installed || installed[SOCIAL] !== true)) {
      return {
        ui: [{ close: SHEET }],
        go: { installPlugin: { repo: SOCIAL } },
        toast: t("Instala Kino Social para compartir.", "Install Kino Social to share.", ctx)
      };
    }
    if (code === "provider_missing") {
      return { toast: t("Kino Social está apagado o le falta configurarse: revísalo en Plugins.",
                        "Kino Social is off or needs setting up: check it in Plugins.", ctx) };
    }
    if (code === "not_declared") {
      return { toast: t("Actualiza Kino Social para compartir.", "Update Kino Social to share.", ctx) };
    }
    return { toast: t("No se pudo enviar a Kino Social. Inténtalo de nuevo.",
                      "Could not send to Kino Social. Try again.", ctx) };
  }
}

function hojaCompartir(share, ctx) {
  const hijos = [
    {
      type: "TextField", key: "shareText", multiline: true, maxLines: 6, maxLength: 500,
      labelText: t("Qué quieres contar", "What do you want to say", ctx),
      labelTextEn: "What do you want to say"
    }
  ];
  if (share) {
    hijos.push({
      type: "Switch", key: "shareTitle", value: true,
      labelText: t("Adjuntar el título", "Attach the title", ctx),
      labelTextEn: "Attach the title"
    });
  }
  hijos.push({
    type: "Text", style: "caption", color: "muted",
    text: "Llega a Kino Social como borrador: allá lo revisas y lo publicas.",
    textEn: "It reaches Kino Social as a draft: you review and post it there."
  });
  hijos.push({
    type: "ElevatedButton", key: "shareSend", icon: "send", submit: true,
    labelText: t("Enviar a Kino Social", "Send to Kino Social", ctx),
    labelTextEn: "Send to Kino Social"
  });
  return {
    type: "BottomSheet", key: SHEET,
    title: t("Compartir en Kino Social", "Share on Kino Social", ctx),
    titleEn: "Share on Kino Social",
    children: [{
      type: "Form", key: "shareForm", gap: 12,
      onSubmitted: { event: "sendShare", timeoutMs: 15000 },
      children: hijos
    }]
  };
}

/* ---------- pantalla ---------- */

function barra(titulo, ctx, opts) {
  const o = opts || {};
  const leading = o.back
    ? {
        type: "IconButton", icon: "arrow_back",
        labelText: t("Atrás", "Back", ctx), labelTextEn: "Back",
        onPressed: { event: "back" }
      }
    : {
        type: "IconButton", icon: "close",
        labelText: t("Cerrar", "Close", ctx), labelTextEn: "Close",
        onPressed: { close: true }
      };
  return {
    type: "AppBar", mergeWithKinoBar: true, dense: true,
    title: titulo, titleEn: o.titleEn, leading, actions: o.actions
  };
}

function esqueleto() {
  return { type: "Skeleton", shape: "block", height: 96 };
}

function filaTexto(txt) {
  return { type: "Text", text: txt, style: "h5", canRequestFocus: true };
}

function tarjeta(it) {
  return {
    type: "ListTile",
    leading: it.poster ? { type: "Image", url: it.poster, width: 56, aspect: "2:3", alt: it.title } : undefined,
    title: it.title + (it.year ? " (" + it.year + ")" : ""),
    subtitle: it.kind === "series" ? "Serie" : "Película",
    subtitleEn: it.kind === "series" ? "Series" : "Movie",
    onTap: { event: "detalle", arg: it.id }
  };
}

async function cargarHome() {
  cache.error = null;
  try {
    const filas = await home();
    const mapa = {};
    for (const f of filas) for (const it of f.items) mapa[it.id] = it;
    cache.filas = filas;
    cache.mapa = mapa;
  } catch (e) {
    cache.filas = null;
    cache.mapa = null;
    cache.error = (e && e.code) || "unavailable";
  }
}

async function cargarDetalle(ref, base) {
  cache.detalle = null;
  const det = await detalle(ref);
  const d = (det && (det.datos || det)) || {};
  const serie = String(ref).charAt(0) === "s";
  const info = {
    ref,
    titulo: d.titulo || d.nombre || (base && base.title) || t("Título", "Title"),
    kind: serie ? "series" : "movie",
    tmdb: Number(d.TMDbId) || (base && base.tmdb) || undefined,
    plot: d.sinopsis || undefined,
    poster: poster(d.img_frente || d.img_fondo),
    eps: []
  };
  if (serie) {
    try {
      const r = await episodes(ref);
      info.eps = (r && r.episodes) || [];
    } catch {}
  }
  cache.detalle = info;
}

function pantallaMain(ctx, state) {
  const kids = [];
  const filas = cache.filas;

  if (cache.error) {
    kids.push({
      type: "Text",
      text: t("No se pudo cargar el catálogo. Revisa tu conexión y vuelve a intentarlo.",
              "The catalog could not load. Check your connection and try again.", ctx),
      canRequestFocus: true
    });
    kids.push({
      type: "ElevatedButton",
      labelText: t("Reintentar", "Retry", ctx), labelTextEn: "Retry",
      onPressed: { event: "refresh" }
    });
  } else if (!filas) {
    kids.push(esqueleto(), esqueleto(), esqueleto());
  } else {
    kids.push({
      type: "Text",
      text: t("Películas y series en español. Toca un título para abrirlo.",
              "Movies and series in Spanish. Tap a title to open it.", ctx),
      canRequestFocus: true
    });
    for (const f of filas.slice(0, 10)) {
      kids.push(filaTexto(f.title));
      for (const it of f.items.slice(0, 10)) kids.push(tarjeta(it));
    }
  }

  return {
    type: "Scaffold",
    appBar: barra("PelisJuanita", ctx, {
      actions: [{
        type: "IconButton", key: "shareBar", icon: "share",
        labelText: t("Compartir", "Share", ctx), labelTextEn: "Share",
        onPressed: { event: "openShare", arg: "" }
      }]
    }),
    body: {
      type: "SingleChildScrollView",
      children: [{ type: "Column", padding: 16, gap: 12, children: kids }, hojaCompartir(state.share || null, ctx)]
    }
  };
}

function pantallaDetalle(ctx, state) {
  const info = cache.detalle;
  if (!info) {
    return {
      type: "Scaffold",
      appBar: barra(t("Detalle", "Detail", ctx), ctx, { back: true }),
      body: { type: "SingleChildScrollView", children: [esqueleto(), esqueleto()] }
    };
  }

  const kids = [];
  if (info.poster) kids.push({ type: "Image", url: info.poster, width: 140, aspect: "2:3", alt: info.titulo });
  kids.push({ type: "Text", text: info.titulo, style: "h3", canRequestFocus: true });
  kids.push({
    type: "Text",
    text: info.kind === "series" ? t("Serie", "Series", ctx) : t("Película", "Movie", ctx),
    canRequestFocus: true
  });
  if (info.plot) kids.push({ type: "Text", text: info.plot, canRequestFocus: true });
  kids.push({
    type: "ElevatedButton",
    labelText: t("Reproducir", "Play", ctx), labelTextEn: "Play", icon: "play",
    onPressed: { go: { play: { ref: info.ref, kind: info.kind, id: info.id || idSeguro(info.ref), title: info.titulo } } }
  });
  if (info.tmdb) {
    kids.push({
      type: "Button", variant: "secondary", icon: "share",
      labelText: t("Compartir", "Share", ctx), labelTextEn: "Share",
      onPressed: { event: "openShare", arg: "title" }
    });
  }

  if (info.eps.length) {
    kids.push(filaTexto(t("Capítulos", "Episodes", ctx)));
    for (const e of info.eps.slice(0, 150)) {
      kids.push({
        type: "ListTile",
        title: e.title || t("Capítulo ", "Episode ", ctx) + e.number,
        subtitle: t("Temporada ", "Season ", ctx) + e.season + " · " + t("Episodio ", "Episode ", ctx) + e.number,
        onTap: { go: { play: { ref: e.ref, kind: "episode", id: idSeguro(e.ref), title: e.title || info.titulo } } }
      });
    }
  }

  return {
    type: "Scaffold",
    appBar: barra(info.titulo, ctx, { back: true }),
    body: {
      type: "SingleChildScrollView",
      children: [{ type: "Column", padding: 16, gap: 12, children: kids }, hojaCompartir(state.share || null, ctx)]
    }
  };
}

export async function screen(ctx) {
  await kino.sleep(0);
  const c = ctx || {};
  const state = c.state || {};
  const ruta = (c.route && c.route.name) || "main";
  if (ruta === "detalle") return pantallaDetalle(c, state);
  return pantallaMain(c, state);
}

export async function screenEvent(ev) {
  await kino.sleep(0);
  const e = ev || {};
  const name = e.name;
  const arg = e.arg;
  const state = e.state || {};
  const installed = e.installed || {};
  const ruta = (e.route && e.route.name) || "main";

  if (name === "open") {
    if (ruta === "detalle") {
      const args = (e.route && e.route.args) || {};
      const ref = typeof args.ref === "string" ? args.ref : null;
      if (ref) {
        try { await cargarDetalle(ref, { title: args.title, tmdb: args.tmdb }); } catch { cache.detalle = null; }
      }
    } else if (!cache.filas) {
      await cargarHome();
    }
    return { state: { listo: true } };
  }

  if (name === "refresh") {
    if (ruta === "detalle" && cache.detalle) {
      try { await cargarDetalle(cache.detalle.ref, cache.detalle); }
      catch { return { toast: t("No se pudo cargar el título.", "The title could not load.", e) }; }
      return { state: { listo: true } };
    }
    await cargarHome();
    return { state: { listo: true } };
  }

  if (name === "detalle" && arg) {
    const it = cache.mapa && cache.mapa[String(arg)];
    if (!it) return { toast: t("Ese título ya no está en la lista.", "That title is no longer in the list.", e) };
    try {
      await cargarDetalle(it.ref, it);
    } catch {
      return { toast: t("No se pudo cargar el título.", "The title could not load.", e) };
    }
    return { route: { push: "detalle", params: { ref: it.ref } } };
  }

  if (name === "back") return { route: { pop: true } };

  if (name === "openShare") {
    const info = cache.detalle;
    const share = arg === "title" && info && info.tmdb
      ? { kind: info.kind, tmdb: info.tmdb, name: info.titulo }
      : null;
    const texto = share
      ? (en(e) ? 'I\'m watching "' + share.name + '"' : "Estoy viendo «" + share.name + "»")
      : "";
    return {
      state: { share, inputs: { shareText: texto, shareTitle: !!share } },
      ui: [{ open: SHEET }]
    };
  }

  if (name === "sendShare") {
    const v = Object.assign({}, state.inputs || {}, (e.value && typeof e.value === "object") ? e.value : {});
    return enviarCompartir(v, state.share || null, installed, e);
  }

  return null;
}