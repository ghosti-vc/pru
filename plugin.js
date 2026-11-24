// Cuerpo binario de una respuesta. Kino puede no exponer arrayBuffer ni bytes: si solo hay texto,
// se rearma desde hex o base64, y como último recurso byte por byte.
async function bytes(answer) {
  if (typeof answer.arrayBuffer === "function") return new Uint8Array(await answer.arrayBuffer());
  if (typeof answer.bytes === "function") return new Uint8Array(await answer.bytes());
  const raw = await body(answer);
  if (!raw) return new Uint8Array(0);
  const clean = raw.replace(/\s+/g, "");
  if (clean.length % 2 === 0 && /^[0-9a-f]+$/i.test(clean)) return fromHex(clean);
  if (clean.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(clean)) {
    try {
      return fromHex(kino.crypto.convert(clean, "base64", "hex"));
    } catch {
      // no era base64: sigue como texto
    }
  }
  return toBytes(raw);
}

function hexHead(got) {
  let out = "";
  for (let i = 0; i < got.length && i < 16; i++) out += ("0" + got[i].toString(16)).slice(-2);
  return out || "vacio";
}

// Pide un rango y devuelve esos bytes. Si la CDN ignora el Range, recorta el archivo completo.
async function ranged(url, start, end, headers) {
  const want = end - start + 1;
  const h = { ...headers, Accept: "*/*", Range: "bytes=" + start + "-" + end };
  const answer = await kino.fetch(url, { headers: h, redirect: "follow" });
  if (!answer.ok) throw kino.error("unavailable", "rango " + answer.status);
  let got = await bytes(answer);
  if (!got.length) {
    // un Kino que no entrega binario devuelve el cuerpo vacío: se reintenta pidiendo base64
    const again = await kino.fetch(url, { headers: h, redirect: "follow", responseType: "base64" });
    if (again.ok) got = await bytes(again);
  }
  if (!got.length) throw kino.error("unavailable", "rango sin cuerpo");
  if (got.length > want) got = got.subarray(start, end + 1);
  return got;
}