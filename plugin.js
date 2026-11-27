
// Llamadas al portal: cuerpo cifrado, respuesta descifrada, hosts rotados.
import { wrap, unwrap } from "./crypto.js";

const HOSTS = [
  "ftmrmy.jdfey0cd.com",
  "fuxok.nguvmqhpk.com",
  "eajmnp.hcgv1dt8.com",
  "mptec.dhkrxuzcy.com",
  "hinumz.a878kkoyc.com",
  "krdwvd.swcaw7qx.com",
];

const HEADERS = {
  apk: "com.android.msandroid",
  apkVer: "43404",
  spkgVer: "2024-09-10 06:25:30_33_13_",
  "Content-Type": "application/json; charset=utf-8",
  Connection: "Keep-Alive",
  "User-Agent": "okhttp/3.12.12",
};

export const EP = {
  snToken: "v3/snToken",
  active: "v8/active",
  getColumnContents: "v3/getColumnContents",
  getItemData: "v4/getItemData",
  search: "searchResourceOrPerson",
  getLiveData: "v6/getLiveData",
  startPlayVOD: "v10/startPlayVOD",
  getSlbInfo: "v15/getSlbInfo",
};

let current = HOSTS[0];
let lastCall = 0;
let turn = Promise.resolve();

function pause() {
  const run = turn.then(async () => {
    const wait = 400 - (Date.now() - lastCall);
    if (lastCall && wait > 0) await kino.sleep(wait);
  }).then(() => {
    lastCall = Date.now();
  });
  turn = run.catch(() => {});
  return run;
}

function codeOf(body) {
  if (body.err != null) return String(body.err);
  if (body.returnCode != null) return String(body.returnCode);
  if (body.code != null) return String(body.code);
  return null;
}

function payloadOf(body) {
  const raw = body.res !== undefined ? body.res : body.data;
  if (typeof raw === "string" && /^[0-9a-fA-F]+$/.test(raw) && raw.length > 16) return JSON.parse(unwrap(raw));
  return raw;
}

export async function call(path, data) {
  await pause();
  const body = wrap(data);
  const order = [current].concat(HOSTS.filter((host) => host !== current));
  let failure = null;
  for (const host of order) {
    let res;
    try {
      res = await kino.fetch("https://" + host + "/api/portalCore/" + path, {
        method: "POST",
        headers: HEADERS,
        body,
      });
    } catch (err) {
      failure = err;
      continue;
    }
    if (!res.ok) {
      failure = new Error("HTTP " + res.status);
      continue;
    }
    let bodyJson;
    try {
      bodyJson = JSON.parse(await res.text());
    } catch {
      failure = new Error("Respuesta no válida");
      continue;
    }
    const code = codeOf(bodyJson);
    if (code === null) {
      failure = new Error("Respuesta sin estado");
      continue;
    }
    if (code !== "0") {
      const err = new Error("El portal rechazó " + path);
      err.code = code;
      err.portalError = true;
      throw err;
    }
    current = host;
    return payloadOf(bodyJson);
  }
  throw failure || new Error("El portal no respondió");
}
