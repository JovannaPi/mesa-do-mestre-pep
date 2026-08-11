const STORAGE_KEY = "mestre-pep-data-v1";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through */ }
  }
  return {
    campaignName: "Minha Campanha",
    npcs: [],
    sessions: [],
    combat: { round: 1, currentIndex: 0, combatants: [] },
  };
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// ---------- Campaign name ----------
document.getElementById("campaign-name").textContent = state.campaignName;
document.getElementById("btn-rename-campaign").addEventListener("click", () => {
  const name = prompt("Nome da campanha:", state.campaignName);
  if (name && name.trim()) {
    state.campaignName = name.trim();
    document.getElementById("campaign-name").textContent = state.campaignName;
    saveState();
  }
});

// ---------- Backup / restore ----------
document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `backup-${state.campaignName.replace(/\s+/g, "_")}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported.npcs || !imported.sessions || !imported.combat) throw new Error("formato inválido");
      if (!confirm("Importar este backup vai substituir todos os dados atuais. Continuar?")) return;
      state = imported;
      saveState();
      document.getElementById("campaign-name").textContent = state.campaignName;
      renderAll();
    } catch (err) {
      alert("Arquivo inválido: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// ==================== NPCs ====================
const npcModal = document.getElementById("modal-npc");
const formNpc = document.getElementById("form-npc");

function openNpcModal(npc) {
  document.getElementById("npc-modal-title").textContent = npc ? "Editar NPC/Monstro" : "Novo NPC/Monstro";
  document.getElementById("npc-id").value = npc ? npc.id : "";
  document.getElementById("npc-nome").value = npc ? npc.nome : "";
  document.getElementById("npc-tipo").value = npc ? npc.tipo : "NPC";
  document.getElementById("npc-determinacao").value = npc ? npc.determinacao : 10;
  document.getElementById("npc-graca").value = npc ? npc.graca : 10;
  document.getElementById("npc-astucia").value = npc ? npc.astucia : 10;
  document.getElementById("npc-pv").value = npc ? npc.pv : 10;
  document.getElementById("npc-defesa").value = npc ? npc.defesa : 10;
  document.getElementById("npc-tags").value = npc ? npc.tags.join(", ") : "";
  document.getElementById("npc-notas").value = npc ? npc.notas : "";
  npcModal.classList.remove("hidden");
}

function closeNpcModal() { npcModal.classList.add("hidden"); formNpc.reset(); }

document.getElementById("btn-add-npc").addEventListener("click", () => openNpcModal(null));
document.getElementById("btn-cancel-npc").addEventListener("click", closeNpcModal);

formNpc.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("npc-id").value;
  const tags = document.getElementById("npc-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
  const data = {
    id: id || uid(),
    nome: document.getElementById("npc-nome").value.trim(),
    tipo: document.getElementById("npc-tipo").value,
    determinacao: Number(document.getElementById("npc-determinacao").value) || 0,
    graca: Number(document.getElementById("npc-graca").value) || 0,
    astucia: Number(document.getElementById("npc-astucia").value) || 0,
    pv: Number(document.getElementById("npc-pv").value) || 0,
    defesa: Number(document.getElementById("npc-defesa").value) || 0,
    tags,
    notas: document.getElementById("npc-notas").value.trim(),
  };
  if (id) {
    const idx = state.npcs.findIndex((n) => n.id === id);
    state.npcs[idx] = data;
  } else {
    state.npcs.push(data);
  }
  saveState();
  closeNpcModal();
  renderNpcs();
});

function deleteNpc(id) {
  if (!confirm("Excluir este NPC/Monstro?")) return;
  state.npcs = state.npcs.filter((n) => n.id !== id);
  saveState();
  renderNpcs();
}

function renderNpcs() {
  const list = document.getElementById("npc-list");
  const query = document.getElementById("npc-search").value.trim().toLowerCase();
  const filtered = state.npcs.filter((n) => {
    if (!query) return true;
    return n.nome.toLowerCase().includes(query) || n.tags.some((t) => t.toLowerCase().includes(query));
  });
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">Nenhum NPC ou monstro cadastrado ainda.</div>`;
    return;
  }
  list.innerHTML = filtered
    .map(
      (n) => `
    <div class="npc-card">
      <div class="npc-card-header">
        <h3>${escapeHtml(n.nome)}</h3>
        <span class="npc-type-badge">${escapeHtml(n.tipo)}</span>
      </div>
      <div class="npc-attrs">
        <span>DET <b>${n.determinacao}</b></span>
        <span>GRA <b>${n.graca}</b></span>
        <span>AST <b>${n.astucia}</b></span>
        <span>PV <b>${n.pv}</b></span>
        <span>DEF <b>${n.defesa}</b></span>
      </div>
      ${n.tags.length ? `<div class="npc-tags">${n.tags.map((t) => `<span class="npc-tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      ${n.notas ? `<div class="npc-notes">${escapeHtml(n.notas)}</div>` : ""}
      <div class="npc-card-actions">
        <button class="btn btn-ghost" data-edit-npc="${n.id}">✏️ Editar</button>
        <button class="btn btn-danger" data-delete-npc="${n.id}">🗑️ Excluir</button>
      </div>
    </div>
  `
    )
    .join("");

  list.querySelectorAll("[data-edit-npc]").forEach((btn) =>
    btn.addEventListener("click", () => openNpcModal(state.npcs.find((n) => n.id === btn.dataset.editNpc)))
  );
  list.querySelectorAll("[data-delete-npc]").forEach((btn) =>
    btn.addEventListener("click", () => deleteNpc(btn.dataset.deleteNpc))
  );
}

document.getElementById("npc-search").addEventListener("input", renderNpcs);

// ==================== Combat ====================
const combatantModal = document.getElementById("modal-combatant");
const formCombatant = document.getElementById("form-combatant");

document.getElementById("btn-add-combatant").addEventListener("click", () => {
  combatantModal.classList.remove("hidden");
});
document.getElementById("btn-cancel-combatant").addEventListener("click", () => {
  combatantModal.classList.add("hidden");
  formCombatant.reset();
});

formCombatant.addEventListener("submit", (e) => {
  e.preventDefault();
  const pvMax = Number(document.getElementById("c-pv-max").value) || 0;
  state.combat.combatants.push({
    id: uid(),
    nome: document.getElementById("c-nome").value.trim(),
    iniciativa: Number(document.getElementById("c-iniciativa").value) || 0,
    pvMax,
    pvAtual: pvMax,
    isPc: document.getElementById("c-is-pc").checked,
    condicoes: [],
  });
  saveState();
  combatantModal.classList.add("hidden");
  formCombatant.reset();
  renderCombat();
});

const fromNpcModal = document.getElementById("modal-from-npc");
document.getElementById("btn-add-from-npc").addEventListener("click", () => {
  const list = document.getElementById("from-npc-list");
  if (state.npcs.length === 0) {
    list.innerHTML = `<div class="empty-state">Nenhum NPC cadastrado. Crie um na aba "NPCs &amp; Monstros" primeiro.</div>`;
  } else {
    list.innerHTML = state.npcs
      .map(
        (n) => `
      <div class="from-npc-item">
        <span>${escapeHtml(n.nome)} <small style="color:var(--text-dim)">(${escapeHtml(n.tipo)}, PV ${n.pv})</small></span>
        <button class="btn btn-secondary" data-add-from-npc="${n.id}">+ Adicionar</button>
      </div>
    `
      )
      .join("");
    list.querySelectorAll("[data-add-from-npc]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const n = state.npcs.find((x) => x.id === btn.dataset.addFromNpc);
        state.combat.combatants.push({
          id: uid(),
          nome: n.nome,
          iniciativa: n.astucia,
          pvMax: n.pv,
          pvAtual: n.pv,
          isPc: false,
          condicoes: [],
        });
        saveState();
        renderCombat();
      })
    );
  }
  fromNpcModal.classList.remove("hidden");
});
document.getElementById("btn-cancel-from-npc").addEventListener("click", () => fromNpcModal.classList.add("hidden"));

