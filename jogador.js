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

// Cada jogadora escolhe "quem é ela" uma vez (guardado só no navegador dela) e daí só vê
// e edita o próprio inventário, nunca o das colegas. Ela pode digitar um item qualquer
// ou puxar um item já cadastrado no Compêndio da Mestra (com a descrição junto). As
// mudanças são salvas direto no Firestore (só o campo "pcs", pra não arriscar sobrescrever
// outra parte do estado que a Mestra esteja editando ao mesmo tempo).
const PC_STORAGE_KEY = "mesaJogadoraPcId";
let fbMod = null;

function getSelectedPcId() {
  try {
    return localStorage.getItem(PC_STORAGE_KEY);
  } catch (err) {
    return null;
  }
}

function setSelectedPcId(id) {
  try {
    localStorage.setItem(PC_STORAGE_KEY, id);
  } catch (err) {
    // sem localStorage disponível — a jogadora só vai precisar escolher de novo se recarregar
  }
}

function clearSelectedPcId() {
  try {
    localStorage.removeItem(PC_STORAGE_KEY);
  } catch (err) {}
}

// Mostra a pergunta "Quem é você?" assim que a página carrega, sem esperar a campanha
// terminar de sincronizar — a lista de Princesas é preenchida depois, quando os dados
// chegarem (renderPlayerPicker cuida disso).
(function showPlayerPickerImmediately() {
  if (getSelectedPcId()) return;
  const overlay = document.getElementById("player-pc-picker");
  const list = document.getElementById("player-pc-picker-list");
  overlay.style.display = "flex";
  list.innerHTML = `<p class="field-hint">Carregando lista de Princesas...</p>`;
})();

function renderPlayerPicker(state) {
  const overlay = document.getElementById("player-pc-picker");
  const pcs = state.pcs || [];
  const selectedId = getSelectedPcId();
  const stillExists = selectedId && pcs.some((p) => p.id === selectedId);
  if (stillExists || pcs.length === 0) {
    overlay.style.display = "none";
    return;
  }
  overlay.style.display = "flex";
  const list = document.getElementById("player-pc-picker-list");
  list.innerHTML = pcs.map((p) => `<button type="button" data-pick-pc="${p.id}">${escapeHtml(p.nome)}</button>`).join("");
  list.querySelectorAll("[data-pick-pc]").forEach((btn) =>
    btn.addEventListener("click", () => {
      setSelectedPcId(btn.dataset.pickPc);
      resetInventoryUiState();
      renderAll(latestState);
    })
  );
}

function resetInventoryUiState() {
  inventoryRemoveMode = false;
  inventoryMenuOpen = false;
  inventoryOpenDetails.clear();
}

async function persistPcs() {
  if (!latestState) return;
  setStatus("Salvando...");
  try {
    if (!fbMod) fbMod = await import("./firebase-config.js");
    const ok = await fbMod.savePcs(latestState.pcs);
    setStatus(ok ? "Conectado" : "Sem conexão — a mudança pode não ter sido salva");
  } catch (err) {
    setStatus("Sem conexão — a mudança pode não ter sido salva");
  }
}

function currentPc() {
  if (!latestState) return null;
  const selectedId = getSelectedPcId();
  return (latestState.pcs || []).find((p) => p.id === selectedId) || null;
}

function addFreeformItem(text) {
  const pc = currentPc();
  const trimmed = text.trim();
  if (!pc || !trimmed) return;
  pc.inventario = pc.inventario || [];
  pc.inventario.push(trimmed);
  persistPcs();
  renderInventories(latestState);
}

function removeFreeformItem(index) {
  const pc = currentPc();
  if (!pc) return;
  pc.inventario.splice(index, 1);
  persistPcs();
  renderInventories(latestState);
}

function addCompendioRef(tipo, refId) {
  const pc = currentPc();
  if (!pc) return;
  pc.compendioRefs = pc.compendioRefs || [];
  if (pc.compendioRefs.some((r) => r.tipo === tipo && r.refId === refId)) return;
  pc.compendioRefs.push({ tipo, refId });
  persistPcs();
  renderInventories(latestState);
}

