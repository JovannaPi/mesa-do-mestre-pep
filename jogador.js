function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function setStatus(text) {
  document.getElementById("player-status").textContent = text;
}

let latestState = null;
let latestLive = null;
let unsubscribe = null;
let liveUnsubscribe = null;
const mapCanvas = document.getElementById("player-map-canvas");

// Posição dos marcadores, mapa ativo e visibilidade vêm de um documento separado e
// pequeno no Firestore (veja firebase-config.js) — assim mover um marcador nunca precisa
// reenviar a campanha inteira, só essa parte pequena. Isso é o que fazia o mapa demorar
// muito pra sincronizar entre o celular e o computador.
function buildTokenPositionsFromState(state) {
  const out = {};
  (state.maps || []).forEach((m) => {
    out[m.id] = {};
    m.tokens.forEach((t) => {
      out[m.id][t.id] = { x: t.x, y: t.y };
    });
  });
  return out;
}

function applyLiveIntoState(live) {
  if (!latestState || !live) return;
  latestState.activeMapId = live.activeMapId ?? latestState.activeMapId;
  latestState.mapaVisivelJogadores = live.mapaVisivelJogadores ?? latestState.mapaVisivelJogadores;
  if (live.tokenPositions) {
    (latestState.maps || []).forEach((m) => {
      const pos = live.tokenPositions[m.id];
      if (!pos) return;
      m.tokens.forEach((t) => {
        const p = pos[t.id];
        if (p) {
          t.x = p.x;
          t.y = p.y;
        }
      });
    });
  }
}

function activeMapFromState(state) {
  if (!state || !state.maps) return null;
  return state.maps.find((m) => m.id === state.activeMapId) || null;
}

function renderHandout(state) {
  const box = document.getElementById("handout-box");
  const img = document.getElementById("handout-img");
  const caption = document.getElementById("handout-caption");
  const handout = state.imagens && state.imagens.find((h) => h.id === state.handoutAtivoId);
  if (handout) {
    img.src = handout.imagem;
    caption.textContent = handout.nome;
    box.style.display = "";
  } else {
    box.style.display = "none";
  }
}

function attachTokenDrag(el, token, map) {
  let dragging = false;
  let moved = false;
  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    dragging = true;
    moved = false;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    moved = true;
    const rect = mapCanvas.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;
    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));
    el.style.left = x + "%";
    el.style.top = y + "%";
  });
  el.addEventListener("pointerup", async (e) => {
    dragging = false;
    if (!moved) return;
    const rect = mapCanvas.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;
    token.x = Math.max(0, Math.min(100, x));
    token.y = Math.max(0, Math.min(100, y));
    await persistTokenMove();
  });
}

async function persistTokenMove() {
  if (!latestState) return;
  setStatus("Salvando posição...");
  try {
    const mod = await import("./firebase-config.js");
    const ok = await mod.saveLiveState({
      tokenPositions: buildTokenPositionsFromState(latestState),
      activeMapId: latestState.activeMapId,
      mapaVisivelJogadores: latestState.mapaVisivelJogadores,
    });
    setStatus(ok ? "Conectado" : "Sem conexão — a Mestra pode não ver seu movimento");
  } catch (err) {
    setStatus("Sem conexão — a Mestra pode não ver seu movimento");
  }
}

function sizeCanvasToRatio(ratioW, ratioH) {
  const parent = mapCanvas.parentElement;
  const availWidth = parent ? parent.clientWidth : mapCanvas.clientWidth;
  const maxHeight = window.innerHeight * 0.7;
  let w = availWidth;
  let h = (w * ratioH) / ratioW;
  if (h > maxHeight) {
    h = maxHeight;
    w = (h * ratioW) / ratioH;
  }
  mapCanvas.style.width = Math.round(w) + "px";
  mapCanvas.style.height = Math.round(h) + "px";
}

let lastMapRatio = null;

function applyMapAspectRatio(map) {
  if (map.largura && map.altura) {
    lastMapRatio = { w: map.largura, h: map.altura };
    sizeCanvasToRatio(map.largura, map.altura);
    return;
  }
  const img = new Image();
  img.onload = () => {
    lastMapRatio = { w: img.naturalWidth, h: img.naturalHeight };
    sizeCanvasToRatio(img.naturalWidth, img.naturalHeight);
  };
  img.src = map.imagem;
}

let mapResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(mapResizeTimer);
  mapResizeTimer = setTimeout(() => {
    if (lastMapRatio) sizeCanvasToRatio(lastMapRatio.w, lastMapRatio.h);
  }, 150);
});

