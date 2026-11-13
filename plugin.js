// ====================================================================================
// PARCHE Pelis TV: episodios más rápidos (primera respuesta + plazo corto + caché)
//
// QUÉ HACER EN plugin.js:
//   1. BORRA la función  export async function episodes(ref) { ... }  completa (la actual).
//   2. PEGA todo lo de abajo en su lugar (justo antes de la sección "Reproducción").
//   3. (Opcional) En searchAll cambia  Math.min(ms || 9000, 7000)  por  Math.min(ms || 9000, 5000)
//   No se toca resolve(), episodesOne(), expandRefs() ni mergeDupes().
// ====================================================================================

// ---- Caché en memoria (15 min) ----
const CACHE_TTL = 15 * 60 * 1000;
const epCache = new Map();     // ref de la tarjeta -> resultado final de episodes()
const expandCache = new Map(); // ref de la tarjeta -> { refs, kind } de expandRefs()

function cget(m, k) {
  const h = m.get(k);
  return h && Date.now() - h.t < CACHE_TTL ? h.v : null;
}
function cset(m, k, v) {
  if (m.size > 60) m.delete(m.keys().next().value);
  m.set(k, { t: Date.now(), v });
}

async function expandRefsCached(raw) {
  const hit = cget(expandCache, raw);
  if (hit) return hit;
  const v = await expandRefs(raw);
  cset(expandCache, raw, v);
  return v;
}

// ---- Primera respuesta + plazo corto ----
// Cada tarea devuelve un arreglo (vacío si no hubo nada). Cuando llega la primera con datos,
// se espera graceMs más a las demás; las que no lleguen se ignoran.
const GRACE_MS = 3000;

function firstThenGrace(tasks, graceMs) {
  return new Promise((resolve) => {
    const done = [];
    let pending = tasks.length;
    let finished = false;
    let graceStarted = false;
    const end = () => { if (finished) return; finished = true; resolve(done); };
    if (!pending) { end(); return; }
    tasks.forEach((t) => {
      Promise.resolve(t).then((v) => {
        if (finished || !v || !v.length) return;
        done.push.apply(done, v);
        if (!graceStarted) {
          graceStarted = true;
          if (typeof kino.sleep === "function") sleepUpTo(graceMs).then(end, end);
          else end();
        }
      }, () => {}).then(() => { if (--pending === 0) end(); });
    });
  });
}

// ---- episodes() nuevo ----
export async function episodes(ref) {
  await null;
  const raw = String(ref || "");
  const hit = cget(epCache, raw);
  if (hit) { log("episodios: desde caché"); return hit; }

  const parts = (raw.startsWith("mx|") ? raw.slice(3) : raw).split("||").filter(Boolean);
  const known = parts.filter((x) => x.indexOf("tt:") !== 0);
  const tt = parts.find((x) => x.indexOf("tt:") === 0) || "";
  if (!known.length) throw kino.error("not_found", "referencia desconocida");

  const isMovie = tt ? tt.split(":")[2] === "m" : known.every((r) => r.split("|")[1] === "m");

  // Película: un solo capítulo que recuerda todas las fuentes. Solo se busca en otros sitios si hacen falta.
  if (isMovie) {
    let refs = known;
    if (tt && known.length < 2) refs = (await expandRefsCached(raw)).refs;
    const out = { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: "mx|" + refs.join("||"), title: tr("Película", "Movie") }] };
    cset(epCache, raw, out);
    return out;
  }

  // Serie: las fuentes que ya trae la tarjeta arrancan YA; la búsqueda en otros sitios corre en paralelo.
  const one = async (r) => {
    const d = await withTimeout(episodesOne(r), 8000);
    return d && d.episodes && d.episodes.length ? [{ ref: r, data: d }] : [];
  };
  const tasks = known.slice(0, 8).map((r) => one(r).catch((e) => {
    log("episodios: falló " + r.slice(0, 2) + " " + String((e && e.message) || e).slice(0, 40));
    return [];
  }));

  if (tt && known.length < 2) {
    tasks.push((async () => {
      const { refs } = await expandRefsCached(raw);
      const extra = refs.filter((r) => known.indexOf(r) < 0);
      const res = await Promise.allSettled(extra.map(one));
      const out = [];
      res.forEach((x) => { if (x.status === "fulfilled") out.push.apply(out, x.value); });
      return out;
    })().catch(() => []));
  }

  const results = await firstThenGrace(tasks, GRACE_MS);
  if (!results.length) {
    throw kino.error("not_found", "sin capítulos", {
      userMessage: tr("No se encontró la lista de capítulos de este título.", "No episode list found for this title."),
    });
  }
  log("episodios: " + results.map((r) => r.ref.slice(0, 2) + "=" + r.data.episodes.length).join(","));

  // La lista más larga manda; las demás aportan refs alternativos por temporada x número.
  let best = results[0];
  for (const r of results) if (r.data.episodes.length > best.data.episodes.length) best = r;
  const byKey = results.map((r) => {
    const m = new Map();
    for (const e of r.data.episodes) m.set(e.season + "x" + e.number, e.ref);
    return m;
  });

  const eps = best.data.episodes.map((e) => {
    const alts = [e.ref];
    results.forEach((r, i) => {
      if (r === best) return;
      const o = byKey[i].get(e.season + "x" + e.number);
      if (o && alts.indexOf(o) < 0) alts.push(o);
    });
    alts.sort((x, y) => (SRC_PRIO[x.slice(0, 2)] || 0) - (SRC_PRIO[y.slice(0, 2)] || 0));
    return alts.length > 1 ? Object.assign({}, e, { ref: "mx|" + alts.join("||") }) : e;
  });
  eps.sort((a, b) => (a.season - b.season) || (a.number - b.number));

  const out = Object.assign({}, best.data, { episodes: eps });
  cset(epCache, raw, out);
  return out;
}
