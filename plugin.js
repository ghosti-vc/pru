// IPTV Listas 0.1.0 — agrega tus propias listas M3U (ajustes del plugin) y mira los canales.
// No trae listas incluidas. Solo reproduce lo que cada lista ofrece como enlace directo.
const UA = "Mozilla/5.0 (Linux; Android 13; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const MAX_LISTS = 5;
const CACHE = {};

function log(...a) { try { kino.log(...a); } catch (e) { /* no romper */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function fail(code, detail, es, en) { return kino.error(code, detail, { userMessage: tr(es, en) }); }
function cfg(key) { try { return String(kino.config.get(key) || "").trim(); } catch (e) { return ""; } }

function listUrls() {
  const out = [];
  for (let i = 1; i <= MAX_LISTS; i++) {
    const u = cfg("list" + i);
    if (u) out.push({ n: i, url: u });
  }
  // Servidor con usuario y clave (formato habitual de proveedores IPTV): se arma la lista sola.
  const sv = cfg("xt_server").replace(/\/+$/, "");
  const us = cfg("xt_user");
  const pw = cfg("xt_pass");
  if (sv && us && pw) out.push({ n: 6, url: sv + "/get.php?username=" + encodeURIComponent(us) + "&password=" + encodeURIComponent(pw) + "&type=m3u_plus&output=ts" });
  return out;
}

function parseM3u(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (l.indexOf("#EXTINF") === 0) {
      const name = (l.split(",").slice(1).join(",") || "").trim();
      const grp = /group-title="([^"]*)"/i.exec(l);
      const logo = /tvg-logo="([^"]*)"/i.exec(l);
      cur = { name: name || (/tvg-name="([^"]*)"/i.exec(l) || [, ""])[1], group: grp ? grp[1].trim() : "", logo: logo ? logo[1].trim() : "" };
    } else if (l.charAt(0) !== "#") {
      if (/^https?:\/\//i.test(l)) {
        const c = cur || { name: "", group: "", logo: "" };
        out.push({ name: c.name || l.slice(0, 40), group: c.group || "Sin grupo", logo: c.logo, url: l });
      }
      cur = null;
    }
  }
  return out;
}