document.getElementById("btn-roll-init").addEventListener("click", () => {
  if (state.combat.combatants.length === 0) return;
  state.combat.combatants.forEach((c) => {
    c.iniciativa = 1 + Math.floor(Math.random() * 20);
  });
  sortCombatants();
  saveState();
  renderCombat();
});

document.getElementById("btn-next-turn").addEventListener("click", () => {
  if (state.combat.combatants.length === 0) return;
  state.combat.currentIndex++;
  if (state.combat.currentIndex >= state.combat.combatants.length) {
    state.combat.currentIndex = 0;
    state.combat.round++;
  }
  saveState();
  renderCombat();
});

document.getElementById("btn-clear-combat").addEventListener("click", () => {
  if (!confirm("Limpar todos os combatentes e reiniciar a rodada?")) return;
  state.combat = { round: 1, currentIndex: 0, combatants: [] };
  saveState();
  renderCombat();
});

function sortCombatants() {
  state.combat.combatants.sort((a, b) => b.iniciativa - a.iniciativa);
}

function updateHp(id, delta) {
  const c = state.combat.combatants.find((x) => x.id === id);
  if (!c) return;
  c.pvAtual = Math.max(0, Math.min(c.pvMax, c.pvAtual + delta));
  saveState();
  renderCombat();
}

function removeCombatant(id) {
  const idx = state.combat.combatants.findIndex((x) => x.id === id);
  if (idx === -1) return;
  state.combat.combatants.splice(idx, 1);
  if (state.combat.currentIndex > idx) state.combat.currentIndex--;
  if (state.combat.currentIndex >= state.combat.combatants.length) state.combat.currentIndex = 0;
  saveState();
  renderCombat();
}