function removeCompendioRef(tipo, refId) {
  const pc = currentPc();
  if (!pc) return;
  pc.compendioRefs = (pc.compendioRefs || []).filter((r) => !(r.tipo === tipo && r.refId === refId));
  persistPcs();
  renderInventories(latestState);
}

// Um item digitado à mão que bate com o nome de algo no Compêndio ganha o "?" também —
// assim a jogadora não precisa lembrar de puxar do Compêndio pra ver a explicação.
// IMPORTANTE: só usamos entry.descricao/entry.texto aqui, nunca entry.verdadeMestra —
// isso é segredo da Mestra e não pode aparecer pro lado da jogadora de jeito nenhum.
function findMatchingCompendioText(state, nome) {
  const lower = nome.trim().toLowerCase();
  const item = (state.items || []).find((i) => i.nome.toLowerCase() === lower);
  if (item) return item.descricao || "";
  const doc = (state.documentos || []).find((d) => d.nome.toLowerCase() === lower);
  if (doc) return doc.texto || "";
  return null;
}

// Junta itens digitados à mão e itens/achados puxados do Compêndio numa lista só, cada
// um já com o texto explicativo (se tiver) pronto pro "?".
function buildInventoryEntries(state, pc) {
  const entries = [];
  (pc.inventario || []).forEach((texto, idx) => {
    entries.push({
      key: `f-${idx}`,
      nome: texto,
      desc: findMatchingCompendioText(state, texto),
      remove: () => removeFreeformItem(idx),
    });
  });
  (pc.compendioRefs || []).forEach((ref) => {
    const pool = ref.tipo === "documento" ? state.documentos || [] : state.items || [];
    const entry = pool.find((x) => x.id === ref.refId);
    if (!entry) return;
    entries.push({
      key: `r-${ref.tipo}-${ref.refId}`,
      nome: entry.nome,
      desc: (ref.tipo === "documento" ? entry.texto : entry.descricao) || "",
      remove: () => removeCompendioRef(ref.tipo, ref.refId),
    });
  });
  return entries;
}

let inventoryRemoveMode = false;
let inventoryMenuOpen = false;
const inventoryOpenDetails = new Set();

function inventoryEntryHtml(e) {
  const hasInfo = !!e.desc;
  const isOpen = inventoryOpenDetails.has(e.key);
  return `
    <div class="inv-entry">
      <div class="inv-entry-row">
        <span class="inv-entry-nome">${escapeHtml(e.nome)}</span>
        ${hasInfo ? `<button type="button" class="inv-info-btn ${isOpen ? "open" : ""}" data-toggle-detail="${e.key}" aria-label="O que é isso?">?</button>` : ""}
        ${inventoryRemoveMode ? `<button type="button" class="item-remove-btn" data-remove-entry="${e.key}" aria-label="Remover">×</button>` : ""}
      </div>
      ${hasInfo ? `<div class="inv-entry-detail ${isOpen ? "open" : ""}" id="detail-${e.key}">${escapeHtml(e.desc)}</div>` : ""}
    </div>
  `;
}