async function loadList(entry) {
  const key = entry.n + "|" + entry.url;
  if (CACHE[key] && Date.now() - CACHE[key].t < 300000) return CACHE[key].items;
  let r;
  const tries = [entry.url];
  if (/^http:\/\//i.test(entry.url)) tries.push(entry.url.replace(/^http:/i, "https:"));
  let lastErr = "";
  for (const u of tries) {
    try {
      r = await kino.fetch(u, { headers: { "User-Agent": UA, Accept: "*/*" } });
      if (u !== entry.url) log("lista " + entry.n + ": abrió con https");
      break;
    } catch (e) {
      lastErr = String((e && e.message) || e).slice(0, 120);
      log("lista " + entry.n + " " + u.split("/")[0] + " error=" + lastErr);
      r = null;
    }
  }
  if (!r) {
    const isHttp = /^http:\/\//i.test(entry.url);
    throw fail("unavailable", "no se pudo abrir la lista " + entry.n, isHttp ? "Kino no deja abrir la lista " + entry.n + " (dirección http). Prueba con la versión https si existe." : "No se pudo abrir la lista " + entry.n + ". Revisa la dirección.", isHttp ? "Kino does not allow opening list " + entry.n + " (http address). Try the https version if it exists." : "Could not open list " + entry.n + ". Check the address.");
  }
  if (!r.ok) {
    log("lista " + entry.n + " status=" + r.status);
    throw fail("unavailable", "status " + r.status, "La lista " + entry.n + " respondió con el error " + r.status + ".", "List " + entry.n + " answered with error " + r.status + ".");
  }
  const t = await r.text();
  const items = parseM3u(t);
  log("lista " + entry.n + ": canales=" + items.length);
  if (!items.length) throw fail("not_found", "lista vacía", "La lista " + entry.n + " no tiene canales que se puedan leer.", "List " + entry.n + " has no readable channels.");
  CACHE[key] = { t: Date.now(), items };
  return items;
}

function toItem(n, i, c) {
  return { id: "l" + n + "-" + i, ref: n + "|" + i, title: c.name.slice(0, 120), kind: "movie", genres: ["iptv"], poster: /^https:\/\//i.test(c.logo) ? c.logo : undefined };
}

function groupsOf(items) {
  const g = {};
  items.forEach((c, i) => { (g[c.group] = g[c.group] || []).push(i); });
  return g;
}

export async function home() {
  await null;
  const lists = listUrls();
  if (!lists.length) throw fail("unavailable", "sin listas", "Agrega una lista M3U en los ajustes del plugin.", "Add an M3U list in the plugin settings.");
  const rows = [];
  for (const e of lists) {
    try {
      const items = await loadList(e);
      const g = groupsOf(items);
      const names = Object.keys(g).sort((a, b) => g[b].length - g[a].length);
      if (names.length <= 1) {
        rows.push({ id: "row-l" + e.n, title: tr("Lista ", "List ") + e.n, genre: "iptv", ref: "L|" + e.n + "|", items: items.slice(0, 40).map((c, i) => toItem(e.n, i, c)) });
      } else {
        names.slice(0, 8).forEach((nm, k) => {
          rows.push({ id: "row-l" + e.n + "-" + k, title: (lists.length > 1 ? e.n + ": " : "") + nm, genre: "iptv", ref: "L|" + e.n + "|" + nm, items: g[nm].slice(0, 40).map((i) => toItem(e.n, i, items[i])) });
        });
      }
    } catch (err) {
      log("inicio: falló la lista " + e.n);
    }
  }
  if (!rows.length) throw fail("unavailable", "ninguna lista abrió", "No se pudo abrir ninguna lista. Revisa las direcciones en los ajustes.", "No list could be opened. Check the addresses in settings.");
  return rows;
}

export async function browse(ref, cursor) {
  await null;
  const p = String(ref || "").split("|");
  if (p[0] !== "L") return { items: [] };
  const e = listUrls().find((x) => String(x.n) === p[1]);
  if (!e) return { items: [] };
  const items = await loadList(e);
  const g = p.slice(2).join("|");
  const idx = [];
  items.forEach((c, i) => { if (!g || c.group === g) idx.push(i); });
  const start = Number(cursor) || 0;
  const page = idx.slice(start, start + 60);
  return { items: page.map((i) => toItem(e.n, i, items[i])), nextCursor: start + 60 < idx.length ? String(start + 60) : undefined };
}

export async function search(arg) {
  await null;
  const q = String((arg && (arg.q || arg.query)) || "").trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const e of listUrls()) {
    try {
      const items = await loadList(e);
      items.forEach((c, i) => { if (out.length < 60 && c.name.toLowerCase().indexOf(q) >= 0) out.push(toItem(e.n, i, c)); });
    } catch (err) { log("buscar: falló la lista " + e.n); }
  }
  log("buscar " + q.slice(0, 30) + " -> " + out.length);
  return out;
}

export async function episodes(ref) {
  await null;
  return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: String(ref), title: tr("En vivo", "Live") }] };
}

export async function resolve(ref) {
  await null;
  const p = String(ref || "").split("|");
  const e = listUrls().find((x) => String(x.n) === p[0]);
  if (!e) throw fail("not_found", "lista no encontrada", "Esa lista ya no está en los ajustes.", "That list is no longer in settings.");
  const items = await loadList(e);
  const c = items[Number(p[1])];
  if (!c) throw fail("not_found", "canal no encontrado", "No se encontró ese canal. Vuelve a abrir la lista.", "Channel not found. Reopen the list.");
  const u = c.url;
  const path = u.split("?")[0];
  const mime = /\.m3u8$/i.test(path) ? "application/x-mpegurl" : /\.mpd$/i.test(path) ? "application/dash+xml" : /\.mp4$/i.test(path) ? "video/mp4" : /\.ts$/i.test(path) || !/\.[A-Za-z0-9]{2,4}$/.test(path) ? "video/mp2t" : "application/x-mpegurl";
  log("canal: " + c.name.slice(0, 40));
  return { url: u, mime, headers: { "User-Agent": UA }, label: c.name.slice(0, 40) };
}