function getTokenVisual(state, token) {
  if (!token.origemTipo || !token.origemId) return null;
  if (token.origemTipo === "pc") {
    const pc = (state.pcs || []).find((p) => p.id === token.origemId);
    if (!pc) return null;
    return { foto: pc.foto || null, hpAtual: pc.coracaoAtual, hpMax: pc.coracaoMax };
  }
  if (token.origemTipo === "npc") {
    const npc = (state.npcs || []).find((n) => n.id === token.origemId);
    if (!npc) return null;
    const combatant = (state.combat ? state.combat.combatants : []).find((c) => !c.isPc && c.nome === npc.nome);
    return {
      foto: npc.foto || null,
      hpAtual: combatant ? combatant.coracaoAtual : null,
      hpMax: combatant ? combatant.coracaoMax : null,
    };
  }
  return null;
}

function tokenInnerHtml(state, t) {
  const visual = getTokenVisual(state, t);
  const hasHp = visual && typeof visual.hpMax === "number" && visual.hpMax > 0;
  const hpPct = hasHp ? Math.max(0, Math.min(100, (visual.hpAtual / visual.hpMax) * 100)) : null;
  const avatar =
    visual && visual.foto
      ? `<img class="map-token-avatar" src="${visual.foto}" alt="" draggable="false">`
      : `<div class="map-token-dot" style="background:${t.cor}"></div>`;
  return `
    ${avatar}
    ${hasHp ? `<div class="map-token-hpbar-wrap"><div class="map-token-hpbar ${hpPct <= 25 ? "critical" : hpPct <= 50 ? "low" : ""}" style="width:${hpPct}%"></div></div>` : ""}
    <span class="map-token-label">${escapeHtml(t.nome)}</span>
  `;
}

function renderMap(state) {
  const map = activeMapFromState(state);
  if (state.mapaVisivelJogadores === false) {
    mapCanvas.style.backgroundImage = "";
    mapCanvas.style.width = "";
    mapCanvas.style.height = "";
    lastMapRatio = null;
    mapCanvas.innerHTML = `<div class="empty-state"><span class="icon empty-state-icon">visibility_off</span><span>A Mestra escondeu o mapa por enquanto...</span></div>`;
    return;
  }
  if (!map) {
    mapCanvas.style.backgroundImage = "";
    mapCanvas.style.width = "";
    mapCanvas.style.height = "";
    lastMapRatio = null;
    mapCanvas.innerHTML = `<div class="empty-state"><span class="icon empty-state-icon">map</span><span>Aguardando a Mestra escolher um mapa...</span></div>`;
    return;
  }
  applyMapAspectRatio(map);
  mapCanvas.style.backgroundImage = `url(${map.imagem})`;
  mapCanvas.innerHTML = map.tokens
    .map((t) => `<div class="map-token" style="left:${t.x}%; top:${t.y}%" data-token-id="${t.id}">${tokenInnerHtml(state, t)}</div>`)
    .join("");
  mapCanvas.querySelectorAll(".map-token").forEach((el) => {
    const token = map.tokens.find((t) => t.id === el.dataset.tokenId);
    attachTokenDrag(el, token, map);
  });
}

function renderSharedText(state) {
  const box = document.getElementById("shared-text-box");
  const tipo = state.textoCompartilhadoTipo;
  const id = state.textoCompartilhadoId;
  let entry = null;
  if (tipo === "item") entry = (state.items || []).find((i) => i.id === id);
  else if (tipo === "nota") entry = (state.notes || []).find((n) => n.id === id);
  else if (tipo === "documento") entry = (state.documentos || []).find((d) => d.id === id);
  if (!entry) {
    box.style.display = "none";
    return;
  }
  document.getElementById("shared-text-title").textContent = entry.nome || entry.titulo || "";
  document.getElementById("shared-text-body").textContent = entry.descricao || entry.texto || "";
  box.style.display = "";
}

function renderAll(state) {
  latestState = state;
  document.getElementById("player-campaign-name").textContent = state.campaignName || "Mesa do Mestre";
  renderHandout(state);
  renderSharedText(state);
  renderMap(state);
}

async function start() {
  setStatus("Conectando...");
  let mod;
  try {
    mod = await import("./firebase-config.js");
  } catch (err) {
    setStatus("Não foi possível conectar. Verifique sua internet e recarregue a página.");
    return;
  }
  const [initial, initialLive] = await Promise.all([mod.loadCloudState(), mod.loadLiveState()]);
  if (initial) {
    latestState = initial;
    latestLive = initialLive;
    if (initialLive) applyLiveIntoState(initialLive);
    renderAll(latestState);
    setStatus("Conectado");
  } else {
    setStatus("Aguardando a Mestra iniciar a campanha...");
  }
  unsubscribe = mod.subscribeToState(
    (state) => {
      latestState = state;
      if (latestLive) applyLiveIntoState(latestLive);
      renderAll(latestState);
      setStatus("Conectado");
    },
    () => setStatus("Conexão perdida — tentando de novo...")
  );
  liveUnsubscribe = mod.subscribeToLiveState(
    (live) => {
      latestLive = live;
      if (latestState) {
        applyLiveIntoState(live);
        renderAll(latestState);
      }
    },
    () => {}
  );
}

start();
