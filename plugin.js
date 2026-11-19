// Telegram Canales 0.1.0 — lee canales PÚBLICOS de Telegram (t.me/s/<canal>) y reproduce los videos
// que la página pública ofrece como archivo directo. No usa cuentas, sesiones ni claves.
const UA = "Mozilla/5.0 (Linux; Android 13; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

function log(...a) { try { kino.log(...a); } catch (e) { /* no romper */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function fail(code, detail, es, en) { return kino.error(code, detail, { userMessage: tr(es, en) }); }
function dec(s) {
  return String(s || "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function strip(h) { return dec(String(h || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")); }
function absUrl(u) {
  let x = dec(u);
  if (x.startsWith("//")) x = "https:" + x;
  return /^https:\/\//i.test(x) ? x : "";
}

// Acepta "canal", "@canal", "t.me/canal", "https://t.me/s/canal".
function channelOf(q) {
  let s = String(q || "").trim();
  s = s.replace(/^https?:\/\//i, "").replace(/^(?:www\.)?t\.me\//i, "").replace(/^s\//i, "").replace(/^@/, "");
  s = s.split(/[\/?#\s]/)[0];
  return /^[A-Za-z0-9_]{4,32}$/.test(s) ? s : "";
}

async function getText(url) {
  const r = await kino.fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es", Accept: "text/html,*/*" } });
  if (!r.ok) {
    log("HTTP " + r.status + " " + url.slice(0, 60));
    throw fail(r.status === 404 ? "not_found" : "unavailable", "status " + r.status, "No se pudo abrir ese canal.", "Could not open that channel.");
  }
  return await r.text();
}

// Separa la página en publicaciones y devuelve las que traen video.
function posts(html, channel) {
  const out = [];
  const parts = String(html).split(/<div class="tgme_widget_message_wrap/i).slice(1);
  for (const p of parts) {
    const pm = /data-post="([^"\/]+)\/(\d+)"/i.exec(p);
    if (!pm) continue;
    const id = pm[2];
    const vid = /<video\b[^>]*\bsrc="([^"]+)"/i.exec(p) || /class="[^"]*tgme_widget_message_(?:roundvideo|video)[^"]*"[^>]*\bsrc="([^"]+)"/i.exec(p);
    const hasVideo = !!vid || /tgme_widget_message_video_player|tgme_widget_message_roundvideo_player/i.test(p);
    if (!hasVideo) continue;
    const tx = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(p);
    const text = tx ? strip(tx[1]) : "";
    const th = /tgme_widget_message_video_thumb[^>]*background-image:url\('([^']+)'\)/i.exec(p) || /<i class="[^"]*tgme_widget_message_video_thumb[^"]*"[^>]*url\('([^']+)'\)/i.exec(p);
    const dur = /tgme_widget_message_video_duration">([^<]+)</i.exec(p);
    out.push({
      id: "tg-" + channel + "-" + id,
      ref: channel + "|" + id,
      title: (text || tr("Video ", "Video ") + id).slice(0, 120),
      kind: "movie",
      genres: ["telegram"],
      poster: th ? absUrl(th[1]) || undefined : undefined,
      direct: vid ? absUrl(vid[1]) : "",
      duration: dur ? dur[1] : "",
    });
  }
  return out;
}

function minId(html) {
  let m = 0;
  const re = /data-post="[^"\/]+\/(\d+)"/gi;
  let x;
  while ((x = re.exec(html))) { const n = Number(x[1]); if (!m || n < m) m = n; }
  return m;
}

// Trae hasta `pages` páginas hacia atrás hasta juntar suficientes videos.
async function channelVideos(channel, before, want) {
  const items = [];
  let b = before || 0;
  let last = 0;
  for (let i = 0; i < 3 && items.length < want; i++) {
    const html = await getText("https://t.me/s/" + channel + (b ? "?before=" + b : ""));
    if (html.indexOf("tgme_widget_message") < 0) {
      if (!items.length && i === 0) throw fail("not_found", "sin publicaciones", "Ese canal no existe o no es público.", "That channel does not exist or is not public.");
      break;
    }
    const got = posts(html, channel);
    for (const g of got.reverse()) items.push(g);
    const mi = minId(html);
    log("canal " + channel + " desde " + (b || "último") + ": videos=" + got.length + " menor=" + mi);
    if (!mi || mi <= 1 || mi === last) break;
    last = mi;
    b = mi;
  }
  return { items: items.map(({ direct, duration, ...rest }) => rest), next: last };
}

export async function home() {
  await null;
  return [{
    id: "row-tg", title: "Telegram", genre: "telegram", ref: "help",
    items: [{ id: "tg-ayuda", ref: "help|0", title: tr("Escribe el nombre de un canal en el buscador", "Type a channel name in search"), kind: "movie", genres: ["telegram"] }],
  }];
}

export async function browse(ref, cursor) {
  await null;
  const r = String(ref || "");
  if (r.indexOf("c|") !== 0) return { items: [] };
  const ch = channelOf(r.slice(2));
  if (!ch) return { items: [] };
  const res = await channelVideos(ch, Number(cursor) || 0, 20);
  return { items: res.items, nextCursor: res.next > 1 ? String(res.next) : undefined };
}

export async function search(arg) {
  await null;
  const q = String((arg && (arg.q || arg.query)) || "").trim();
  const ch = channelOf(q);
  if (!ch) return [];
  const res = await channelVideos(ch, 0, 20);
  log("buscar " + ch + " -> " + res.items.length);
  return res.items;
}

export async function episodes(ref) {
  await null;
  const p = String(ref || "").split("|");
  if (p.length < 2 || p[0] === "help") throw fail("not_found", "ayuda", "Escribe el nombre de un canal público en el buscador.", "Type a public channel name in search.");
  return { series: { title: "" }, episodes: [{ season: 1, number: 1, ref: p[0] + "|" + p[1], title: tr("Video", "Video") }] };
}

export async function resolve(ref) {
  await null;
  const p = String(ref || "").split("|");
  const ch = channelOf(p[0]);
  const id = String(p[1] || "").replace(/\D/g, "");
  if (!ch || !id) throw fail("not_found", "referencia inválida", "No se encontró ese video.", "Video not found.");
  // 1) Vista de una sola publicación.
  let src = "";
  try {
    const h = await getText("https://t.me/" + ch + "/" + id + "?embed=1&mode=tme");
    const m = /<video\b[^>]*\bsrc="([^"]+)"/i.exec(h);
    if (m) src = absUrl(m[1]);
  } catch (e) { log("embed falló"); }
  // 2) Respaldo: la página del canal justo en esa publicación.
  if (!src) {
    try {
      const h = await getText("https://t.me/s/" + ch + "?before=" + (Number(id) + 1));
      const hit = posts(h, ch).find((x) => x.ref === ch + "|" + id);
      if (hit && hit.direct) src = hit.direct;
    } catch (e) { log("respaldo falló"); }
  }
  if (!src) throw fail("unavailable", "sin archivo directo", "Telegram no ofrece este video para verlo desde la web pública.", "Telegram does not offer this video on its public web page.");
  log("video directo encontrado");
  return { url: src, mime: "video/mp4", headers: { Referer: "https://t.me/", "User-Agent": UA }, label: "Telegram" };
}
