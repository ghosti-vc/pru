// Mi HLS — reproductor HLS con "puerta" del Protocolo de Plugins (apiVersion 20)

const STATE = {
  url: "",
  audioTracks: [],
  subtitleTracks: [],
  currentAudio: -1,
  currentSubtitle: -1
};

// ---------- "Puerta": otros plugins nos llaman vía kino.plugins.call ----------
async function handleProtocolCall(payload) {
  // payload esperado: { action: "playHls", url: "https://.../index.m3u8", ... }
  const action = payload && payload.action;
  const url = payload && (payload.url || payload.hlsUrl || payload.manifest);

  if (action !== "playHls" || !url) {
    return { ok: false, error: "Se requiere action='playHls' y url" };
  }

  STATE.url = url;
  await kino.ui.open("./player"); // abrimos nuestra pantalla del reproductor
  return { ok: true };
}

// Registro de la puerta — solo si Kino expone el Protocolo de Plugins
if (typeof kino.plugins === "object" && typeof kino.plugins.onCall === "function") {
  kino.plugins.onCall(handleProtocolCall);
}

// ---------- Pantalla principal ----------
kino.registerRoute("./home", async () => {
  const saved = kino.settings.get("hlsUrl", "");
  const items = [
    { type: "title", text: "Mi HLS" },
    { type: "text", text: saved ? "URL guardada:\n" + saved : "Sin URL guardada. Pégala en Ajustes o espera a que otro plugin te pase un stream." },
    saved ? { type: "button", text: "▶ Reproducir", onAction: () => { STATE.url = saved; kino.ui.open("./player"); } } : null,
    saved ? { type: "button", text: "✏ Cambiar URL", onAction: async () => {
        const input = await kino.ui.prompt("Pega la URL .m3u8", saved);
        if (input) { kino.settings.set("hlsUrl", input); kino.ui.refresh(); }
      } } : null
  ].filter(Boolean);
  return { layout: "list", items };
});

// ---------- Pantalla del reproductor ----------
kino.registerRoute("./player", async () => {
  if (!STATE.url) {
    const saved = kino.settings.get("hlsUrl", "");
    if (!saved) return { layout: "list", items: [{ type: "text", text: "No hay URL que reproducir." }] };
    STATE.url = saved;
  }

  return {
    layout: "player",
    source: {
      type: "hls",
      url: STATE.url
      // Kino detecta automáticamente las pistas de audio y subtítulos del manifest
    },
    items: [
      { type: "title", text: "Reproduciendo HLS" },
      { type: "button", text: "← Volver", onAction: () => kino.ui.open("./home") }
    ]
  };
});

// Ruta por defecto
kino.registerRouteDefault("./home");
