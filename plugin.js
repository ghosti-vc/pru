// probe.mjs — solo lee páginas de tubepelis y resume su forma.
import { writeFileSync } from "node:fs";
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const BASE = "https://www.tubepelis.com";
const out = [];
const cut = (s, n = 600) => (s.length > n ? s.slice(0, n) + " …[" + s.length + "]" : s);

async function get(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es-CO,es;q=0.9", Accept: "text/html,*/*" }, redirect: "follow" });
    return { url, status: r.status, finalUrl: r.url, type: r.headers.get("content-type") || "", text: await r.text() };
  } catch (e) { return { url, status: 0, error: String(e) }; }
}

function digest(p) {
  out.push("=".repeat(72), "PEDIDA: " + p.url, "ESTADO: " + p.status + "  FINAL: " + (p.finalUrl || "-") + "  TIPO: " + (p.type || "-") + "  BYTES: " + (p.text ? p.text.length : 0));
  if (p.error) out.push("ERROR: " + p.error);
  if (!p.text) return;
  const t = p.text;
  out.push("TITLE: " + ((t.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "-").trim());
  const ifr = [...t.matchAll(/<iframe[^>]*>/gi)].map((m) => m[0]);
  out.push("IFRAMES (" + ifr.length + "):"); ifr.slice(0, 12).forEach((x) => out.push("  " + x));
  const links = [...new Set([...t.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]))];
  const cont = links.filter((h) => /\/(pelicula|serie|episodio|capitulo)\//.test(h));
  out.push("ENLACES CONTENIDO (" + cont.length + "):"); cont.slice(0, 20).forEach((x) => out.push("  " + x));
  out.push("OTROS ENLACES:"); links.filter((h) => !/\/(pelicula|serie|episodio|capitulo)\//.test(h)).slice(0, 40).forEach((x) => out.push("  " + x));
  const imgs = [...t.matchAll(/<img[^>]*>/gi)].map((m) => m[0]);
  out.push("IMAGENES (" + imgs.length + "):"); imgs.slice(0, 10).forEach((x) => out.push("  " + x));
  out.push("CLASES: " + [...new Set([...t.matchAll(/class="([^"]+)"/gi)].map((m) => m[1]))].slice(0, 60).join(" | "));
  out.push("SCRIPTS: " + [...t.matchAll(/<script[^>]*src="([^"]+)"/gi)].map((m) => m[1]).slice(0, 20).join(" | "));
  out.push("LINEAS CLAVE:");
  [...t.matchAll(/[^\n]*(?:ld\+json|data-player|data-src|player|embed|m3u8|byseqekaho|playmogo)[^\n]*/gi)]
    .slice(0, 40).forEach((m) => out.push("  " + cut(m[0].trim())));
}

const home = await get(BASE + "/");
digest(home);
const movie = home.text && (home.text.match(/href="(https?:\/\/[^"]*)?(\/pelicula\/[^"]+)"/i) || [])[2];
if (movie) {
  const m = await get(BASE + movie);
  digest(m);
  if (m.text) writeFileSync("probe-movie.html", m.text);
}
for (const q of ["/buscar/?q=avatar", "/buscar?q=avatar", "/?s=avatar", "/search?q=avatar"]) {
  const s = await get(BASE + q);
  if (s.status === 200 && s.text && s.text.length > 2000) { digest(s); writeFileSync("probe-search.html", s.text); break; }
  out.push("BUSQUEDA " + q + " -> " + s.status);
}
const page2 = await get(BASE + "/page/2/");
digest(page2);
const serie = home.text && (home.text.match(/href="(https?:\/\/[^"]*)?(\/serie\/[^"]+)"/i) || [])[2];
if (serie) { const s = await get(BASE + serie); digest(s); if (s.text) writeFileSync("probe-serie.html", s.text); }

console.log(out.join("\n"));