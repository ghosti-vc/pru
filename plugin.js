// Prueba del puente 0.1.0: comprueba si Kino deja conectarse a un programa local (Termux).
const URLS = ["http://127.0.0.1:8765/ping", "http://localhost:8765/ping"];

function log(...a) { try { kino.log(...a); } catch (e) { /* no romper */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function fail(code, detail, es, en) { return kino.error(code, detail, { userMessage: tr(es, en) }); }

async function probe() {
  const notes = [];
  for (const u of URLS) {
    try {
      const r = await kino.fetch(u, { headers: { Accept: "application/json" } });
      const t = await r.text();
      log("prueba " + u + " status=" + r.status + " cuerpo=" + t.slice(0, 80));
      if (r.ok) return { ok: true, text: t, url: u };
      notes.push("status " + r.status);
    } catch (e) {
      const m = String((e && e.message) || e).slice(0, 120);
      log("prueba " + u + " error=" + m);
      notes.push(m);
    }
  }
  return { ok: false, notes };
}

export async function home() {
  await null;
  const p = await probe();
  if (!p.ok) throw fail("unavailable", "sin conexión local", "Kino no pudo hablar con el puente de Termux. Mira el log.", "Kino could not reach the Termux bridge. Check the log.");
  return [{ id: "row-puente", title: "Puente", genre: "prueba", ref: "p", items: [{ id: "puente-ok", ref: "ok|1", title: tr("Puente conectado", "Bridge connected"), kind: "movie", genres: ["prueba"] }] }];
}
export async function browse() { await null; return { items: [] }; }
export async function search() { await null; return []; }
export async function episodes(ref) { await null; return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: String(ref), title: "Prueba" }] }; }
export async function resolve() { await null; throw fail("unavailable", "solo es una prueba", "Esto es solo una prueba de conexión.", "This is only a connection test."); }