function renderInventories(state) {
  const list = document.getElementById("inventory-list");
  const pc = currentPc();
  if (!pc) {
    list.innerHTML = `<p class="field-hint">Escolha quem você é pra ver seu inventário.</p>`;
    return;
  }
  const entries = buildInventoryEntries(state, pc);
  const entriesHtml = entries.length
    ? entries.map(inventoryEntryHtml).join("")
    : `<p class="field-hint">Inventário vazio.</p>`;
  list.innerHTML = `
    <div class="inventory-card">
      <div class="inventory-card-header">
        <h3>${escapeHtml(pc.nome)}</h3>
        <div class="inv-menu-wrap">
          <button type="button" class="inv-menu-btn" id="btn-inv-menu" aria-label="Opções">⋮</button>
          <div class="inv-menu-dropdown ${inventoryMenuOpen ? "" : "hidden"}" id="inv-menu-dropdown">
            <button type="button" id="btn-inv-menu-add">+ Adicionar item</button>
            <button type="button" id="btn-inv-menu-remove">${inventoryRemoveMode ? "Concluir remoção" : "Remover item"}</button>
          </div>
        </div>
      </div>
      ${entriesHtml}
    </div>
  `;

  list.querySelectorAll("[data-toggle-detail]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const key = btn.dataset.toggleDetail;
      if (inventoryOpenDetails.has(key)) inventoryOpenDetails.delete(key);
      else inventoryOpenDetails.add(key);
      renderInventories(latestState);
    })
  );
  list.querySelectorAll("[data-remove-entry]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const entry = entries.find((e) => e.key === btn.dataset.removeEntry);
      if (entry) entry.remove();
    })
  );
  document.getElementById("btn-inv-menu").addEventListener("click", (e) => {
    e.stopPropagation();
    inventoryMenuOpen = !inventoryMenuOpen;
    renderInventories(latestState);
  });
  document.getElementById("btn-inv-menu-add").addEventListener("click", (e) => {
    e.stopPropagation();
    inventoryMenuOpen = false;
    renderInventories(latestState);
    openItemPicker();
  });
  document.getElementById("btn-inv-menu-remove").addEventListener("click", (e) => {
    e.stopPropagation();
    inventoryRemoveMode = !inventoryRemoveMode;
    inventoryMenuOpen = false;
    renderInventories(latestState);
  });
}

// Fecha o menu de "⋮" se a jogadora clicar em qualquer outro lugar da página.
document.addEventListener("click", (e) => {
  if (inventoryMenuOpen && !e.target.closest(".inv-menu-wrap")) {
    inventoryMenuOpen = false;
    renderInventories(latestState);
  }
});

function renderItemPickerList() {
  const list = document.getElementById("player-item-picker-list");
  const query = document.getElementById("player-item-picker-search").value.trim().toLowerCase();
  const pc = currentPc();
  const items = (latestState.items || []).filter((i) => !query || i.nome.toLowerCase().includes(query));
  if (items.length === 0) {
    list.innerHTML = `<p class="field-hint">Nenhum item encontrado.</p>`;
    return;
  }
  list.innerHTML = items
    .map((i) => {
      const already = pc && (pc.compendioRefs || []).some((r) => r.tipo === "item" && r.refId === i.id);
      return `
        <div class="player-item-picker-row">
          <span>${escapeHtml(i.nome)}</span>
          <button type="button" data-pick-item="${i.id}" ${already ? "disabled" : ""}>${already ? "Adicionado" : "Adicionar"}</button>
        </div>
      `;
    })
    .join("");
  list.querySelectorAll("[data-pick-item]").forEach((btn) =>
    btn.addEventListener("click", () => {
      addCompendioRef("item", btn.dataset.pickItem);
      renderItemPickerList();
    })
  );
}

function openItemPicker() {
  document.getElementById("player-item-picker-search").value = "";
  document.getElementById("player-item-freeform-input").value = "";
  renderItemPickerList();
  document.getElementById("player-item-picker").style.display = "flex";
}

document.getElementById("player-item-picker-search").addEventListener("input", renderItemPickerList);
document.getElementById("btn-close-item-picker").addEventListener("click", () => {
  document.getElementById("player-item-picker").style.display = "none";
});
document.getElementById("btn-add-freeform-item").addEventListener("click", () => {
  const input = document.getElementById("player-item-freeform-input");
  addFreeformItem(input.value);
  input.value = "";
  document.getElementById("player-item-picker").style.display = "none";
});
document.getElementById("player-item-freeform-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("btn-add-freeform-item").click();
  }
});

function renderAll(state) {
  latestState = state;
  document.getElementById("player-campaign-name").textContent = state.campaignName || "Mesa do Mestre";
  renderHandout(state);
  renderSharedText(state);
  renderMap(state);
  renderPlayerPicker(state);
  renderInventories(state);
}

document.getElementById("btn-trocar-pc").addEventListener("click", () => {
  clearSelectedPcId();
  resetInventoryUiState();
  if (latestState) renderAll(latestState);
});

async function start() {
  setStatus("Conectando...");
  let mod;
  try {
    mod = await import("./firebase-config.js");
    fbMod = mod;
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
