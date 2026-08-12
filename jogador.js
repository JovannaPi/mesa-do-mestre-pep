function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function setStatus(text) {
  document.getElementById("player-status").textContent = text;
}

let latestState = null;
let unsubscribe = null;
const mapCanvas = document.getElementById("player-map-canvas");

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
    const ok = await mod.saveCloudState(latestState);
    setStatus(ok ? "Conectado" : "Sem conexão — a Mestra pode não ver seu movimento");
  } catch (err) {
    setStatus("Sem conexão — a Mestra pode não ver seu movimento");
  }
}

function renderMap(state) {
  const map = activeMapFromState(state);
  if (!map) {
    mapCanvas.style.backgroundImage = "";
    mapCanvas.innerHTML = `<div class="empty-state">Aguardando a Mestra escolher um mapa...</div>`;
    return;
  }
  mapCanvas.style.backgroundImage = `url(${map.imagem})`;
  mapCanvas.innerHTML = map.tokens
    .map(
      (t) => `
    <div class="map-token" style="left:${t.x}%; top:${t.y}%" data-token-id="${t.id}">
      <div class="map-token-dot" style="background:${t.cor}"></div>
      <span class="map-token-label">${escapeHtml(t.nome)}</span>
    </div>
  `
    )
    .join("");
  mapCanvas.querySelectorAll(".map-token").forEach((el) => {
    const token = map.tokens.find((t) => t.id === el.dataset.tokenId);
    attachTokenDrag(el, token, map);
  });
}

function renderAll(state) {
  latestState = state;
  document.getElementById("player-campaign-name").textContent = state.campaignName || "Mesa do Mestre";
  renderHandout(state);
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
  const initial = await mod.loadCloudState();
  if (initial) {
    renderAll(initial);
    setStatus("Conectado");
  } else {
    setStatus("Aguardando a Mestra iniciar a campanha...");
  }
  unsubscribe = mod.subscribeToState(
    (state) => {
      renderAll(state);
      setStatus("Conectado");
    },
    () => setStatus("Conexão perdida — tentando de novo...")
  );
}

start();