function renderCombat() {
  document.getElementById("round-number").textContent = state.combat.round;
  const list = document.getElementById("combat-list");
  if (state.combat.combatants.length === 0) {
    list.innerHTML = `<div class="empty-state">Nenhum combatente na mesa. Adicione manualmente ou importe do banco de NPCs.</div>`;
    return;
  }
  list.innerHTML = state.combat.combatants
    .map((c, idx) => {
      const hpPct = c.pvMax > 0 ? (c.pvAtual / c.pvMax) * 100 : 0;
      const hpClass = hpPct <= 25 ? "critical" : hpPct <= 50 ? "low" : "";
      const isCurrent = idx === state.combat.currentIndex;
      return `
      <div class="combatant-card ${isCurrent ? "current-turn" : ""} ${c.isPc ? "is-pc" : "is-npc"}">
        <div class="combatant-init">${c.iniciativa}</div>
        <div class="combatant-name">${isCurrent ? "▶ " : ""}${escapeHtml(c.nome)}</div>
        <div class="hp-control">
          <button class="icon-btn" data-hp-down="${c.id}">➖</button>
          <span>${c.pvAtual} / ${c.pvMax}</span>
          <button class="icon-btn" data-hp-up="${c.id}">➕</button>
          <div class="hp-bar-wrap"><div class="hp-bar ${hpClass}" style="width:${hpPct}%"></div></div>
        </div>
        <div class="combatant-actions">
          <button class="icon-btn" data-remove-combatant="${c.id}" title="Remover">🗑️</button>
        </div>
      </div>
    `;
    })
    .join("");

  list.querySelectorAll("[data-hp-down]").forEach((btn) => btn.addEventListener("click", () => updateHp(btn.dataset.hpDown, -1)));
  list.querySelectorAll("[data-hp-up]").forEach((btn) => btn.addEventListener("click", () => updateHp(btn.dataset.hpUp, 1)));
  list.querySelectorAll("[data-remove-combatant]").forEach((btn) =>
    btn.addEventListener("click", () => removeCombatant(btn.dataset.removeCombatant))
  );
}

// ==================== Sessions ====================
const sessionModal = document.getElementById("modal-session");
const formSession = document.getElementById("form-session");

function openSessionModal(session) {
  document.getElementById("session-modal-title").textContent = session ? "Editar sessão" : "Nova sessão";
  document.getElementById("session-id").value = session ? session.id : "";
  document.getElementById("session-titulo").value = session ? session.titulo : "";
  document.getElementById("session-data").value = session ? session.data : new Date().toISOString().slice(0, 10);
  document.getElementById("session-resumo").value = session ? session.resumo : "";
  document.getElementById("session-ganchos").value = session ? session.ganchos : "";
  sessionModal.classList.remove("hidden");
}

function closeSessionModal() { sessionModal.classList.add("hidden"); formSession.reset(); }

document.getElementById("btn-add-session").addEventListener("click", () => openSessionModal(null));
document.getElementById("btn-cancel-session").addEventListener("click", closeSessionModal);

formSession.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("session-id").value;
  const data = {
    id: id || uid(),
    titulo: document.getElementById("session-titulo").value.trim(),
    data: document.getElementById("session-data").value,
    resumo: document.getElementById("session-resumo").value.trim(),
    ganchos: document.getElementById("session-ganchos").value.trim(),
  };
  if (id) {
    const idx = state.sessions.findIndex((s) => s.id === id);
    state.sessions[idx] = data;
  } else {
    state.sessions.push(data);
  }
  saveState();
  closeSessionModal();
  renderSessions();
});

function deleteSession(id) {
  if (!confirm("Excluir esta sessão?")) return;
  state.sessions = state.sessions.filter((s) => s.id !== id);
  saveState();
  renderSessions();
}

function renderSessions() {
  const list = document.getElementById("session-list");
  if (state.sessions.length === 0) {
    list.innerHTML = `<div class="empty-state">Nenhuma sessão registrada ainda.</div>`;
    return;
  }
  const sorted = [...state.sessions].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  list.innerHTML = sorted
    .map(
      (s) => `
    <div class="session-card">
      <div class="session-card-header">
        <h3>${escapeHtml(s.titulo)}</h3>
        <span class="session-date">${s.data ? formatDate(s.data) : ""}</span>
      </div>
      ${s.resumo ? `<div class="session-section-label">Resumo</div><p class="session-text">${escapeHtml(s.resumo)}</p>` : ""}
      ${s.ganchos ? `<div class="session-section-label">Ganchos / próximos passos</div><p class="session-text">${escapeHtml(s.ganchos)}</p>` : ""}
      <div class="session-card-actions">
        <button class="btn btn-ghost" data-edit-session="${s.id}">✏️ Editar</button>
        <button class="btn btn-danger" data-delete-session="${s.id}">🗑️ Excluir</button>
      </div>
    </div>
  `
    )
    .join("");

  list.querySelectorAll("[data-edit-session]").forEach((btn) =>
    btn.addEventListener("click", () => openSessionModal(state.sessions.find((s) => s.id === btn.dataset.editSession)))
  );
  list.querySelectorAll("[data-delete-session]").forEach((btn) =>
    btn.addEventListener("click", () => deleteSession(btn.dataset.deleteSession))
  );
}

// ---------- helpers ----------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function renderAll() {
  renderCombat();
  renderNpcs();
  renderSessions();
}

renderAll();
