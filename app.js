const STORAGE_KEY = "mestre-pep-data-v2";

// Carregado sob demanda (import dinâmico) para que uma falha de rede ao buscar o
// Firebase nunca impeça o resto do app (que funciona 100% offline) de rodar.
let cloudModule = null;
async function getCloudModule() {
  if (cloudModule !== null) return cloudModule;
  try {
    cloudModule = await import("./firebase-config.js");
  } catch (err) {
    console.warn("Firebase indisponível, seguindo apenas com dados locais:", err);
    cloudModule = false;
  }
  return cloudModule;
}

function emptyState(icon, text) {
  return `<div class="empty-state"><span class="icon empty-state-icon">${icon}</span><span>${text}</span></div>`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Fotos e imagens vão pro Cloudinary (upload não-assinado, sem senha exposta no código)
// em vez de ficarem como texto gigante dentro do documento da campanha no Firestore —
// era isso que fazia o salvamento na nuvem falhar silenciosamente com muitas fotos.
const CLOUDINARY_CLOUD_NAME = "m6ma2igg";
const CLOUDINARY_UPLOAD_PRESET = "mesa-do-mestre";

async function uploadToCloudinary(fileOrDataUrl, resourceType) {
  resourceType = resourceType || "image";
  try {
    const form = new FormData();
    form.append("file", fileOrDataUrl);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error("upload falhou: " + res.status);
    const data = await res.json();
    return data.secure_url;
  } catch (err) {
    console.warn("Não foi possível enviar o arquivo pro Cloudinary, guardando só localmente por enquanto:", err);
    return null;
  }
}

function defaultState() {
  return {
    campaignName: "Cervovale",
    npcs: [],
    pcs: [],
    sessions: [],
    notes: [],
    objectives: [],
    items: [],
    combat: { round: 1, currentIndex: 0, combatants: [] },
    maps: [],
    activeMapId: null,
    imagens: [],
    handoutAtivoId: null,
    mapaVisivelJogadores: true,
    playlists: { combate: [], casual: [], chefe: [] },
    playlistCategorias: [
      { key: "combate", label: "Combate" },
      { key: "casual", label: "Casual" },
      { key: "chefe", label: "Chefe" },
    ],
    textoCompartilhadoTipo: null,
    textoCompartilhadoId: null,
    rascunho: "",
    seeded: false,
    seededV2: false,
    seededItems: false,
    seededFullText: false,
    seededExtras2: false,
    seededMonstros2: false,
    seededBaileENotas: false,
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    } catch (e) { /* fall through */ }
  }
  return defaultState();
}

let state = loadState();

let cloudSyncTimer = null;
function setSyncStatus(text) {
  const el = document.getElementById("sync-status");
  if (el) el.textContent = text;
}

async function pushToCloud() {
  const mod = await getCloudModule();
  if (!mod) {
    setSyncStatus("Salvo só localmente (sem nuvem)");
    return;
  }
  setSyncStatus("Salvando na nuvem...");
  const ok = await mod.saveCloudState(state);
  setSyncStatus(ok ? "Sincronizado" : "Salvo só localmente (sem nuvem)");
}

// immediate=true pula o debounce — usado para ações únicas e sensíveis a tempo,
// como soltar um marcador no mapa, para o outro lado ver o movimento na hora.
function saveState(immediate) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  clearTimeout(cloudSyncTimer);
  if (immediate) {
    pushToCloud();
  } else {
    cloudSyncTimer = setTimeout(pushToCloud, 250);
  }
}

// Última posição/mapa ativo/visibilidade recebidos do documento "live" (pequeno,
// atualizado a cada arraste de marcador — veja mais abaixo). Guardamos aqui pra
// poder reaplicar por cima sempre que um snapshot do documento "main" (pesado,
// com NPCs/itens/texto) chegar, senão ele traria de volta posições desatualizadas.
let lastLiveSnapshot = null;

function anyModalOpen() {
  return !!document.querySelector(".modal-overlay:not(.hidden)");
}

async function bootstrapCloudSync() {
  setSyncStatus("Conectando à nuvem...");
  const mod = await getCloudModule();
  if (!mod) {
    setSyncStatus("Salvo só localmente (sem nuvem)");
    return;
  }
  const cloud = await mod.loadCloudState();
  if (cloud) {
    state = Object.assign(defaultState(), cloud);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderAll();
    setSyncStatus("Sincronizado");
  } else {
    setSyncStatus("Salvando na nuvem...");
    const ok = await mod.saveCloudState(state);
    setSyncStatus(ok ? "Sincronizado" : "Salvo só localmente (sem nuvem)");
  }

  // Assinatura contínua — assim, uma mudança feita no celular aparece sozinha no
  // computador (e vice-versa) sem precisar recarregar a página. Só não aplica
  // enquanto um modal estiver aberto, pra não perder uma edição em andamento.
  mod.subscribeToState(
    (cloud2) => {
      if (anyModalOpen()) return;
      state = Object.assign(defaultState(), cloud2);
      if (lastLiveSnapshot) {
        applyTokenPositions(lastLiveSnapshot.tokenPositions);
        state.activeMapId = lastLiveSnapshot.activeMapId ?? state.activeMapId;
        state.mapaVisivelJogadores = lastLiveSnapshot.mapaVisivelJogadores ?? state.mapaVisivelJogadores;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderAll();
      setSyncStatus("Sincronizado");
    },
    () => setSyncStatus("Conexão com a nuvem perdida — tentando de novo...")
  );

  mod.subscribeToLiveState((live) => {
    lastLiveSnapshot = live;
    applyTokenPositions(live.tokenPositions);
    state.activeMapId = live.activeMapId ?? state.activeMapId;
    state.mapaVisivelJogadores = live.mapaVisivelJogadores ?? state.mapaVisivelJogadores;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (document.getElementById("tab-mapa").classList.contains("active")) renderMap();
  });
}

// ==================== SEED DATA (Cervovale) ====================
function seedCampaignData() {
  if (state.seeded) return;
  state.seeded = true;

  state.objectives = [
    { id: uid(), texto: "Item ligado ao Rei dos Ratos — a Cauda do Rei Rato (Vale das Bagas)", feito: false },
    { id: uid(), texto: "Anel do Rei-Elfo (Baile Eterno, além do Lago da Saudade Eterna)", feito: false },
    { id: uid(), texto: "Relíquia da bruxa Dulcineia — o Pingente Rouba-Alma (Torre da Bruxa)", feito: false },
  ];

  state.notes = [
    {
      id: uid(),
      titulo: "Premissa da campanha",
      categoria: "lore",
      texto:
        "Vocês são Princesas num mundo de conto de fadas com um verniz mais sombrio do que o normal. Uma de vocês tem uma amiga mensageira que sumiu há quase um ano; preocupada, formou um grupo de busca com as outras.\n\n" +
        "O mundo: reinos próximos, vilas pequenas, florestas encantadas com reputações e perigos próprios. Magia existe e é aceita, mas ainda temida. \"Princesa\" é um título ligado a ter um Dom concedido por uma Fada Madrinha — não precisa ser realeza de sangue.",
    },
    {
      id: uid(),
      titulo: "Gancho inicial — O grito na floresta",
      categoria: "lore",
      texto:
        "No Bosque Emaranhado, a caminho de Cervovale, um cheiro doce se mistura ao da terra molhada e um grito de criança corta o silêncio. É Rui Silva, preso numa árvore, perseguido por um Ursinho de Goma.\n\n" +
        "Se salvarem Rui: ele guia o grupo até Cervovale e seu pai Geraldo (padeiro) fica aliviado.\n" +
        "Se ignorarem/perderem: o urso leva Rui embora; ele reaparece depois capturado pelo Cavaleiro de Chocolate Amargo. Isso muda a disponibilidade da Padaria (Geraldo fica preocupado demais para abrir).",
    },
    {
      id: uid(),
      titulo: "A Maldição de Dulcineia",
      categoria: "lore",
      texto:
        "Há um ano, moradores mataram a bruxa Dulcineia, que sequestrava crianças. Antes de morrer, ela amaldiçoou a vila: todos aos poucos viram doce.\n\n" +
        "A guarda Selene usou o Espelho Maléfico (escondido por Teodoro na Mansão da Prefeitura) para descobrir a cura — e morreu logo depois. A resposta: reunir 3 itens e jogá-los no poço da praça (ver aba Objetivos).\n\n" +
        "O Cavaleiro de Chocolate Amargo patrulha o Bosque Emaranhado e bloqueia quem tenta sair da vila.",
      },
    {
      id: uid(),
      titulo: "Cervovale — locais e NPCs-chave",
      categoria: "lore",
      texto:
        "Mansão da Prefeitura: Teodoro Éverson (prefeito) — guarda o Espelho Maléfico, escondido num baú sob a cama.\n" +
        "Salão Comunitário: Baz Hartly, líder da guarda.\n" +
        "Estalagem A Cabra Sorridente: Hannah Falcão (fofoqueira) e Connie Oriente (mensageira presa na vila).\n" +
        "Armazém: Zeca Grifo, lojista otimista.\n" +
        "Padaria: Geraldo Silva e o filho Rui.\n" +
        "Loja de Poções: Rosa Águas-Claras, irmã mais nova de Selene.\n" +
        "Ferraria: Maya Élis, esposa do desaparecido Élton — conhece lore de fadas.\n" +
        "Praça da Vila: o poço onde os 3 itens precisam ser jogados para quebrar a maldição.",
    },
    {
      id: uid(),
      titulo: "Bosque Emaranhado — pontos de interesse",
      categoria: "lore",
      texto:
        "Vale das Bagas: aldeia das fadas pequenas, protegida por névoa; aterrorizada pelo Rei Rato (objetivo 1).\n" +
        "Lago da Saudade Eterna: portal para o Baile Eterno — ativa entrando na água com um item de origem feérica.\n" +
        "Torre da Bruxa: isolada e protegida por magia; onde está o Pingente Rouba-Alma (objetivo 3).\n" +
        "Cova Misteriosa: onde o Espelho Maléfico pode ser recarregado se estiver quebrado.\n" +
        "O Cavaleiro de Chocolate Amargo patrulha a floresta; regenera 1 dia depois de derrotado, a menos que seja derretido/dissolvido.",
    },
    {
      id: uid(),
      titulo: "Vale das Bagas — o Rei Rato",
      categoria: "lore",
      texto:
        "Pólen amaldiçoado deixou o mel enfeitiçado; os ratos se uniram pelas caudas em mel pegajoso, formando o Rei Rato, que ocupa o depósito de comida das fadas pequenas.\n\n" +
        "Rainha Gardênia governa a aldeia e ensina como ativar o Lago da Saudade Eterna. Derrotar o Rei Rato e cortar sua cauda dá a Cauda do Rei Rato (objetivo 1).",
    },
    {
      id: uid(),
      titulo: "Baile Eterno — o Anel do Rei-Elfo",
      categoria: "lore",
      texto:
        "Festa sem fim no reino das fadas altas, dividida em 3 seções: Alvorada (Jardim), Meio-Dia (Banquete) e Crepúsculo (Salão de Baile, onde fica o Rei-Elfo).\n\n" +
        "O Rei-Elfo dá seu anel a quem completar seu desafio cronometrado: conseguir um Sorriso da Senhora Neves, um Segredo do Príncipe Aurélio e um Elogio da Duquesa Jacinda antes que a ampulheta se esgote.\n\n" +
        "Élton (marido de Maya) também está preso aqui, com Ilayda — devolvê-lo resolve a missão pessoal de Maya.",
    },
    {
      id: uid(),
      titulo: "Torre da Bruxa — confronto final",
      categoria: "lore",
      texto:
        "Três entradas: porta da frente (guardada por Construtos de Chocolate com Hortelã), janela do topo (pequena demais) ou dreno sob a torre (leva à cozinha).\n" +
        "Senha para entrar pela frente: \"Maçapão Maravilhoso\".\n\n" +
        "O Pingente Rouba-Alma está num corpo-construto no Quarto da Bruxa. Ao removê-lo, a alma de Dulcineia escapa:\n" +
        "— Se o Ovo de Dragão do Viveiro foi destruído ela vira uma Aparição.\n" +
        "— Se não foi destruído ela possui o dragão e ataca Cervovale em ~1 hora.\n\n" +
        "Quebrar a maldição: jogar os 3 itens (Cauda do Rei Rato, Anel do Rei-Elfo, Pingente Rouba-Alma) no poço da praça, DEPOIS de derrotar Dulcineia. Se algum item for destruído na luta, a maldição fica inquebrável.",
    },
  ];

  const npc = (nome, tipo, determinacao, graca, astucia, coracao, salvamento, armadura, tags, notas) => ({
    id: uid(),
    nome,
    tipo,
    determinacao,
    graca,
    astucia,
    coracao,
    salvamento,
    armadura,
    tags,
    notas,
  });

  state.npcs = [
    npc("Teodoro Éverson", "NPC", 10, 8, 12, 10, 12, 0, ["cervovale", "prefeito", "mansão"],
      "Prefeito de Cervovale, transformando-se em algodão-doce. Esconde o Espelho Maléfico (rachado) num baú com fundo falso sob a cama. Missão: ajudar a levantar o moral da vila Chave de prata da cidade."),
    npc("Baltasar \"Baz\" Hartly", "NPC", 14, 10, 10, 12, 12, 1, ["cervovale", "guarda", "salão comunitário"],
      "Líder de fato da guarda, virando bala azeda de limão. Sabe sobre fadas na névoa e já lutou contra o Cavaleiro de Chocolate Amargo. Missão: controle de pragas -> Hortelãnça (d8, 2d8 em carga)."),
    npc("Hannah Falcão", "NPC", 8, 12, 10, 8, 10, 0, ["cervovale", "estalagem"],
      "Dona d'A Cabra Sorridente, cheira a canela. Sabe que Élton sonhava com música vinda da floresta antes de sumir."),
    npc("Constança \"Connie\" Oriente", "NPC", 10, 14, 11, 9, 12, 0, ["cervovale", "estalagem", "mensageira"],
      "Mensageira presa na vila, pele virando hortelã listrada. Já enfrentou o Cavaleiro de Chocolate Amargo tentando fugir; tem canivete de prata."),
    npc("Ezequiel \"Zeca\" Grifo", "NPC", 9, 9, 13, 9, 11, 0, ["cervovale", "armazém", "lojista"],
      "Lojista otimista, troca itens comuns 1-por-1. Missão: consertar objetos quebrados -> Luneta Feérica (revela magia, itens escondidos, forma verdadeira de Selene)."),
    npc("Geraldo Silva", "NPC", 11, 8, 9, 11, 11, 1, ["cervovale", "padaria"],
      "Padeiro virando biscoito de gengibre, pai de Rui. Esteve no ataque original a Dulcineia. Missões: óculos perdidos (esquilo levou) -> biscoitos com efeito Restauração; achar Biscoitinha, a cadela."),
    npc("Rui Silva", "NPC", 9, 11, 10, 7, 12, 0, ["cervovale", "padaria", "criança"],
      "Filho de Geraldo, resgatado no gancho inicial (ou capturado pelo Cavaleiro, se falharem). Único sequestrado ainda não transformado em doce; lembra da cantiga da bruxa."),
    npc("Rosana \"Rosa\" Águas-Claras", "NPC", 9, 10, 13, 8, 11, 0, ["cervovale", "poções", "irmã de selene"],
      "Irmã mais nova de Selene, vira bolinho aos poucos, administra a loja de poções sozinha. Missão: testar vacina contra a Maldição Doce (50% de sucesso) -> Poção Encolhedora + 2 poções."),
    npc("Maya Élis", "NPC", 13, 9, 12, 11, 12, 1, ["cervovale", "ferraria", "lore de fadas"],
      "Ferreira, esposa do desaparecido Élton. Grande conhecedora de fadas; dá retalhos de ferro contra fadas. Missão: encontrar Élton no Baile Eterno -> espada Estalar de Segundos (d8, ataca 2x)."),
    npc("Ashkan", "NPC", 12, 11, 15, 12, 14, 0, ["bosque emaranhado", "fada alta", "círculo de cogumelos"],
      "Fada alta presa numa pedra por Finnegan, no Círculo de Cogumelos. Se libertado (resposta do enigma: \"laranja\"), ensina a ativar o Lago da Saudade Eterna e menciona a Senhora Neves."),
    npc("Castanho", "NPC", 13, 11, 10, 10, 14, 1, ["vale das bagas", "guarda espinheiro"],
      "Líder da Guarda Espinheiro, desconfiado de humanos. Missão: achar seu vaga-lume de estimação (preso no Depósito, sala 3, no Limo Vermelho Tóxico) -> Arco Ferrão."),
    npc("Rainha Gardênia", "NPC", 15, 13, 14, 14, 16, 1, ["vale das bagas", "realeza fada"],
      "Monarca das fadas pequenas, enganada por Dulcineia no passado. Sabe ativar o Lago da Saudade Eterna. Devolver a Colher de Mel a deixa em dívida com o grupo."),
    npc("O Rei-Elfo", "Monstro", 18, 16, 20, 15, 15, 0, ["baile eterno", "chefe", "fada alta"],
      "Anfitrião do Baile Eterno, quase onipotente em seu domínio. Se reduzido a 0 Coração, reaparece curado. 4 Dados de Dom — pode lançar qualquer magia. Dá seu anel a quem completar seu desafio."),
    npc("Selene (Lobo Mau)", "Monstro", 12, 10, 9, 8, 12, 3, ["bosque emaranhado", "lobisomem"],
      "Ataca duas vezes: Garras (d4) e Mordida (d6). Armas prateadas/encantadas ignoram Armadura. Se Ferida, teste Determinação ou vire lobisomem. Derrotada, volta à forma humana e dá sua Corda de Escalada."),
    npc("O Cavaleiro de Chocolate Amargo", "Monstro", 14, 8, 8, 12, 13, 3, ["bosque emaranhado", "chefe", "regenera"],
      "Ataca 2x com Espada (d8) ou 1x com Lança (d8, 2d8 em carga montada). Ferida por ele -> Maldição Doce (avança 1 estágio se já afligido). Suscetível a derretimento. Regenera após 1 dia, a menos que derretido/dissolvido."),
    npc("Cavalo de Guerra de Chocolate", "Monstro", 10, 8, 6, 6, 6, 0, ["bosque emaranhado", "montaria"],
      "Coice (d6). Montaria leal do Cavaleiro de Chocolate Amargo. Suscetível a derretimento."),
    npc("Ursinho de Goma", "Monstro", 8, 6, 6, 8, 10, 1, ["bosque emaranhado", "gancho inicial"],
      "Ataca 2x: Mordida (d6) e Garras (d4). Suscetível a derretimento (ataques de calor/água ignoram Armadura). Fere com a Maldição Doce."),
    npc("Ratel", "Monstro", 10, 8, 6, 4, 6, 1, ["bosque emaranhado"],
      "Ataca 1-2x: Mordida (d6) ou Garra (d4). Entra em frenesi (desvantagem para evitar seus ataques) se perder qualquer Coração. Fere com Maldição Doce."),
    npc("Gosma de Melaço", "Monstro", 6, 4, 4, 10, 6, 0, ["bosque emaranhado"],
      "Engolfar (d6/turno automático a quem estiver envolvido). 50% de chance de desarmar em ataque contundente. Derreta com fogo ou congele para quebrar. Fere com Maldição Doce."),
    npc("Fada Pequena", "Monstro", 8, 16, 14, 1, 18, 0, ["bosque emaranhado", "fada pequena"],
      "Desarmada (1). Ataques físicos contra ela têm desvantagem. Pode lançar Puf! à vontade; 1 Dado de Dom — Jato de Purpurina."),
    npc("Fada Pequena (Vale das Bagas)", "NPC", 10, 16, 12, 4, 18, 0, ["vale das bagas", "fada pequena"],
      "Nesta escala, do tamanho de um humano da mesma idade. Membros da Guarda Espinheiro podem ter armas/armadura. Pode lançar Puf! à vontade; 1 Dado de Dom — Jato de Purpurina."),
    npc("Enxame de Abelhas", "Monstro", 8, 6, 4, 10, 6, 0, ["vale das bagas"],
      "Ferrão (d8 com saúde cheia, d6 com metade). Cada ferroada mata 1 abelha do enxame (-1 Coração). Alvo ferroado testa Determinação ou fica Atordoado. Fere com Maldição Doce."),
    npc("Serpente Mortal Enorme", "Monstro", 8, 12, 6, 10, 8, 0, ["vale das bagas"],
      "Mordida venenosa (d12), ainda mais perigosa em escala reduzida. Fere com a Maldição do Veneno."),
    npc("Limo Vermelho Tóxico", "Monstro", 4, 4, 2, 6, 6, 0, ["vale das bagas", "depósito"],
      "Toque Corrosivo (d6), corrói madeira/metal. Cortar com lâmina divide em duas gosmas com metade dos Corações. Derreta com fogo ou congele para quebrar. Guarda o vaga-lume de Castanho."),
    npc("Gosma de Açúcar", "Monstro", 4, 4, 2, 10, 4, 0, ["torre da bruxa", "dreno"],
      "Toque Corrosivo (d6). Cortar com lâmina divide em duas com metade dos Corações. Derreta com fogo ou congele para quebrar. Tem a chave dourada do baú de Dulcineia dentro dela. Fere com Maldição Doce."),
    npc("Construto de Chocolate com Hortelã", "Monstro", 10, 6, 6, 8, 10, 3, ["torre da bruxa", "guarda da porta"],
      "Ataca 2x com Lança (d8). Suscetível a derretimento (calor/água ignora Armadura). Guarda a porta da frente da Torre — senha \"Maçapão Maravilhoso\". Fere com Maldição Doce."),
    npc("Fantasma (familiar de Dulcineia)", "NPC", 6, 10, 12, 2, 8, 0, ["torre da bruxa", "familiar"],
      "Corvo de chocolate branco. Bicar (d4). Não pode ser morto permanentemente — reaparece no Viveiro. Pode ser persuadido/subornado a mudar de lado e revelar caminhos seguros."),
    npc("Alistair", "NPC", 6, 8, 12, 3, 10, 0, ["torre da bruxa", "jardim mágico"],
      "Espírito trapaceiro preso num coelho de chocolate branco. Desarmado (1). Suscetível a derretimento. 2 Dados de Dom — Mão Amiga, Animar, Aceleração. Joga a Roleta do Chá; sabe da Sala de Experimentos e da Adaga Ruína dos Dragões."),
    npc("Dulcineia (Aparição)", "Monstro", 16, 12, 18, 16, 14, 2, ["torre da bruxa", "chefe final"],
      "Toque Gélido (d8). Armas prateadas/encantadas ignoram Armadura. 4 Dados de Dom — Animar, Puf!, É Meu!, Medo, Drenar, Afligir. Fere com Maldição Doce (2º estágio, ou avança 1 se já afligido)."),
    npc("Dulcineia (Dragão de Canela)", "Monstro", 18, 10, 16, 25, 16, 3, ["torre da bruxa", "chefe final", "confronto final"],
      "Ataca 3x: Mordida (d12) + 2 Garras (d8). Rajada de fogo de canela: 20 de dano em área (10 com Graça bem-sucedida), recarrega ao Descansar. 3 Dados de Dom — Névoa, Emaranhado, Bola de Fogo. Ataques de água ignoram Armadura."),
    npc("Rato Louco Amaldiçoado", "Monstro", 6, 6, 4, 4, 8, 0, ["vale das bagas", "ninho do rei rato", "enxame"],
      "Mordida (d4). O Rei Rato é uma amálgama de 7 destes, com as caudas emaranhadas e fundidas. Atacando: d6 ratos conseguem atacar por rodada (role um número maior que a quantidade de ratos restantes = todos os que podem atacam). Cortando a cauda: após 3 ratos derrotados, pode tentar cortar a cauda direto, com desvantagem (a menos que os restantes estejam distraídos/incapacitados). Fere com Maldição Doce."),
  ];
}

// Segunda leva de conteúdo de referência (livro básico) — some sob uma flag própria
// para não duplicar nem apagar dados de quem já usou uma versão anterior do site.
function seedRulesReference() {
  if (state.seededV2) return;
  state.seededV2 = true;

  const extraNotes = [
    {
      titulo: "Regras rápidas — Testes & dados",
      categoria: "regras",
      texto:
        "TESTE DE VIRTUDE: role 1d20 — tirar igual ou menos que o atributo (Determinação/Graça/Astúcia) é sucesso. 1 é sempre sucesso; 20 é sempre falha.\n" +
        "Vantagem: role 2d20, use o menor. Desvantagem: role 2d20, use o maior.\n\n" +
        "DADOS DE DOM (DD): 1d6 por nível, gastos para usar habilidades de Dom/magia. Ao rolar, escolha quantos DD usar. Resultado 1-3: o dado volta. Resultado 4-6: é gasto até Descansar. Tirar duplas = sofre um Acidente (efeito colateral do Dom).\n" +
        "DADOS CORAÇÃO (DC): 1d4 por nível. Gaste durante um Piquenique para recuperar PC (Coração), ou gaste para somar ao teste falho de uma amiga (+ o valor rolado).\n\n" +
        "[DADOS] = quantos DD você rolou. [SOMA] = o total desses DD. Alcance por [DADOS]: 1 = Por Perto, 2 = A Uma Pedrada, 3+ = Lá Longe.",
    },
    {
      titulo: "Regras rápidas — Combate",
      categoria: "regras",
      texto:
        "INICIATIVA: teste ASTÚCIA. Sucesso = age antes do inimigo; falha = age depois. Mantém a mesma ordem toda rodada. Tirar 1 é crítico: pode agir duas vezes no primeiro turno.\n\n" +
        "NO SEU TURNO: mover-se Por Perto + uma Ação. Pode Reagir 1x por rodada no turno de qualquer pessoa (ex: usar Dom, gastar Dado Coração).\n\n" +
        "ATACANDO: teste Determinação (corpo a corpo) ou Graça (à distância). Sucesso role o dano. Tirar 1 é crítico: role 2 dados de dano e some.\n" +
        "DEFENDENDO: teste Graça para evitar o ataque; subtraia a Armadura do dano recebido. O inimigo tirar 20 é crítico: ignora sua Armadura.\n" +
        "MANOBRAS (agarrar, derrubar, empurrar etc.): Teste de Virtude de Determinação, Graça ou Astúcia, conforme a manobra.\n\n" +
        "FERIMENTOS: chegar a 0 Coração = não pode Agir/Mover-se até ser estabilizada. Role d8 na Tabela de Ferimentos (efeitos de curto/médio prazo, algumas permanentes). Dano maior que o dobro do Coração máximo = 1 ponto de Trauma imediato.",
    },
    {
      titulo: "Regras rápidas — Recuperação, Aflições & Trauma",
      categoria: "regras",
      texto:
        "PIQUENIQUE: pequena pausa (Gastar Tempo + 1 refeição). Gaste Dados Coração à vontade, role e recupere PC igual à soma.\n" +
        "DESCANSO: 1x a cada 24h. 8h de sono com comida, água e abrigo/fogueira restaura todo o Coração e todos os Dados de Dom/Coração gastos. Consome 1 refeição.\n\n" +
        "AFLIÇÕES (dão Desvantagem numa Virtude específica):\n" +
        "• Cansada Desvantagem em Determinação\n" +
        "• Atordoada Desvantagem em Graça\n" +
        "• Confusa Desvantagem em Astúcia\n" +
        "Um Descanso ou Piquenique geralmente encerra uma Aflição, salvo indicação contrária.\n\n" +
        "TRAUMA (ao acumular, role/consulte a Mestra): 1) não pode usar DD por 24h; 2) idem + fica apavorada pela causa até superar o medo; 3) fim de jogo para a personagem (aposentadoria, sono mágico, captura, morte trágica — decidido à mesa).\n\n" +
        "SOBRECARGA: carrega até seu valor de Determinação sem penalidade; fica Cansada acima disso; não pode carregar mais que o dobro da Determinação. Itens Volumosos contam como 2 espaços; consumíveis (flechas, comida, tochas) se amontoam num único espaço.",
    },
    {
      titulo: "Maldições (tabela oficial, d12)",
      categoria: "regras",
      texto:
        "1. Condenação — Ferida automaticamente dá 1 Trauma; cura enfrentando a Morte num jogo de sorte/habilidade.\n" +
        "2. Melancolia — não pode usar/se beneficiar de Dados Coração nem efeitos de moral; cura ajudando um grupo de crianças.\n" +
        "3. Veneno — desvantagem em todos os Testes de Virtude; passa em 3 dias (+1 Trauma) ou com antídoto/ervas.\n" +
        "4. Boca Pútrida — tudo tem gosto horrível; teste Determinação para comer sem vomitar; cura jejuando 3 dias.\n" +
        "5. Enraizado — vira planta aos poucos, pode ficar presa ao chão; cura passando um dia na escuridão total.\n" +
        "6. Verdade Imposta — mentir causa d4 de dano e incha uma parte do corpo; cura contando um segredo a uma bruxa.\n" +
        "7. Mão de Alface — desvantagem para seguer objetos; cura mergulhando as mãos em algo pegajoso por um dia.\n" +
        "8. Soluços — não pode ser furtiva; desvantagem em testes com a voz; cura encontrando algo verdadeiramente aterrorizante.\n" +
        "9. Popularidade — cercada de fãs, difícil resolver negócios; cura espalhando um boato depreciativo sobre si.\n" +
        "10. Ronco — amigas dormindo por perto precisam testar Determinação para Descansar direito; cura comendo uma raiz-forte e ficando em silêncio um dia.\n" +
        "11. Paranoia — nunca é pega de surpresa/age primeiro em combate; precisa testar Astúcia para dormir; cura com um amuleto de cristal no bolso esquerdo.\n" +
        "12. Paladar Infantil — deseja doces constantemente, precisa de açúcar para se beneficiar de Piquenique/Descanso; cura caçando um animal e comendo seu fígado.\n\n" +
        "A Maldição Doce de Dulcineia (Doce Vingança) é uma maldição especial em estágios, específica da campanha — avança conforme o alvo é ferido por criaturas amaldiçoadas ou falha em testes ligados a ela.",
    },
    {
      titulo: "Os 8 Dons das Fadas Madrinhas",
      categoria: "regras",
      texto:
        "1. Coração Selvagem — chama criaturas da floresta. Talentos: Caça, Pesca, Orientação.\n" +
        "2. Voz Encantadora — arrebata quem a ouve. Talentos: Música, Atuação, Poesia.\n" +
        "3. Agilidade Feérica — ligeira, acrobática, discreta. Talentos: Atlética, Dançarina, Equitação.\n" +
        "4. Conexão Elemental — um elemento (Fogo, Terra, Ar, Água ou outro) é seu aliado. Talentos: Alquimia, Astronomia.\n" +
        "5. Magia da Cozinha — flora mágica e guloseimas que são mais do que parecem. Talentos: Cozinhar, Assar, Coletar Alimentos.\n" +
        "6. Toque Curativo — restaura com as mãos, cabelos e lágrimas; nunca adoece. Talentos: Cura, Costura, Herbologia.\n" +
        "7. Amizade Poderosa — vínculo com um companheiro animal devotado.\n" +
        "8. Intelecto Sábio — fonte de conhecimento histórico e folclore. Talentos: Caligrafia, Linguística, História, Folclore.\n\n" +
        "Cada Dom cresce em poder por nível (novas Habilidades Especiais, mais Dados de Dom). Veja a aba Personagens para cadastrar o Dom de cada Princesa.",
    },
    {
      titulo: "Doce Vingança — ganchos & informações da aventura",
      categoria: "lore",
      texto:
        "Aventura para 2 a 4 Princesas, do nível 1 ao 4. Combina exploração de masmorra, encontros sociais e resolução de problemas — a ordem fica a critério do grupo.\n\n" +
        "Ganchos alternativos (escolha um ou crie o seu):\n" +
        "• O grito na floresta (o que já está na aba Notas): uma Princesa tem uma amiga mensageira desaparecida.\n" +
        "• Doces Sonhos: a Fada Madrinha de uma Princesa nunca deixa de indicar boas ações através de sonhos enigmáticos. O sonho mais recente trazia cheiro de pão de mel e a voz sussurrando: \"Nada, minha querida, é tão doce quanto ajudar quem precisa.\"\n\n" +
        "Sempre descreva a premissa às jogadoras antes de começar, para que possam criar Princesas que se encaixem na história.",
    },
    {
      titulo: "Ferramentas de segurança à mesa",
      categoria: "regras",
      texto:
        "Doce Vingança toca em temas de horror corporal, sequestro, violência fantasiosa e situações assustadoras, mesmo num cenário de conto de fadas. Ferramentas recomendadas:\n\n" +
        "LINHAS E VÉUS: Linhas são coisas que não devem aparecer no jogo de forma alguma. Véus são coisas que podem acontecer, mas fora de cena, sem serem interpretadas em detalhe.\n\n" +
        "CARTA-X: um marcador (ex: cartão com um X) que qualquer pessoa pode usar para pedir que o jogo pare, por qualquer motivo, sem precisar explicar.\n\n" +
        "POLÍTICA DE PORTAS ABERTAS: deixe claro que qualquer pessoa pode sair da mesa a qualquer momento, por qualquer razão — o jogo nunca é mais importante que o bem-estar de alguém.",
    },
  ];

  const existingTitles = new Set(state.notes.map((n) => n.titulo));
  extraNotes.forEach((n) => {
    if (!existingTitles.has(n.titulo)) {
      state.notes.push({ id: uid(), titulo: n.titulo, texto: n.texto, categoria: n.categoria || "lore" });
    }
  });

  if (!state.npcs.some((n) => n.nome === "Rato Louco Amaldiçoado")) {
    state.npcs.push({
      id: uid(),
      nome: "Rato Louco Amaldiçoado",
      tipo: "Monstro",
      determinacao: 6,
      graca: 6,
      astucia: 4,
      coracao: 4,
      salvamento: 8,
      armadura: 0,
      tags: ["vale das bagas", "ninho do rei rato", "enxame"],
      notas:
        "Mordida (d4). O Rei Rato é uma amálgama de 7 destes, com as caudas emaranhadas e fundidas. Atacando: d6 ratos conseguem atacar por rodada. Cortando a cauda: após 3 ratos derrotados, pode tentar cortar a cauda direto, com desvantagem. Fere com Maldição Doce.",
    });
  }
}

function seedItems() {
  if (state.seededItems) return;
  state.seededItems = true;

  const item = (nome, custo, origem, descricao, tags) => ({
    id: uid(), nome, custo, origem, descricao, tags,
  });

  state.items = [
    item("Hortelãnça", "(2), d8 de dano (2d8 em carga de cavalo)", "Recompensa de Baz — controle de pragas",
      "Arma de haste saqueada de um construto de doce. Tem cheirinho de hortelã.", ["cervovale", "arma"]),
    item("Luneta Feérica", "(1)", "Recompensa de Zeca — consertar objetos quebrados",
      "Parece quebrada, mas concede visão mágica: revela contornos brilhantes ao redor de itens mágicos (mesmo escondidos), permite enxergar através da névoa das fadas e revela a verdadeira forma de Selene (o lobisomem).", ["cervovale", "utilidade", "detecção"]),
    item("Pacote de Biscoitos", "(1 lote, 1 por Princesa + 1 extra)", "Recompensa de Geraldo — óculos perdidos",
      "Efeito do feitiço Restauração.", ["cervovale", "cura"]),
    item("Poção Encolhedora + 2 poções à escolha", "—", "Recompensa de Rosa — voluntariar-se para testar a vacina",
      "A única Poção Encolhedora que Rosa tem; ela não sabe preparar outra.", ["cervovale", "poção"]),
    item("Estalar de Segundos", "d8 de dano", "Recompensa de Maya — devolver Élton",
      "Espada em forma de ponteiro de relógio. Ataca duas vezes com uma única Ação.", ["cervovale", "arma", "baile eterno"]),
    item("Chave de Prata da Cidade", "vale 15 pp", "Recompensa de Teodoro — levantar o moral da vila",
      "Não abre nada, mas tem grande valor sentimental — pode ressoar magicamente se invocada com inteligência (a critério da Mestra).", ["cervovale"]),
    item("Corda de Escalada Encantada", "—", "Pertence a Selene; dada ao derrotá-la/curá-la",
      "Corda animada que obedece comandos: amarra e desamarra sozinha, se prende firmemente a construções etc.", ["bosque emaranhado"]),
    item("Pão de Viagem", "1 pp cada, compra na Padaria", "Padaria de Geraldo",
      "Pão reforçado cheio de sementes, com cheiro de abóbora e xarope de ácer. Vale como uma ração diária.", ["cervovale", "consumível"]),
    item("Arco Ferrão", "(1), d6 de dano, 6 Flechas Ferrão (uso único)", "Recompensa de Castanho — achar o vaga-lume",
      "Flechas disparadas são críticas em 1 ou 2. Quem for atingido testa Determinação ou fica incapaz de agir por 1 rodada.", ["vale das bagas", "arma"]),
    item("Bolos de Mel", "1 lote com 6 unidades", "Recompensa do Fazendeiro Listra-d'Olmo — curar a asa",
      "Feitos com mel não amaldiçoado. Concedem vantagem em Testes de Virtude para persuadir, até Gastar Tempo.", ["vale das bagas", "consumível"]),
    item("Prendedor Borboleta", "(1 DD)", "Recompensa da Rainha Gardênia — derrotar o Rei Rato",
      "Preso no cabelo, faz brotar asas temporárias de fada pequena — voa como o feitiço Flutuar. Recarrega ao pregar uma peça/brincadeira enquanto o usa.", ["vale das bagas", "voo"]),
    item("Varinha de Colher de Mel", "(2 DD)", "Vale das Bagas",
      "Lança Hipnotizar, É Meu! e Enredar. Recarrega sendo tratada com Geleia Real de uma abelha rainha.", ["vale das bagas", "varinha"]),
    item("Escudo Hélice", "(2)", "Depósito de Armas — Ninho do Rei Rato (Sala 4)",
      "Vantagem em Salvamentos contra magia. Desativa quaisquer outros itens mágicos que você carregue e anula magias benéficas recebidas depois de equipado.", ["vale das bagas", "escudo"]),
    item("Corvo Mensageiro", "—", "Reconciliar Cirilla e Cirillo (Baile Eterno)",
      "Estátua de latão de um corvo. Sussurre uma mensagem e ele voa para entregá-la a quem você desejar.", ["baile eterno", "utilidade"]),
    item("Harpa Cantacora", "(2)", "Arturo, o Trovador — dar-lhe uma boa história",
      "1x/dia, quem a ouve testa Astúcia ou revela o que está no coração através de uma canção. Só usável por quem tem talento musical.", ["baile eterno"]),
    item("Brincalhetes Sussurrantes", "—", "Duquesa Jacinda — impressioná-la",
      "Ao esfregar a cabeça do lagarto, sussurra uma fraqueza/segredo de alguém visível à sua escolha. Recarrega contando um segredo depreciativo sobre si mesma.", ["baile eterno"]),
    item("Varinha do Capricho", "(1 DD)", "Finnegan — se for capturado",
      "Lança Jato de Purpurina, Puf!, Encolher e Virar Sapo. Recarrega Gastando Tempo numa festa animada.", ["baile eterno", "varinha"]),
    item("O Anel do Rei-Elfo", "—", "Completar o Desafio do Rei-Elfo (Salão de Baile)",
      "Enquanto usado/carregado, sua aura fica majestosa; fadas tendem a tratá-la com mais respeito. Objetivo principal da campanha.", ["baile eterno", "objetivo principal"]),
    item("Adaga Ruína dos Dragões", "d6 de dano, (3 DD)", "Baú no Quarto da Bruxa (Torre, Sala 9)",
      "Ignora a Armadura de dragões e é capaz de ferir o ovo de dragão do Viveiro. Ao causar dano contra um dragão, pode gastar seus DD para somar ao dano. Recarrega matando um dragão.", ["torre da bruxa", "arma"]),
    item("Chave Dourada", "—", "Dentro da Gosma de Açúcar (Torre, Sala 1 — Dreno)",
      "Abre o baú trancado no Quarto da Bruxa (Sala 9).", ["torre da bruxa", "chave"]),
    item("O Grimório Proibido", "—", "Sala de Experimentos de Dulcineia (Torre, Sala 6)",
      "Ao se aprofundar nele (rolando na Tabela de Ferimentos como custo), ensina as magias Medo, Drenar e Afligir.", ["torre da bruxa", "magia"]),
    item("O Chapéu da Bruxa", "concede 1 DD", "Escritório de Dulcineia (Torre, Sala 5)",
      "Concede 1 Dado de Dom extra, mas o usuário passa a falar com um eco mágico dramático.", ["torre da bruxa"]),
    item("Pingente Rouba-Alma", "—", "Construto no Quarto da Bruxa (Torre, Sala 9)",
      "Ao ser tocado pela primeira vez, dá uma sensação de equilíbrio emocional e um flashback vívido — próximo teste com vantagem. Objetivo principal (relíquia da bruxa). Removê-lo do receptáculo libera a alma de Dulcineia.", ["torre da bruxa", "objetivo principal"]),
    item("Maçã Envenenada", "—", "Itens maravilhosos (livro básico)",
      "Se comida, causa um efeito perigoso — detalhes a critério da Mestra conforme o livro básico.", ["item maravilhoso"]),
    item("Martelo de Brigite", "d10 de dano, (1 DD)", "Livro básico — itens mágicos",
      "Gaste o Dado de Dom para fabricar instantaneamente um item a partir de matérias-primas (ponte, roupas, vinho...), num cubo de [SOMA]+1,5m de lado. Não cria criaturas vivas nem itens mágicos. Recarrega presenteando algo de valor pessoal a uma desconhecida.", ["item mágico", "criação"]),
    item("Adaga de Prata", "d6 de dano", "Livro básico — itens mágicos",
      "Pequena adaga revestida de prata. Funciona contra lobisomens, fantasmas, aparições e outros monstros resistentes a armas normais.", ["item mágico", "arma"]),
    item("Arco da Vingança", "d6 de dano", "Livro básico — itens mágicos",
      "Gaste Tempo fazendo um juramento de vingança contra um inimigo: vantagem em tiros contra ele, e acertos são sempre críticos. Contra qualquer outro alvo, os tiros são feitos com desvantagem e nunca são críticos. Pode jurar de novo após derrotar o alvo.", ["item mágico", "arma"]),
    item("Espelho Amaldiçoado (Espelho Maléfico)", "—", "Mansão da Prefeitura (Teodoro)",
      "Responde com sinceridade a uma pergunta, mas amaldiçoa quem perguntou (quanto maior a questão, mais severa a maldição). Depois de responder, quebra e só volta a funcionar se for recarregado. Recarrega: enterrar por uma noite na Cova Misteriosa do Bosque Emaranhado.", ["cervovale", "objetivo", "maldição"]),
  ];
}

function seedFullAdventureText() {
  if (state.seededFullText) return;
  state.seededFullText = true;

  const fullNotes = [
    {
      titulo: "AVENTURA COMPLETA 1/7 — Visão geral, gancho e Cervovale",
      categoria: "aventura",
      texto:
"1. VISÃO GERAL DA CAMPANHA\n" +
"Premissa: Vocês são Princesas vivendo num mundo de conto de fadas com um verniz mais sombrio do que os contos de fadas costumam ter. Uma de vocês tem uma amiga mensageira, uma das poucas pessoas que viaja com frequência entre as vilas levando encomendas. Faz quase um ano que ninguém tem notícia dela. Preocupada, essa Princesa contratou (ou convenceu) as outras a formarem um grupo de busca.\n\n" +
"O mundo: reinos próximos, vilas pequenas. Florestas encantadas são comuns, e cada uma tem sua própria reputação e perigos. Magia existe e é aceita como parte natural do mundo (fadas, feitiços, maldições), mas ainda assim é temida e respeitada. Princesas não são necessariamente realeza no sentido literal — é mais um \"título\" ligado a ter um Dom mágico concedido por uma Fada Madrinha, então cada Princesa pode vir de origem bem diferente.\n\n" +
"2. GANCHO INICIAL — O GRITO NA FLORESTA\n" +
"Faz dias que vocês seguem a trilha que leva a Cervovale, cortando o Bosque Emaranhado. As árvores aqui crescem tortas demais pra parecer natural, e a luz do sol mal atravessa a copa fechada. Vocês já ouviram histórias sobre esse lugar — de que coisas entram e não saem, ou saem diferentes do que eram. Até agora, a viagem tem sido tranquila. Estranhamente tranquila.\n\n" +
"Depois de alguns minutos de viagem, o ar começa a cheirar estranhamente a doce, e um grito de criança corta o silêncio, vindo de fora da trilha.\n\n" +
"Leitura em voz alta: \"Um cheiro doce e artificial começa a se misturar com o cheiro de terra molhada da floresta — quase enjoativo. E então, um grito. Uma voz de criança, gritando por socorro, em algum lugar fora da trilha.\"\n\n" +
"Se investigarem: encontram Rui Silva, um garoto ruivo, preso no alto de uma árvore, sendo perseguido por um urso em transformação — meio urso-pardo, meio criatura de doce, com gomas de bala brotando dos ombros como feridas.\n\n" +
"Combate: Ursinho de Goma — PV 8, Salvamento 10, Armadura 1. Ataca duas vezes: Mordida (d6) e Garras (d4). Suscetível a derretimento (ataques de calor/água ignoram Armadura). Quem for ferido por ele contrai a Maldição Doce (vira doce aos poucos).\n\n" +
"Se vencerem ou afugentarem o urso: Rui desce da árvore, agradecido e falante, e guia o grupo até Cervovale, respondendo qualquer pergunta simples no caminho (nome, onde mora, etc. — ele não sabe muito sobre a bruxa ainda).\n\n" +
"Se ignorarem os gritos ou perderem a luta: o urso foge levando Rui — ele reaparece mais tarde na história, capturado por um vilão maior (o Cavaleiro de Chocolate Amargo). Não é o fim do mundo se isso acontecer; só muda o gancho local.\n\n" +
"Nota de continuidade: o desfecho desta cena afeta a cena de chegada em Cervovale e a disponibilidade inicial de Geraldo na Padaria.\n\n" +
"3. CHEGADA A CERVOVALE\n" +
"A trilha se abre numa clareira, e vocês avistam Cervovale pela primeira vez: casas de telhado inclinado, uma pracinha com um poço de pedra no centro, fumaça subindo de algumas chaminés. Só que, ao se aproximar, algo está errado. As pessoas na rua... não são inteiramente pessoas. Uma tem a pele craquelada como caramelo. Outra caminha com as pernas grudentas, deixando um rastro pegajoso no chão. O ar inteiro cheira a confeitaria.\n\n" +
"Se Rui está com o grupo: o pai dele (Geraldo Silva, o padeiro, virando biscoito de gengibre) corre até o filho, aliviadíssimo.\n\n" +
"O Prefeito Teodoro Éverson se aproxima e pede pra conversar com o grupo — leva vocês até a Mansão da Prefeitura (ou conversa ali mesmo, se preferir cortar caminho).\n\n" +
"4. A SITUAÇÃO CENTRAL: A MALDIÇÃO DE DULCINEIA\n" +
"Isso é o que Teodoro explica ao grupo: há um ano, moradores enfrentaram e mataram uma bruxa que sequestrava crianças da vila. Antes de morrer, ela lançou uma maldição sobre todo mundo: aos poucos, cada morador está virando doce. Uma guarda chamada Selene usou um espelho amaldiçoado pra descobrir como quebrar a maldição — e morreu logo depois de obter a resposta.\n\n" +
"O espelho revelou (em forma de enigma) que é preciso reunir três itens específicos e jogá-los no poço da vila pra desfazer o feitiço: algo ligado a um Rei dos Ratos; um anel de um Rei-Elfo; uma relíquia da própria bruxa.\n\n" +
"Tentativas de deixar a vila são bloqueadas por um cavaleiro amaldiçoado (o Cavaleiro de Chocolate Amargo) que patrulha a floresta.\n\n" +
"Teodoro pede ajuda, oferece hospedagem gratuita na estalagem, e uma recompensa à escolha (dinheiro, uma casa, uma apresentação a um monarca, ou um item misterioso).\n\n" +
"Os três objetivos principais da campanha (não linear — podem ser buscados em qualquer ordem): item ligado ao Rei dos Ratos; anel do Rei-Elfo; relíquia da bruxa Dulcineia.\n\n" +
"5. LOCAIS DE CERVOVALE\n\n" +
"5.1 Mansão da Prefeitura — colina nos arredores, com vista para a aldeia.\n" +
"NPC: Teodoro Éverson (62) — Preocupado, atarefado, cauteloso. Homem alto, espichado pelas exigências de governar uma vila que vira doce. Cabelos e barba viraram algodão-doce. Sente-se responsável por ter deixado Selene usar o Espelho Maléfico.\n" +
"Missão — Levantar o Moral da Vila: se ajudarem a pensar numa boa ideia para levantar o moral, ele dá uma chave de prata da cidade (15 pp, valor sentimental que pode ressoar magicamente).\n" +
"Segredo: ainda tem o Espelho Maléfico, escondido num baú de fundo falso sob a cama. Está rachado e inutilizável até ser recarregado.\n\n" +
"5.2 Salão Comunitário — abriga quase toda a população.\n" +
"NPC: Baltasar \"Baz\" Hartly (38) — Rabugento, competente, organizado. Guarda que virou líder de fato desde o sumiço de Selene; vira bala azeda de limão.\n" +
"O que Baz sabe: esteve no grupo que atacou a bruxa e trabalhou com Selene; sabe que fadas rondam a região enevoada; já lutou contra o Cavaleiro de Chocolate Amargo.\n" +
"Missão — Controle de Pragas: se inventarem um método melhor de afastar ratos, ele dá uma Hortelãnça (d8 de dano, 2d8 em carga de cavalo).\n\n" +
"5.3 Estalagem A Cabra Sorridente — comida, cerveja e quartos grátis se ajudarem a vila.\n" +
"NPC: Hannah Falcão (51) — Calorosa, fofoqueira, curiosa. Dona da estalagem, cheira a canela. Sabia que Élton (marido de Maya) sonhava com uma música estranha vinda da floresta antes de sumir, mas não contou a Maya.\n" +
"NPC: Constança \"Connie\" Oriente (24) — Impaciente, otimista, direta. Mensageira presa na vila pela maldição, pele virando hortelã listrada. Já tentou fugir várias vezes; foi barrada pelo Cavaleiro. Numa fuga recente, afugentou uma fera enorme com seu canivete de prata.\n\n" +
"5.4 Armazém / Posto de Troca — Zeca compra itens por preço justo e troca item comum por item comum do mesmo tamanho (não comercializa armas/armaduras).\n" +
"NPC: Ezequiel \"Zeca\" Grifo (52) — Otimista, distraído, energético. Cabelos viraram minhocas de goma coloridas.\n" +
"Missão — Consertar os Objetos Quebrados: cada objeto exige um Teste de Virtude apropriado (ou descrição criativa se tiver Talento relevante). Se consertar todos, dá a Luneta Feérica.\n\n" +
"5.5 Padaria — Pão de Viagem (1 pp) vale como ração diária. Se Rui não foi resgatado, Geraldo está preocupado demais para abrir.\n" +
"NPC: Geraldo Silva (38) — Vivaz, criativo, generoso. Padeiro, pai de Rui, esteve no ataque original a Dulcineia.\n" +
"O que Geraldo sabe: a torre da bruxa é uma fortaleza; o grupo esperou ela sair com os cativos pra atacar sob a lua; Selene tentou usar a Corda de Escalada Encantada para falar com as crianças, mas a janela era pequena demais.\n" +
"O que Rui sabe (se resgatado): é o único sequestrado que não virou doce por completo; a bruxa era obcecada por juventude e \"almas puras\"; lembra de uma cantiga que a bruxa cantava ao sair do cômodo; toda tentativa de fuga deixava tudo nebuloso e todos caíam no sono.\n" +
"Missão 1 — Os Óculos Perdidos: um esquilo levou os óculos de Geraldo para seu ninho no Bosque Emaranhado. Devolvendo, ele dá biscoitos com efeito do feitiço Restauração.\n" +
"Missão 2 — Biscoitinha, a Cadela: labradora cor de chocolate perdida na floresta, magicamente fortalecida; se achada, Rui deixa levá-la na jornada.\n\n" +
"5.6 Loja de Poções — prateleiras quase vazias.\n" +
"NPC: Rosana \"Rosa\" Águas-Claras (21) — Engenhosa, determinada, persistente. Irmã mais nova de Selene; administra a loja sozinha desde que os pais viraram bolinhos.\n" +
"O que Rosa sabe: ouve uivos vindos do Bosque à noite e sente uma conexão estranha (é irmã de Selene, que virou loba); usa um pingente de lua de prata, presente de Selene (que usava o do sol); sabe identificar a cura para maldições comuns.\n" +
"Missão — Vacina contra a Maldição Doce: tem só uma dose para testar; precisa de uma voluntária não amaldiçoada. 50% de chance de sucesso (imunidade) ou falha (Maldição Doce em 24h). Recompensa: uma rara Poção Encolhedora + 2 poções à escolha.\n\n" +
"5.7 Ferraria.\n" +
"NPC: Maya Élis (40) — Sóbria, taciturna, saudosa. Ferreira, marido Élton sumiu há 7 anos; acredita que foi levado pelas fadas. Grande conhecedora de fadas (reconhece referências do Rei-Elfo).\n" +
"O que Maya sabe especificamente: Élton foi abençoado com beleza pela Fada Madrinha dele (provável motivo do sequestro); o Rei-Elfo é um monarca das fadas que adora manipular humanos; suspeita que o portal das fadas fica atrás do véu de névoa que esconde a aldeia das fadas, mas nunca conseguiu atravessar; usa um xale feito por fadas, presente de Élton, muito apegada a ele; dá retalhos de ferro de graça a quem for ajudar a procurar Élton (fadas são vulneráveis a ferro no reino humano, mas o ferro é inútil e até perigoso socialmente se usado no domínio das fadas, como no Baile Eterno).\n" +
"Missão — Encontrar Élton no Baile Eterno: se reconhecerem Élton entre os convidados e o trouxerem para casa, Maya dá a espada Estalar de Segundos (d8 de dano, ataca duas vezes com uma única Ação — anos de trabalho solitário em sua homenagem).\n\n" +
"5.8 Praça da Vila — o poço de pedra do enigma do espelho fica aqui.\n" +
"Boatos que podem ser ouvidos: o marido da ferreira foi abençoado com beleza pelas fadas, não é à toa que arrumou outra amante e foi embora; algo estranho aconteceu quando Selene usou o Espelho — os olhos ficaram amarelados e os dentes brilhavam antes de ela virar pó; o prefeito disse que se livrou do espelho, mas deve estar escondido na mansão; o bosque é estranho — alguém já seguiu o som de uma festa e não encontrou ninguém; existem jeitos de enxergar além da visão humana; pesadelos com o retorno da bruxa, mesmo ela tendo sido morta.\n\n" +
"6. MORADORES SECUNDÁRIOS PELA VILA\n" +
"Giles Henderson (caramelo manteigado) — caçador ranzinza, conhece o Bosque Emaranhado.\n" +
"Milena Silva (profiterole) — açougueira direta, troca caça por prata ou defuma carne.\n" +
"Ânsio Monteiro (biscoito de gengibre) — alfaiate sociável, cria trajes elegantes (ótimo para um baile de fadas).\n" +
"Odessa Raposo (bala efervescente) — sapateira trabalhadora, afirma ter aprendido com artesãos fadas, entende muito de fadas.\n" +
"Élton Barlow (torta de abóbora) — caçador de ratos vaidoso, desavença com quase todo mundo.\n" +
"Viúva Ravena Colemon (maçapão) — fiandeira observadora, a moradora mais velha, sabe um pouco sobre tudo e todos.\n\n" +
"7. QUADRO-RESUMO DE MISSÕES PARALELAS DE CERVOVALE\n" +
"Teodoro (Mansão) — levantar o moral da vila -> Chave de prata da cidade.\n" +
"Baz (Salão Comunitário) — método melhor de controle de pragas -> Hortelãnça.\n" +
"Zeca (Armazém) — consertar todos os objetos quebrados -> Luneta Feérica.\n" +
"Geraldo (Padaria) — devolver os óculos perdidos no Bosque -> Pacote de biscoitos (Restauração).\n" +
"Rui/Geraldo (Padaria) — encontrar Biscoitinha, a cadela perdida -> uso da Biscoitinha na jornada.\n" +
"Rosa (Loja de Poções) — voluntariar-se para testar a vacina -> Poção Encolhedora + 2 poções à escolha.\n" +
"Maya (Ferraria) — encontrar Élton no Baile Eterno -> Espada Estalar de Segundos.",
    },
    {
      titulo: "AVENTURA COMPLETA 2/7 — O Bosque Emaranhado",
      categoria: "aventura",
      texto:
"1. VISÃO GERAL — Cervovale tem cerca de 500 moradores; dois terços já sucumbiram à maldição de Dulcineia. Os restantes fazem o possível pra manter a aldeia funcionando e estão ansiosos para contar tudo sobre a maldição e o Espelho Maléfico.\n\n" +
"2. LOCAIS NOTÁVEIS DO BOSQUE\n" +
"2.1 Vale das Bagas (aldeia das fadas): protegida por véu de névoa que só deixa passar criaturas menores que uma raposa. Aterrorizada pelo Rei dos Ratos — derrotá-lo dá a Cauda do Rei Rato (objetivo principal 1).\n" +
"2.2 Lago da Saudade Eterna: entrada para o reino das fadas. Entrar carregando um item de origem feérica transporta para o Baile Eterno, onde está o Anel do Rei-Elfo (objetivo 2). Também é onde Maya espera reencontrar Élton.\n" +
"2.3 Torre da Bruxa: isolada, protegida por magia. Dentro está o corpo que Dulcineia pretendia habitar após a morte, e dentro dele o Pingente Rouba-Alma — a relíquia da bruxa (objetivo 3). Perturbar o corpo ou remover o item libera a alma de Dulcineia.\n\n" +
"3. REGRAS DE EXPLORAÇÃO\n" +
"3.1 Complicações (Gastar Tempo): role uma Complicação sempre que Gastar Tempo — d8 em terreno desconhecido, d6 em terreno selvagem, d4 em terreno perigoso (como o Pântano). Tirar 1 = Complicação acontece.\n" +
"3.2 Viagem: 10 km (1 hexágono) por dia em área selvagem, ou 20 km (2 hexágonos) por estrada. Forçar a marcha soma mais 10 km, mas testa Determinação ou acorda Cansada no dia seguinte.\n" +
"3.3 Perdendo-se: sem ponto de referência claro, a Mestra pode pedir teste de Astúcia de quem guia; falha = grupo perdido (fica no hexágono ou vai parar num adjacente, a critério da Mestra).\n\n" +
"4. FADAS PEQUENAS E FADAS ALTAS — Fadas pequenas: orelhas arredondadas, asas de inseto, vida longa mas não imortal, poucos centímetros de altura. Fadas altas: orelhas pontudas, variedade de asas (podem ficar invisíveis à vontade), praticamente imortais, altura humana ou mais, magia inata. As duas espécies são orgulhosas e não gostam de ser confundidas uma com a outra.\n\n" +
"5. RUMORES E AJUDA DA NATUREZA\n" +
"Uma Princesa com Coração Selvagem ou Conexão Elemental pode pedir ajuda a animais (amigáveis/prestativos ou manhosos/egoístas, podendo já estar amaldiçoados). Animais amaldiçoados desejam açúcar e ficam mais ferozes até obtê-lo; dar açúcar acalma por um tempo curto. 1 em 6 de atrair um animal corrompido ao chamar.\n" +
"Rumores da natureza (d8): a magia da bruxa antes ficava perto da torre, agora é impossível escapar dela; fiquem longe do lago, gente já entrou e não voltou; uma coruja muito velha já foi animal companheiro de uma grande aventureira; um esquilo está juntando óculos no ninho, só troca por outra coisa; uma fera aterroriza os bichos menores há cerca de um ano, pior na lua cheia; há uma área enevoada onde bichos grandes se perdem e voltam; cuidado com pedrinhas coloridas na floresta — se molhadas, explodem; o Cavaleiro de Chocolate Amargo não gosta de ninguém perto da Torre, nem os bichos chegam perto.\n\n" +
"6. COMPLICAÇÕES NO BOSQUE EMARANHADO\n" +
"Noite (d6): pernas presas em Trepadeiras de Alcaçuz; teia gigante de algodão-doce bloqueia o caminho; escuridão faz perder a trilha; pegadas de cachorro em direção preocupante; sussurros sinistros e cheiro doce nauseante; um uivo penetrante e perto.\n" +
"Dia (d6): cheiro doce e inebriante — aonde leva?; um Ratel raivoso salta da folhagem; um cervo com protuberâncias de açúcar vem na direção de vocês (raiva ou pedido de ajuda?); armadilha de caça esquecida; fada pequena tenta roubar algo brilhante; poça que na verdade é Gosma de Melaço.\n\n" +
"7. CRIATURAS DO BOSQUE\n" +
"Ratel — PV 4, Salvamento 6, Armadura 1. Mordida (d6) ou Garra (d4), 1-2x. Perder qualquer PV = frenesi (desvantagem para evitar seus ataques). Fere com Maldição Doce.\n" +
"Cervo Amaldiçoado — PV 4, Salvamento 6, Armadura 0. Chifres (d4, ou d10 correndo). Fere com Maldição Doce.\n" +
"Gosma de Melaço — PV 10, Salvamento 6, Armadura 0. Engolfar (d6 automático a quem estiver envolvido, pode gastar ação para se libertar). 50% de desarmar em ataque contundente. Derrete com fogo ou congela para ficar quebradiça. Fere com Maldição Doce.\n" +
"Trepadeira de Alcaçuz — PV 2, Salvamento 6, Armadura 0. Chicote de Alcaçuz (d4). Fere com Maldição Doce.\n" +
"Fada Pequena — PV 1, Salvamento 18, Armadura 0. Desarmada (1). Ataques físicos contra ela têm desvantagem. Lança Puf! à vontade; 1 Dado de Dom — Jato de Purpurina.\n\n" +
"8. ENCONTROS ESPECIAIS LIGADOS À HISTÓRIA\n" +
"8.1 A Cova Misteriosa: ao norte de Cervovale, lápide sem inscrição além de um símbolo arcano (o mesmo do Espelho Maléfico — enterrá-lo aqui por uma noite o recarrega). A terra daqui foi usada para criar o Cavaleiro de Chocolate Amargo; área infestada de Vultos Sombrios à noite. Ninguém sabe quem está enterrado ali. Pode ser gancho para uma campanha futura ou a sepultura do espírito que responde pelo Espelho.\n" +
"8.2 Biscoitinha, a Cadelinha Encantada: Dulcineia roubou um tufo de pelo dela para o Cavaleiro de Chocolate Amargo (representação de lealdade canina), então Biscoitinha sempre sabe onde o Cavaleiro está e não sofre a Maldição Doce. PV 4, Salvamento 8, Armadura 0. Mordida (d4). Uma Princesa com Coração Selvagem conversa com ela facilmente.\n" +
"8.3 Lobo Mau (Selene): Selene não morreu — virou lobisomem e vagueia pelo Bosque, dormindo de dia, caçando à noite. Ataca à primeira vista, mas hesita se perceber vestígios de sua irmã (Rosa) entre as aventureiras. Derrotada, volta à forma humana, inconsciente, e dá sua Corda de Escalada Encantada (guardada em sua casa em Cervovale — corda animada que se prende sozinha).\n" +
"Lobo Mau — PV 8, Salvamento 12, Armadura 3. Ataca 2x: Garras (d4) e Mordida (d6). Armas prateadas/encantadas ignoram Armadura. Ferida = teste Determinação ou vira lobisomem.\n" +
"Vulto Sombrio — PV 4, Salvamento 12, Armadura 0. Dedos (d6, ignora Armadura). Seres etéreos que arrastam aventureiros desavisados para as profundezas.\n" +
"Nota: a Luneta Feérica (recompensa de Zeca) é a ferramenta que revela que o lobisomem é na verdade Selene.\n\n" +
"9. O CAVALEIRO DE CHOCOLATE AMARGO — Leal mesmo após a morte de Dulcineia, segue as últimas ordens: capturar almas puras e levá-las à sala de detenção no topo da torre; impedir entrada não autorizada na torre; impedir que moradores saiam do Bosque. Não sabe fazer o ritual do açúcar mágico, mas ainda captura qualquer criança que encontrar. Vê uma Princesa com Toque Curativo como alvo prioritário.\n" +
"Normalmente patrulha; fica hostil se o grupo tentar sair de Cervovale amaldiçoado, carregando algum dos 3 itens do objetivo, ou se alguém for \"pura o bastante\" para virar açúcar mágico. Leva itens confiscados para a torre.\n" +
"Se Biscoitinha estiver com o grupo, ele tenta matá-la (sente a conexão); ela pode alertar o grupo antes dele chegar.\n" +
"9.1 Localização inicial (d4): 1 Torre da Bruxa, 2 Lago da Saudade Eterna, 3 Vale das Bagas, 4 Cervovale — comece num hexágono adjacente.\n" +
"9.2 Movimento: a cada hexágono percorrido ou Gastar Tempo, role d20. 10 ou menos = ele se aproxima 1 hexágono. Se já estiver perseguindo ativamente, se aproxima com 15 ou menos (a menos que o grupo seja furtiva).\n" +
"9.3 Stat blocks:\n" +
"O Cavaleiro de Chocolate Amargo — PV 12, Salvamento 13, Armadura 3. Ataca 2x com Espada (d8) ou 1x com Lança (d8, 2d8 em carga montada). Ferida por ele = Maldição Doce (avança 1 estágio se já afligido). Suscetível a derretimento (calor ignora Armadura).\n" +
"Regeneração: se derrotado, regenera após 1 dia e retoma a patrulha — só derretê-lo/dissolvê-lo completamente impede isso.\n" +
"Cavalo de Guerra de Chocolate — PV 6, Salvamento 6, Armadura 0. Coice (d6). Montaria leal, suscetível a derretimento.\n\n" +
"10. REGRAS DE MONTARIA — Cavalos adquiridos usam as mesmas estatísticas do Corcel (exceto a suscetibilidade a derretimento). Viagem a cavalo: 30 km/dia em estrada/planície (40 km forçando a marcha); em terreno acidentado, mesma velocidade que a pé. Sobrecarga: até 35 itens de inventário; cavaleira conta como 10 espaços + seus pertences. Movimento em batalha: o cavalo se move até A Uma Pedrada enquanto a cavaleira faz uma Ação. Carga: lanças/piques causam o dobro do dano normal se atacarem de A Uma Pedrada ou mais montada.\n\n" +
"11. ENCONTROS OPCIONAIS (use onde fizer sentido no seu mapa, ou omita)\n" +
"11.1 A Caverna: teias de aranha (parte comum, parte algodão-doce) bloqueiam a entrada; uma aranha gigante espreita. Itens presos na teia (d4): mochila com poção de Vínculo Mental + 20 pp; Martelo de Guerra (d10, emite luz fraca); pergaminho com o feitiço Puf!; bolsa com odres vazios e rações mofadas. Teste de Graça para tirar um item sem alertar a aranha; falha = ela ataca.\n" +
"Aranha Gigante de Algodão-Doce — PV 8, Salvamento 10, Armadura 1. Mordida (d8). Lança rajada de teia como Ação (agarra, recarrega ao Descansar).\n" +
"11.2 O Círculo de Cogumelos: sete cogumelos coloridos ao redor de uma pedra ereta onde Ashkan (fada alta) está preso por Finnegan. Enigma na língua das fadas: \"Teste sua astúcia ou tente a sorte / Pra descobrir qual cogumelo arrancar. / Reconhecido pela visão ou paladar / Não sou vermelho nem verde-limão / O esforço de vocês vai se frustrar / Se pedirem que faça uma rima então. / O que sou?\" Resposta: laranja. Arrancar o certo liberta Ashkan; qualquer outro vira um Perseguidor Fungo (e um novo cogumelo da mesma cor cresce no lugar).\n" +
"Talento em Linguística/Folclore ou teste de Astúcia traduz o enigma na hora (ou Gastar Tempo); Maya ou qualquer fada alta também traduz.\n" +
"Perseguidor Fungo — PV 2, Salvamento 8, Armadura 0. Cabeçada (d4). 1x/dia libera esporos: todas Por Perto testam Determinação ou sofrem efeito por cor (vermelho: febre e Cansada; amarelo: músculos doloridos e Cansada; verde: visão fragmentada e Atordoada; azul: tontura e Atordoada; anil: mente nublada e Confusa; violeta: alucinações e Confusa).\n" +
"NPC: Ashkan (~30) — Sincero, introspectivo, afável. Fada alta ponderada, prefere solidão a festas (por isso alvo das peças de Finnegan). Se libertado, mostra como entrar no Baile Eterno, dá bugigangas de origem feérica pra ativar o portal e seu próprio convite não usado. Concede uma bênção: chamá-lo repetindo seu nome 3x. Conhece a Senhora Neves da Corte da Geada e do Pinheiro (mais bondosa do que parece, adora presentes feitos à mão).\n\n" +
"12. COLETAR ALIMENTOS (na área de coleta, Gastar Tempo; fora dela, também precisa testar Astúcia)\n" +
"Musgo da Alvorada — suco recupera 1 PC de uma pessoa Ferida (precisa estar fresco, até 3 dias). Ingrediente da poção de cura especial.\n" +
"Cravos-do-Pântano — compressa mascara cheiro de insetos/animais.\n" +
"Urtiga Trovão — infusão deixa Confusa. Ingrediente da poção Acorda, Acorda.\n" +
"Chapéu-de-Agulha — energia criativa: acaba com Cansaço/Confusão, vantagem em Astúcia por um dia (1 em 6 lança magia aleatória).\n" +
"Flor Ponta-de-Flecha — raízes substituem uma ração diária. Ingrediente da poção Acuidade Felina.\n" +
"Hera Lupina de Folha Larga — fumaça afasta cães/lobos/lobisomens; tintura interrompe um episódio licantrópico (doloroso, deixa Cansada).\n" +
"Azevinho de Erudito — baga impede todo sono por d4 dias. Ingrediente da poção Visão de Túnel.\n" +
"Papoula Noturna — dor de estômago, Atordoada e Cansada. Ingrediente de uma poção letal.",
    },
    {
      titulo: "AVENTURA COMPLETA 3/7 — Vale das Bagas e o Rei Rato",
      categoria: "aventura",
      texto:
"1. VISÃO GERAL — A aldeia das fadas pequenas, Vale das Bagas, é protegida por névoa espessa que desorienta qualquer criatura maior que uma raposa. Nenhum morador vivo de Cervovale jamais pisou lá. O problema atual: pólen amaldiçoado nas abelhas do apiário produziu mel enfeitiçado, deixando abelhas e quem come o mel ferozes. A pior criatura resultante é o Rei Rato — uma massa de ratos amarrados pelas caudas com mel, que ocupou o depósito de comida (uma toca de coelho virada armazém) e está devorando tudo.\n\n" +
"2. CHEGADA A VALE DAS BAGAS\n" +
"2.1 Entrada: se chegarem de surpresa, Castanho (líder da Guarda Espinheiro) detém o grupo com desconfiança (fadas pequenas desconfiam de humanos desde que Dulcineia roubou a Colher de Mel). Só leva até a Rainha Gardênia se convencido de que não são ameaça.\n" +
"NPC: Castanho (46) — Estoico, desconfiado, cauteloso. Asas amarelas de libélula, leal e calmo em crise. Fraqueza: seu vaga-lume de estimação — qualquer Princesa com animal de estimação o conquista rápido.\n" +
"Missão — O Vaga-lume Perdido: perdeu o vaga-lume numa fuga do depósito (está preso no Depósito Auxiliar de Alimentos, Sala 3, no Limo Vermelho Tóxico). Recompensa: Arco Ferrão (d6 de dano, 6 Flechas Ferrão de uso único, críticas em 1-2; atingida testa Determinação ou fica incapaz de agir 1 rodada).\n" +
"2.2 Praça da Aldeia: lojas em tocos e cogumelos gigantes — roupas, armarinho, cafeteria.\n\n" +
"3. RUMORES E GERADORES DE HABITANTES\n" +
"Rumores (d6): Castanho parece durão mas é molenga com o vaga-lume; o círculo de cogumelos com o pilar de pedra fede a magia de fada alta, melhor evitar; a rainha era fascinada por humanos antes de algo dar errado (ninguém sabe o quê); o melhor artesão sempre visita a Raposa (Odessa, sapateira de Cervovale) na vila humana, perigoso; a rainha conhece fadas altas, talvez peça ajuda a alguma (mas elas são volúveis); a bruxa é culpa de tudo — a senha da Torre é \"Maçapão Maravilhoso\" (ouvida sendo dita em voz alta).\n" +
"Gerador de fada pequena (role d6 em cada): Asas (borboleta arco-íris / libélula verde / mariposa marrom / abelha translúcida / joaninha vermelha e preta / borboleta-azul-morfo rasgada); Ocupação (Guarda Espinheiro / agricultora / coletora / funileira / manutenção da barreira / conservação de alimentos); Nomes (Malva-Rosa, Calispinho, Salpico, Brilha-Costa, Campânula, Estragão).\n\n" +
"4. COMPLICAÇÕES EM VALE DAS BAGAS (NOITE, d6): enxame de abelhas loucas por mel; Serpente Mortal Enorme atravessa a névoa; fada charlatã oferece poção inútil; a fada com quem precisam falar só conversa depois de tomar sua bebida favorita; chuva forte (gotas do tamanho de vocês nesse tamanho); fada desconfiada reúne uma gangue achando que vocês causaram a maldição.\n\n" +
"5. CRIATURAS DE VALE DAS BAGAS\n" +
"Fada Pequena do Vale das Bagas — PV 4, Salvamento 18, Armadura 0. Desarmada (1); guardas podem ter armas/armadura. Puf! à vontade; 1 Dado de Dom — Jato de Purpurina.\n" +
"Enxame de Abelhas — PV 10, Salvamento 6, Armadura 0. Ferrão (d8 com saúde cheia, d6 na metade — cada ferroada mata 1 abelha, -1 PV do enxame). Ferroada testa Determinação ou Atordoada. Fere com Maldição Doce.\n" +
"Serpente Mortal Enorme — PV 10, Salvamento 8, Armadura 0. Mordida (d12), venenosa. Fere com Maldição do Veneno.\n\n" +
"6. CASTELO DA RAINHA GARDÊNIA — esculpido nas raízes de uma árvore gigante viva.\n" +
"NPC: Rainha Gardênia (120) — Elegante, cética, prática. Enganada por Dulcineia quando jovem, jurou nunca mais deixar estranhos se aproveitarem de seu povo. Asas de borboleta-monarca.\n" +
"O que ela sabe/oferece: sabe ativar o Lago da Saudade Eterna e o que esperar do Rei-Elfo; conta a história de Dulcineia e as fadas se questionada; se o grupo trouxer de volta a Colher de Mel roubada, fica em dívida e concede qualquer pedido.\n\n" +
"7. FAZENDA MEL CRISTA — campos pisoteados, colmeias destruídas pelas abelhas enlouquecidas.\n" +
"NPC: Fazendeiro Listra-d'Olmo (38) — Dedicado, modesto, franco. Asa ferida.\n" +
"Missão 1 — Curar a Asa do Fazendeiro: cura (ou dá meio alternativo de voar) → lote de Bolos de Mel (não amaldiçoados, vantagem em persuasão até Gastar Tempo).\n" +
"Missão 2 — Derrotar o Rei Rato: recompensa da Rainha Gardênia (primeiro presente de fada a humano desde Dulcineia) → Prendedor Borboleta (1 Dado de Dom — voo temporário como Flutuar, recarrega pregando peça/brincadeira).\n" +
"Outros itens de Vale das Bagas: Varinha de Colher de Mel (2 Dados de Dom — Hipnotizar, É Meu!, Amarrar; recarrega com Geleia Real).\n\n" +
"8. O NINHO DO REI RATO (MASMORRA) — tábuas pregadas na entrada, sons de guinchos ao vento.\n" +
"8.1 Complicações (d6): desabamento; barulho de assobio (cobra?); fonte de luz apaga; cheiro de mel e podridão deixa Atordoada; voz pedindo socorro — mais alguém aqui?; armadilha antipeste das fadas — teste Graça ou fique enredada.\n" +
"8.2 Sala 1 — Entrada: tábuas bloqueiam a passagem (ferramentas desmontam fácil, senão Gastar Tempo). Dois túneis se bifurcam: direita = zumbido fraco; esquerda = cheiros conflitantes e magia.\n" +
"8.3 Sala 2 — Sala das Poções: miasma denso, poça cintilante no chão — pisar nela causa efeito mágico aleatório (Gastar Tempo aqui = 1 em 6 de efeito). Duas garrafas intactas: poção de cura especial e poção de Estátua Viva.\n" +
"Efeitos mágicos (d6): cega por 2d6 minutos; aparência muda para a próxima pessoa vista por 6h; não resiste a contar segredos embaraçosos por 1h; mãos insubstanciais por 1h (não segura nada); flutua/voa livremente por 10 min; cura metade do PC máximo.\n" +
"8.4 Sala 3 — Depósito Auxiliar de Alimentos: brilho verde do vaga-lume de Castanho, preso na parede por Limo Vermelho Tóxico vivo, que envolve quem entra completamente.\n" +
"Limo Vermelho Tóxico — PV 6, Salvamento 6, Armadura 0. Toque Corrosivo (d6), corrói madeira/metal. Cortar com lâmina divide em 2 gosmas com metade dos PV. Derrete com fogo ou congela para quebrar.\n" +
"8.5 Sala 4 — Depósito de Armas: abelhas amaldiçoadas transformam a sala numa extensão da colmeia; armas em sua maioria inutilizáveis, mas o Escudo Hélice está preservado em cera (vantagem em Salvamentos contra magia, mas desativa outros itens mágicos e magias benéficas recebidas).\n" +
"8.6 Sala 5 — A Colmeia Principal: câmara central, células de cera gotejando mel amaldiçoado (quem consumir contrai a Maldição Doce). Uma rachadura no chão marca o túnel do Rei Rato; as abelhas evitam essa área.\n" +
"8.7 Sala 6 — A Abelha Rainha: maior que as outras, não ataca diretamente, mas tenta hipnotizar para servi-la.\n" +
"8.8 Sala 7 — Os Túneis dos Ratos: navegar exige teste de Astúcia com desvantagem (anulada com ferramenta de navegação ou talento como Orientação); perdida = Gastar Tempo e tentar de novo, rolando d4 para Imprevistos.\n" +
"8.9 Sala 8 — A Toca do Rei Rato: amálgama de sete ratos com as caudas emaranhadas e fundidas, enlouquecidos de mel amaldiçoado. Atacando: d6 ratos conseguem atacar por rodada. Cortando a cauda: após 3 ratos derrotados, pode tentar cortá-la direto, com desvantagem (a menos que os restantes estejam distraídos/incapacitados) — se cortada antes de todos derrotados, d4 fogem.\n" +
"A Cauda do Rei Rato: troféu que cabe no bolso quando humana; todos os roedores a temem instintivamente. Este é o item ligado ao Rei dos Ratos — um dos três objetivos principais!\n\n" +
"Rato Louco Amaldiçoado (unidade) — PV 4, Salvamento 8, Armadura 0. Mordida (d4).",
    },
    {
      titulo: "AVENTURA COMPLETA 4/7 — Lago da Saudade Eterna e o Baile Eterno (parte 1)",
      categoria: "aventura",
      texto:
"1. LAGO DA SAUDADE ETERNA — portal para a terra das fadas altas. Precisa ser ativado: entrar na água com a intenção de viajar para lá enquanto se carrega algo de origem feérica.\n" +
"Quem sabe ativar: a Rainha Gardênia, Ashkan, alguns animais selvagens do Bosque, ou uma Princesa com Intelecto Sábio/Folclore (teste de Astúcia).\n" +
"Sem ativação: entrar só molha. Tentar achar o fundo não dá em nada. Ativado corretamente: sai por um espelho no saguão do Baile Eterno.\n" +
"Itens de origem feérica conhecidos: algo que a Rainha Gardênia pode fornecer se conquistada; a Máscara de Baile de Hannah; a Corda de Escalada de Selene; talvez itens obscuros da loja de Zeca; o xale de Maya (ela não abre mão dele fácil); itens das próprias Fadas Madrinhas do grupo.\n\n" +
"2. FADAS ALTAS E HUMANOS — relações variam: Fadas Madrinhas veem humanos como dignos de presentes/proteção; outras os veem como brinquedos; outras simplesmente como outro povo. No Baile Eterno, até as mais amigáveis tendem a esquecer as diferenças entre espécies. A idade de cada convidado é a idade aparente — todos são muito mais velhos do que parecem.\n\n" +
"3. ENTRANDO NO BAILE ETERNO\n" +
"3.1 Élvar controla o portal e só admite quem atenda ao código de vestimenta (tema atual: \"Celestial\") e tenha convite ou acompanhante. Fadas às vezes levam humanos para uma noite de festa, então a presença de vocês não chama atenção por si só. Tentar entrar escondida esbarra num escudo de força e Jato de Purpurina (glitter = vergonha, desvantagem em testes sociais).\n" +
"NPC: Élvar (60) — Esmerado, perspicaz, indiferente. Nunca vai à festa, prefere escolher quem vai. Magro, pálido, bigode roxo-vivo. Lenço bordado com estrelas dá a dica do tema atual.\n\n" +
"3.2 Visão geral do Baile: jardim bem cuidado, pilares sem teto (só céu — rosado de alvorada perto da entrada, meio-dia mais além, crepúsculo mais longe ainda). Três seções: Alvorada (Jardim), Meio-Dia (Banquete), Crepúsculo (Salão de Baile). Objetivo principal: conseguir um anel do Rei-Elfo, que circula na área do Crepúsculo — só se desfaz dele completando um desafio cronometrado.\n\n" +
"3.3 Laços com as fadas pequenas: alguma fada do baile pode ter negociado a Colher de Mel com Dulcineia (ou tê-la recebido de outra fada) — boa forma de conectar com a missão da Rainha Gardênia e o item da relíquia da bruxa (Pingente Rouba-Alma).\n\n" +
"4. COMPLICAÇÕES E FOFOCAS DO BAILE\n" +
"Complicações: uma fada furiosa confunde vocês com outra pessoa e exige duelo; um nobre flerta pra provocar ciúmes no par (e está funcionando); vocês derrubam a bebida de uma convidada elegante; Finnegan aparece e começa a causar; uma convidada entediante não larga a conversa; um item de um nobre sumiu e acusam vocês.\n" +
"Fofocas: o Rei-Elfo está entediado, faz séculos que ninguém o desafia; o Príncipe Aurélio troca cartas de amor com a criada da Senhora Amaris; a Duquesa Jacinda sempre sabe irritar todo mundo; um humano bonito está preso no baile há séculos e mal lembra o próprio nome (é Élton); uma fada perde a noção do tempo no reino humano — passa-se um mês por lá num piscar de olhos; a Corte do Sol e do Céu está de mal com a Corte da Lua e das Estrelas — seria bom se Aurélio e Amaris casassem logo.\n\n" +
"5. TEMPO DAS FADAS — ao sair do lago, role d4: 1 nenhum tempo passou; 2 sete horas; 3 um dia; 4 uma semana (e a Maldição Doce avança um estágio em quem já estiver afligida).\n" +
"Convidada do Baile Eterno (stat block genérico) — PV 6, Salvamento 14, Armadura 0. Desarmada (1) ou Rapieira (d8). 3 Dados de Dom — Puf!, Enredar, Dardo Mágico, Bolha.",
    },
    {
      titulo: "AVENTURA COMPLETA 5/7 — Baile Eterno (parte 2: Jardim, Banquete, Salão)",
      categoria: "aventura",
      texto:
"6. SEÇÃO ALVORADA: O JARDIM\n" +
"6.1 Amantes Proibidos: Príncipe Aurélio, prometido à Senhora Amaris por casamento político, ama secretamente Penélope (criada de Amaris). Penélope não quer arriscar a reputação dele. Amaris está disposta ao casamento político mas guarda segredos menos picantes de Aurélio (medo de aranhas, ilusão que usa nos músculos).\n" +
"NPC: Senhora Amaris (Corte da Lua e das Estrelas, ~30) — Bondosa, sagaz, modesta. Pele morena, olhos como estrelas.\n" +
"NPC: Príncipe Aurélio (Corte do Sol e do Céu, 30s) — Genial, charmoso, reservado. Clássico Príncipe Encantado; por trás da fachada há um lado sincero raramente visto.\n" +
"NPC: Penélope (30) — Ansiosa, tímida, devotada. Criada e amiga íntima de Amaris; se corteja secretamente com Aurélio.\n\n" +
"6.2 Croquê Fada: variante onde o objetivo é acertar a bola com o máximo de floreio (pontuação incompreensível). Aurélio adora — boa forma de se aproximar dele.\n\n" +
"6.3 Rivalidade entre Irmãos: Cirilla e Cirillo (~18, gêmeos quase idênticos — ela tem marca de estrela sob o olho direito, ele sob o esquerdo) brigam porque apareceram com a mesma roupa e nenhum quer trocar (Cirillo está na seção Crepúsculo). Reconciliá-los dá o Corvo Mensageiro (estátua de latão — sussurre uma mensagem e ele a entrega a quem você quiser).\n\n" +
"6.4 O Trovador: Arturo procura uma história boa o bastante para sua próxima balada. Se derem uma boa história, dá a Harpa Cantacora (1x/dia, quem ouve testa Astúcia ou revela o coração em canção; só usável por quem tem talento musical).\n" +
"NPC: Arturo, o Trovador (~40) — Curiosa, teatral, jovial. Sabe tudo sobre todos — muito procurado ou muito evitado, dependendo de quem tem segredos.\n\n" +
"7. SEÇÃO MEIO-DIA: O BANQUETE — comida de fada é tentadora; qualquer humano que comer fica Confuso e relutante em partir (efeito passa se for levada à força de volta ao reino humano, ou com um objeto ligado a algo que valoriza no mundo humano).\n\n" +
"7.1 Objeto de Estima: Élton (marido de Maya) está preso no baile por Ilayda. Receber o xale de Maya recupera suas memórias na hora; outros itens da aldeia (biscoitos, a chave da cidade, flores do Bosque) também ajudam. Ilayda só abre mão dele em troca de algo igualmente belo que a convença de estar levando a melhor; tenta impedir se tentarem levá-lo sem negociar.\n" +
"NPC: Élton Élis (38) — Atordoado, confuso, saudoso. Abençoado com beleza ao nascer, por isso foi alvo de Ilayda. A comida de fada embotou sua personalidade gentil e curiosa.\n" +
"NPC: Ilayda (~20) — Egoísta, esnobe, impulsiva. Acredita que deve ter qualquer coisa bonita que deseja, incluindo pessoas.\n" +
"Devolver Élton resolve por completo a missão de Maya (espada Estalar de Segundos).\n\n" +
"7.2 Encrenca em Dobro: jogo de dados popular das fadas — a primeira a tirar números iguais num par de d6 vence. Boa forma de ganhar favores/informação, mas é preciso apostar algo de valor equivalente.\n" +
"Recompensas possíveis (d8): moeda que sempre cai cara; fofoca quentíssima; flecha de prata que sempre acerta; apresentação a uma convidada importante; luvas de seda finas (60 pp); broche com joias em forma de besouro (150 pp); fita de cabelo que muda de cor com o humor; apito que imita qualquer canto de pássaro.\n\n" +
"8. SEÇÃO CREPÚSCULO: O SALÃO DE BAILE — pista de dança enorme sob luz de estrelas; música cativante vem de lugar nenhum. Quem dança fica presa a dançar sem parar sem um teste de Astúcia bem-sucedido (mais de um teste necessário = sai da pista Cansada). O trono do Rei-Elfo geralmente está vazio — ele circula entre os convidados.\n\n" +
"8.1 Finnegan, o Traquinas: bufão que sempre aparece como criança (~10), deixa um rastro de caos. Se capturado, pode oferecer sua Varinha do Capricho em troca da liberdade (1 Dado de Dom — Jato de Purpurina, Puf!, Encolher, Virar Sapo; recarrega Gastando Tempo numa festa animada). Foi ele quem aprisionou Ashkan na pedra do Círculo de Cogumelos.\n" +
"NPC: Finnegan (~10) — Leviano, infantil, impulsivo. Valoriza sua liberdade acima de tudo.\n\n" +
"8.2 Os Nobres: impressionar a Duquesa Jacinda usando uma habilidade em que ela é especialista (Moda, Magia, Dança ou Perspicácia Social — teste com desvantagem) dá os Brincalhetes Sussurrantes (esfregar a cabeça do lagarto revela fraqueza/segredo de alguém visível à sua escolha; recarrega contando um segredo depreciativo sobre si mesma).\n" +
"NPC: Duquesa Jacinda (Corte da Sombra e da Melancolia, ~40) — Maldosa, crítica, soberba. Intimidadora, hábil em moda/magia/dança.\n" +
"NPC: Senhora Neves (Corte da Geada e do Pinheiro, ~50) — Reservada, dedicada, nostálgica. Pele quase azul, deixa geada em tudo que toca; ponto fraco por presentes sinceros feitos à mão. Usa uma pulseira de lã tosca, feita e dada por uma antiga tutelada humana, décadas atrás.\n\n" +
"8.3 O Rei-Elfo — dá seu anel a quem ele favorece; qualquer pessoa presente sabe disso. Pedir um anel gera um desafio cronometrado (ampulheta), com aposta obrigatória de algo de valor. Falha permite tentar de novo dizendo \"dobro ou nada\". Aceita coisas abstratas (memórias, anos de vida, habilidades) — memórias humanas raras (morte, trabalho, um momento com um ente querido) valem mais para ele que ouro.\n" +
"O Desafio do Rei-Elfo: antes que a ampulheta se esgote, conseguir um Sorriso da Senhora Neves, um Segredo do Príncipe Aurélio e um Elogio da Duquesa Jacinda. O salão é vasto — dividir o grupo pode ser necessário; Gastar Tempo pode fazer perder o prazo.\n" +
"NPC: O Rei-Elfo (~30) — Enigmático, majestoso, alegre. Veste um conjunto roxo elaborado; sorriso que sugere que sabe algo que você não sabe.\n" +
"O Rei-Elfo — PV 15, Salvamento 15, Armadura 0. Desarmado (1) ou Rapieira (d8). Quase onipotente em seu domínio — pode lançar qualquer magia e distorcer o espaço à vontade; se reduzido a 0 PC, reaparece curado. Fraqueza: adora apostas de alto risco e é vinculado à própria palavra. 4 Dados de Dom — qualquer feitiço.\n" +
"O Anel do Rei-Elfo: aura majestosa enquanto usado/carregado; fadas tendem a tratar com mais respeito. Objetivo principal 2 da campanha!\n\n" +
"9. TERRITÓRIO DE DULCINEIA (além do Rio Fioazul) — cruzar o rio coloca o grupo no domínio da bruxa, onde a maldição é mais forte: 50% de chance de qualquer animal (mesmo invocado) estar corrompido; quem já tem a Maldição Doce sente-a se intensificar (Gastar Tempo: d20, tirar 1 = avança um estágio); o pântano ao redor da torre é um brejo de chocolate — Teste de Virtude para atravessar sem ficar presa ou perder itens.\n" +
"Atravessando o Rio Fioazul: frio e largo, sem ponte. Teste de Virtude apropriado à solução do grupo (se trabalharem juntas, uma rola por todas — sucesso se metade ou mais teria sucesso individualmente). Falha permite atravessar, mas com uma consequência.\n" +
"Consequências (d6): encharcada — comida ensopada e intragável; quase afogada — Cansada até Descansar; cortada numa pedra afiada — d6 de dano; tornozelo torcido — Atordoada até ser curada; arrastada — perde um item na água; congelada — Confusa até se secar.\n" +
"O que tem no rio (d6): poção de cura comum; botas de couro finas enlameadas (10 pp); bolsa com 20 pp; flecha com penas flamejantes; medalhão rachado com pedras semipreciosas (100 pp); anel encantador que não sai depois de colocado.",
    },
    {
      titulo: "AVENTURA COMPLETA 6/7 — A Torre da Bruxa",
      categoria: "aventura",
      texto:
"1. CHEGANDO À TORRE — mais de 15 metros de altura, ar denso de cheiro doce com um zumbido grave de magia poderosa por baixo. Três entradas possíveis: porta da frente (guardada por Construtos de Chocolate com Hortelã); janela do topo (pequena demais até para uma criança); dreno sob a torre (leva direto à cozinha).\n" +
"O Pingente Rouba-Alma está no corpo que Dulcineia construiu no Quarto da Bruxa; só acessível por meios mágicos (Chá de Soneca + atravessar a tapeçaria no Escritório). Objetivo principal 3 da campanha!\n\n" +
"2. COMPLICAÇÕES NA TORRE (d6): líquido desconhecido derrama em você (o que ele faz?); chão treme — o que foi ativado?; objeto próximo ganha vida e ataca; um item mágico seu se volta contra você sob a influência de Dulcineia; o familiar da bruxa rouba um item do grupo; passos de armadura — é o Cavaleiro?\n\n" +
"3. O FAMILIAR DE DULCINEIA: FANTASMA — corvo de chocolate branco. Se entraram com a senha, ele segue mas não ataca (a menos que tentem entrar no quarto da bruxa ou o ataquem primeiro); se entraram escondidas, grasna e ataca na hora. Pode ser conquistado como aliado.\n" +
"Fantasma — PV 2, Salvamento 8, Armadura 0. Bicar (d4). Não pode ser morto permanentemente — reaparece no Viveiro após o grupo Gastar Tempo. Se vir algo que Dulcineia desaprovaria, grasna como sirene e alerta os Construtos. Conversa livremente com uma Princesa de Coração Selvagem; pode beber uma poção sem rótulo na cozinha para falar por um tempo curto. Não é excessivamente leal — pode ser subornado/persuadido (bondade genuína dá vantagem); se persuadido, revela onde pisar no Viveiro e qual livro puxar na Sala de Experimentos.\n\n" +
"4. AS SALAS DA TORRE\n" +
"Sala 1 — Dreno da Torre: entrada gradeada travada, dá para uma pessoa passar. Gosma de Açúcar no porão (PV 10, Salvamento 4, Armadura 0. Toque Corrosivo d6, corrói madeira/metal, corta divide em 2 com metade dos PV, derrete com fogo/gelo, fere com Maldição Doce) guarda a chave dourada do baú de Dulcineia (caiu no ralo por acidente). Grade no teto (teste Determinação) leva à cozinha.\n" +
"Sala 2 — A Porta da Frente: dois Construtos de Chocolate com Hortelã guardam a entrada, atacam sem a senha correta (\"Maçapão Maravilhoso\").\n" +
"Construto de Chocolate com Hortelã — PV 8, Salvamento 10, Armadura 3. Ataca 2x: Lança (d8). Suscetível a derretimento (calor/água ignora Armadura). Fere com Maldição Doce.\n" +
"Sala 3 — A Cozinha: cozinha encantada anima ferramentas contra intrusas sem permissão (Magia da Cozinha ou teste de Astúcia dá controle). Caldeirão animado (chão escorregadio, desvantagem em Graça; cair causa d4 de dano). Três utensílios animados tentam empurrar para o forno.\n" +
"Utensílio de Cozinha Animado — PV 2, Salvamento 4, Armadura 0. Cortar (d6) ou Golpear (d4).\n" +
"Tapeçaria de jardim na parede; garrafa \"Chave do Jardim\" (líquido verde) permite atravessar bebendo dela. Ameixas e rosas cristalizadas para o Chá de Soneca crescem só ali. Saída dos fundos leva ao Escritório.\n" +
"Sala 4 — O Jardim Mágico: prado com maçãs carameladas e ameixas açucaradas; portal de volta à cozinha (chave só é necessária pra entrar, sair é livre). Alistair, espírito preso num coelho de chocolate branco meio derretido, oferece a Roleta do Chá: se todas concordarem em jogar, sentam e não podem se levantar até beber. Mestra rola d6 secretamente por jogadora numerada: número não corresponde = cura d4+1 PC ao beber e pode se levantar; número corresponde = troca de corpo com Alistair (ele foge no corpo dela; ela fica presa no assento dele, com acesso às magias dele). Desfaz-se preparando 2 xícaras a mais e forçando-o a beber uma. Recapturado (ou se ninguém cair no truque), ele revela como entrar na Sala de Experimentos e que há a Adaga Ruína dos Dragões no baú do quarto.\n" +
"Alistair — PV 3, Salvamento 10, Armadura 0. Desarmado (1). Suscetível a derretimento. 2 Dados de Dom — Mão Amiga, Animar, Aceleração.\n" +
"Sala 5 — Escritório: estantes com armadilhas mágicas (uma leva à entrada secreta do Escritório; Intelecto Sábio percebe as armadilhas na hora).\n" +
"Estantes: Abre-te Sésamo (cria dentes e morde); Anfíbios do Bosque Emaranhado (sapo inofensivo pula fora); Curas Curiosas e Remédios Raros (Maldição do Veneno); As Alegrias da Aromaterapia (cheiro calmante); Caçando a Saída (transporta pro Torreão); Insônia e Seus Efeitos (adormece, sono inofensivo); Desenhando Inspiração (2 Dados de Dom — Treco Mágico ao desenhar); O Companheiro do Coletor (transporte para a Área de Coleta e de volta); Além do que se Vê (mostra o lugar que a leitora mais quer ver); As Maiores Conquistas Mágicas do Nosso Tempo (abre a Sala de Experimentos).\n" +
"Tapeçaria de um quarto na parede (portal pro Quarto da Bruxa, via Chá de Soneca). Poltrona com o diário de Dulcineia e uma xícara com resíduo de Chá de Soneca; livro A Arte da Chocolataria produz um bombom não mágico. Chapéu da Bruxa no gancho (concede 1 Dado de Dom, mas o usuário fala com eco mágico dramático). Escada em caracol leva ao Viveiro.\n" +
"Sala 6 — A Sala de Experimentos: mesa de trabalho com o livro de progresso dos experimentos e instrumentos. Vitrine vazia do tamanho de um humano (onde ficava o corpo novo da bruxa).\n" +
"Outros itens (d6): O Grimório Proibido; poção de cura comum; licor de framboesa (cura Aflição/ferimento); bebida gaseificada (efeito de Flutuar, mas indigestão terrível); colherada de açúcar de alma (origem desconhecida); tigela de lodo rançoso (perturbada = teste Determinação ou Maldição do Paladar Infantil).\n" +
"O Grimório Proibido: pode ser abandonado livremente ou, se aprofundado, causa medo profundo e uma rolagem na Tabela de Ferimentos como custo — em troca ensina as magias Medo, Drenar e Afligir.\n" +
"Sala 7 — O Viveiro: construtos de doce imóveis em exibição (Unicórnio de Algodão-Doce, Serpente de Alcaçuz, Ursinho de Goma, Ovo do Dragão) servem de segurança — tocar ou sair do caminho seguro os anima (dano deles não transmite Maldição Doce, por serem construtos, não animais afligidos).\n" +
"Serpente de Alcaçuz — PV 2, Salvamento 8, Armadura 0. Mordida (d12). Fere com Maldição do Paladar Infantil.\n" +
"Ursinho de Goma (Torre) — PV 8, Salvamento 10, Armadura 2. Ataca 2x: Mordida (d10) e Garra (d6). Suscetível a derretimento.\n" +
"Unicórnio de Algodão-Doce — PV 10, Salvamento 16, Armadura 1. Investida (d10). Suscetível a derretimento (água ignora Armadura). 3 Dados de Dom — Jato de Purpurina, Bolha, Restauração.\n" +
"Chão encantado desperta os construtos se pisado fora do caminho seguro (a Luneta Feérica ou visão mágica revela o caminho). Poleiro onde Fantasma reaparece. Ovo de Dragão Gigante de Chocolate, quente ao toque, casca impermeável a armas comuns (só a Adaga Ruína dos Dragões arranha, e mesmo ela sozinha pode não bastar — magia + engenhosidade a critério da Mestra). Se rompido: explosão de canela, 3d6 de dano a quem estiver Por Perto (metade com Graça bem-sucedida), destrói o dragão dentro, tornando-o indisponível para Dulcineia possuir depois. Escada alta leva ao Torreão.\n" +
"Sala 8 — Torreão: porta destrancada, mas sair aciona Fechadura + névoa mágica (teste Determinação ou dorme por 1h). Colchões de palha onde as crianças dormiam; um amuleto de sorte (joaninha) sob um cobertor. Padrão riscado na parede — notas musicais SOL-LÁ-FÁ-SOL; assobiar/cantar/tocar a melodia permite sair sem impedimento (Voz Encantadora ou talento musical reconhece na hora).\n" +
"Sala 9 — O Quarto da Bruxa: penteadeira cheia de produtos de beleza. Baú trancado (a chave dourada do dreno abre; forçar, mesmo com sucesso, causa a Maldição do Paladar Infantil). Dentro: joias (400 pp), medalhão com retrato jovem de Dulcineia (25 pp), uma adaga enferrujada (na verdade a Adaga Ruína dos Dragões), vestidos antigos (60 pp).\n" +
"Construto na forma da Dulcineia jovem, como manequim — dentro está o Pingente Rouba-Alma. Fácil de retirar, mas ao ser perturbado libera a alma de Dulcineia para possuir o dragão do Viveiro (se o ovo não foi destruído) ou virar Aparição (se foi destruído).\n" +
"O Pingente Rouba-Alma: ao ser tocado pela primeira vez, dá sensação de equilíbrio emocional e um flashback vívido — próximo teste com vantagem. Item da relíquia da bruxa — objetivo principal 3!\n\n" +
"5. O DIÁRIO DE DULCINEIA (Escritório) — entradas (ordem não necessariamente cronológica no material original):\n" +
"\"As fadas têm sido bastante hospitaleiras. Encantei sua rainha para que me ensine a magia que ela conhece. Gostaria de dar uma olhada em sua varinha. As propriedades do mel se alinham com meus objetivos de certa forma, então pode ser útil.\"\n" +
"\"A magia é forte aqui no Bosque Emaranhado. Mesmo como uma bruxa novata, posso senti-la. Este será o local perfeito enquanto persigo minha missão.\"\n" +
"\"A varinha é INÚTIL. Não estou mais perto de descobrir o segredo da longevidade. Embora talvez eu não deva ser tão apressada. Descobri que, embora não seja a resposta para minhas questões mais profundas, o mel é magicamente potente e fácil de trabalhar. Devo experimentar com outros doces e ver se eles podem aprimorar minha arte.\"\n" +
"\"Quem vive mais do que as fadas? Quem é mais eternamente belo? Se alguém tem o segredo da longevidade juvenil, são elas. Preciso encontrar uma entrada para o reino das fadas, e acredito que tenho uma pista.\"\n" +
"\"O experimento com meu cavaleiro de chocolate foi bem-sucedido. Ele é o mais humano de todas as minhas criações de confeitaria. Mas se vou preencher completamente a lacuna entre açúcar e carne, precisarei tentar algo diferente. Tenho uma ideia, mas precisarei pesquisar sobre rituais de vinculação. E crianças.\"\n" +
"\"Não sei quanto tempo fiquei presa naquele lugar amaldiçoado... Com este Pingente Rouba-Alma, agora tenho uma maneira de manter minha alma preservada, mesmo na morte. Só preciso criar um corpo digno de abrigá-la.\"\n" +
"\"A lua está cheia, as crianças estão reunidas, o recipiente está completo. Tudo o que resta para a tarefa é a execução... Esta noite, o ritual. Amanhã? Minha verdadeira vida começa.\"\n" +
"\"As coisas estão progredindo rapidamente. Mal posso suportar ter o recipiente fora da minha vista... Talvez seja hora de mudar de local.\"\n\n" +
"6. O LIVRO DE EXPERIMENTOS DE DULCINEIA (Sala 6) — tópicos visíveis à primeira vista; decifrar um específico exige teste de Astúcia.\n" +
"Chá de Soneca: receita com ameixas açucaradas, botões de rosa frescos e hortelã, fervidos e mexidos com pena de corvo de chocolate branco.\n" +
"Açúcar de Alma: ritual fatal tentado (e falho) para extrair açúcar das almas das crianças roubadas.\n" +
"O Cavaleiro de Chocolate Amargo: recebeu centelha de vida com terra da Cova Misteriosa e um tufo de pelo de Biscoitinha (lealdade).\n" +
"Corpo Sintético: diagrama do corpo jovem, com a cavidade no peito para o Pingente — instruções estritas para não perturbá-lo depois de colocado.\n" +
"O Pingente Rouba-Alma: usado por fadas em projeção astral para garantir retorno ao corpo certo; sem ele, almas desvanecem, viram aparições, ou possuem um receptáculo próximo conveniente.\n" +
"O Dragão de Canela: último grande projeto antes dos construtos humanoides; interrompido, sem núcleo de vida — aberto a possessão por alma desatrelada. Dulcineia foi ferida várias vezes criando-o (magia volátil), parte do motivo do abandono.",
    },
    {
      titulo: "AVENTURA COMPLETA 7/7 — Confronto final, desfechos e regras extras",
      categoria: "aventura",
      texto:
"1. O RETORNO DA BRUXA — ao remover o Pingente Rouba-Alma, a alma de Dulcineia escapa:\n" +
"Se o Ovo de Dragão foi destruído: ela se prende ao retrato de sua versão jovem no baú e vira uma Aparição, furiosa por interferirem no trabalho de sua vida — ataca com intenção letal.\n" +
"Se o Ovo de Dragão NÃO foi destruído: ela possui o dragão não eclodido. A torre desmorona sob o peso do dragão adulto (o grupo precisa descer ou fica presa). Dulcineia leva cerca de 1 hora para chegar a Cervovale e ataca a vila, a menos que o grupo se faça notar antes.\n" +
"Se as Princesas chegarem cedo demais e perturbarem o Pingente antes do previsto, ainda libera o espírito — elas terminam a tarefa lidando com uma ameaça ativa e iminente.\n\n" +
"2. CENÁRIOS DE CHEGADA A CERVOVALE (só no cenário do Dragão)\n" +
"Antes de Dulcineia: tempo para armadilhas, reunir forças, evacuar moradores.\n" +
"Dentro de 1h da chegada: Dulcineia já ataca; moradores corajosos (Selene, Baz) lideram a defesa; prédios pegando fogo; pode já haver baixas.\n" +
"Mais de 1h depois, mesmo dia: resistência sufocada, prédios destruídos, muitos mortos ou sucumbiram à Maldição Doce.\n" +
"1 dia ou mais depois: Dulcineia dominou completamente; relaxa na praça, servida pelos moradores restantes; guarda o poço (sabe da missão); pode oferecer ao grupo desistir em troca de servi-la, antes de atacar.\n\n" +
"3. QUEBRANDO A MALDIÇÃO — derrotar Dulcineia não basta: é preciso jogar a Cauda do Rei Rato, o Anel do Rei-Elfo e o Pingente Rouba-Alma no poço da vila. Se qualquer item for destruído na luta, a maldição fica inquebrável (só danificado ainda serve).\n\n" +
"4. STAT BLOCKS: DULCINEIA\n" +
"Dulcineia (Aparição) — PV 16, Salvamento 14, Armadura 2. Toque Gélido (d8). Armas prateadas/encantadas ignoram Armadura. 4 Dados de Dom — Animar, Puf!, É Meu!, Medo, Drenar, Afligir. Ferida = teste Astúcia ou Maldição Doce começando no 2º estágio (ou avança 1, se já afligida).\n" +
"Dulcineia (Dragão de Canela) — PV 25, Salvamento 16, Armadura 3. Ataca 3x: Mordida (d12) e 2 Garras (d8). Rajada de fogo de canela: 20 de dano em área (10 com Graça bem-sucedida; recarrega ao Descansar). 3 Dados de Dom — Névoa (nuvem de pó de canela), Emaranhado (blobos de bala de canela), Bola de Fogo (cheira a canela — mecanicamente iguais às versões normais). Ataques de água ignoram Armadura.\n\n" +
"5. O QUE FAZER A SEGUIR\n" +
"Se o grupo ficar todo Ferido: alguma fada prestativa pode ajudar. Se perecerem ou falharem em recuperar os itens, Cervovale sucumbe totalmente à maldição, que continua se espalhando. Se falharem em derrotar Dulcineia reanimada, fica uma nova ameaça solta para um futuro grupo de Princesas enfrentar.\n" +
"Se derrotarem Dulcineia e jogarem os 3 itens no poço: a maldição quebra! A magia de cura se espalha pela vila, transformando doce em carne de novo e reunindo entes queridos. Cervovale aclama o grupo como heroínas, com um grande banquete em sua homenagem (sem sobremesa, por enquanto). Pergunte ao grupo sobre fios soltos com os NPCs, e o que acham que o futuro reserva a cada Princesa.\n\n" +
"6. FERRAMENTAS DE COMUNICAÇÃO / SEGURANÇA À MESA — Doce Vingança toca em horror corporal, sequestro, violência fantasiosa e situações assustadoras, mesmo num cenário de conto de fadas.\n" +
"Linhas e Véus: linhas são coisas que não devem aparecer no jogo de forma alguma; véus são coisas que podem acontecer fora de cena, sem serem interpretadas em detalhe.\n" +
"Carta-X: marcador (ex: cartão com um X) que qualquer pessoa usa para pedir que o jogo pare, por qualquer motivo, sem precisar explicar.\n" +
"Política de Portas Abertas: deixe claro que qualquer pessoa pode sair da mesa a qualquer momento, por qualquer razão — o jogo nunca é mais importante que o bem-estar de alguém.\n\n" +
"7. ITENS DA TORRE (referência rápida)\n" +
"Chave dourada (dentro da Gosma de Açúcar, Sala 1) — abre o baú do Quarto da Bruxa.\n" +
"Adaga Ruína dos Dragões (baú, Sala 9) — d6 de dano, 3 Dados de Dom, ignora Armadura de dragões, fere o ovo de dragão.\n" +
"Pingente Rouba-Alma (construto, Sala 9) — objetivo principal; relíquia da bruxa.\n" +
"O Grimório Proibido (Sala 6) — ensina Medo, Drenar e Afligir a um custo sério.\n" +
"O Chapéu da Bruxa (Sala 5) — concede 1 Dado de Dom; eco mágico dramático.\n" +
"Amuleto de sorte em forma de joaninha (Torreão, Sala 8) — pertence a uma das crianças roubadas.\n" +
"Joias, medalhão, vestidos (baú, Sala 9) — 400 pp / 25 pp / 60 pp.",
    },
  ];

  const existingTitles = new Set(state.notes.map((n) => n.titulo));
  fullNotes.forEach((n) => {
    if (!existingTitles.has(n.titulo)) {
      state.notes.push({ id: uid(), titulo: n.titulo, texto: n.texto, categoria: n.categoria || "lore" });
    }
  });
}

function seedExtraLoot() {
  if (state.seededExtras2) return;
  state.seededExtras2 = true;

  const extraNotes = [
    {
      titulo: "Maldição Doce — tabela completa (6 tipos x 3 estágios)",
      categoria: "regras",
      texto:
"Ao longo da aventura, as Princesas terão várias oportunidades de cair vítimas da Maldição Doce. Uma vez amaldiçoada, a Princesa só pode ser curada se a maldição for quebrada por completo. Use qualquer um dos efeitos abaixo ou crie os seus próprios, usando os exemplos como guia.\n\n" +
"Para cada indivíduo amaldiçoado, a Maldição Doce progride em 4 estágios, avançados pela Mestra conforme apropriado ou quando o texto indicar. Os 3 primeiros representam os efeitos crescentes da aflição específica da pessoa. No 4º estágio, a vítima vira uma versão de confeitaria de si mesma por completo e fica incapaz de se mover, falar ou agir até a maldição ser quebrada.\n\n" +
"CONDIÇÕES E PREOCUPAÇÕES DA CONFEITARIA\n" +
"Derreter: exposição direta a calor extremo ou mais que uma quantidade pequena de água, sem proteção, derrete a parte afetada. Perde d4 de PC máximo.\n" +
"Mofar: role d6 no início de cada dia; tirar 1 = começa a mofar, perde d4 de PC máximo, passa a feder e atrair insetos (desvantagem em Testes de Virtude sociais onde o cheiro de podre for desagradável).\n" +
"Reparo e Conservação: dá pra mitigar os efeitos — disfarçar o cheiro apetitoso, criar armadura à prova d'água. Partes de confeitaria quebradas/perdidas podem ser substituídas com Astúcia, magia e ingredientes de confeitaria.\n\n" +
"1. BOLO DE MEL\n" +
"Estágio 1: cheira a cravo, canela e gengibre; sangue vira mel dourado.\n" +
"Estágio 2: pele vira bolo pegajoso ensopado de mel. Ao Gastar Tempo na floresta, role d8 — tirar 1 atrai um Ratel.\n" +
"Estágio 3: grandes partes viram bolo de mel, suscetível a Derreter se molhar e a Mofar. Vantagem em Testes de Virtude para ser lisonjeadora/sedutora com a voz.\n\n" +
"2. PÉ DE MOLEQUE\n" +
"Estágio 1: hálito encorpado e amendoado; amendoins granulam sob a pele.\n" +
"Estágio 2: carne fica quebradiça — qualquer impacto que cause perda de PC quebra pedaços; precisa Gastar Tempo juntando-os ou eles somem do PC máximo permanentemente.\n" +
"Estágio 3: grande parte do corpo é doce frágil, risco de se despedaçar. Em vez de rolar na Tabela de Ferimentos, sofre 1 ponto de Trauma e fica Cansada e Atordoada até achar refúgio seguro. Pode gastar Dados de Dom para invocar [SOMA] esquilos prestativos (ajudam com uma tarefa em troca de amendoins arrancados da própria carne).\n\n" +
"3. SONHO DE CREME\n" +
"Estágio 1: corpo fica macio e massudo; sangue vira de framboesa.\n" +
"Estágio 2: polvilhada de açúcar de confeiteiro que deixa rastro — desvantagem em Testes de Virtude para se esconder/ser furtiva.\n" +
"Estágio 3: grandes porções viram sonho de creme — suscetível a Mofar e a Derreter se molhar. Quedas/impactos contundentes não machucam nem tiram PC.\n\n" +
"4. PUXA-PUXA\n" +
"Estágio 1: pele colorida e vibrante; cheiro doce e frutado; gosto salgado constante nos lábios.\n" +
"Estágio 2: pele terrivelmente pegajosa — desvantagem em Testes de Virtude de motricidade fina, arremessar, atirar com arco etc.\n" +
"Estágio 3: membros viram puxa-puxa elástico — esticam até o dobro do tamanho (teste Determinação pra voltar ao normal); esticar além do dobro rompe o membro.\n\n" +
"5. SORVETE\n" +
"Estágio 1: espiral de chocolate/baunilha no rosto como marca de nascença; solta granulados coloridos do cabelo.\n" +
"Estágio 2: ânsia por frio, calor incomoda — desvantagem em Testes de Virtude sob sol direto ou perto de fogo.\n" +
"Estágio 3: corpo de sorvete extremamente propenso a Derreter com sol/calor/água. Pode gastar Dados de Dom pra congelar instantaneamente o que morder — numa criatura, causa [SOMA] de dano e a congela no lugar por [DADOS] minutos.\n\n" +
"6. MARSHMALLOW\n" +
"Estágio 1: até o toque mais leve deixa marcas no corpo fofinho e macio.\n" +
"Estágio 2: falar fica difícil, lábios de marshmallow grudam — desvantagem em Testes de Virtude com a voz.\n" +
"Estágio 3: chamas atraem. Ao ver fogo, teste Determinação; falha = caminha até o fogo e fica tostada/queimada. Marca 1 ponto de Trauma e a Determinação aumenta permanentemente em 1 (esse Trauma não causa medo de fogo).",
    },
    {
      titulo: "Combate contra criaturas de doce — Fogo e Água",
      categoria: "regras",
      texto:
"Armadura: dano de fogo ignora a Armadura em criaturas de doce derretíveis.\n\n" +
"Tochas: acertar um monstro com tocha acesa causa d4 de dano. A tocha se consome ao fim do combate. Acender uma tocha com pederneira conta como uma Ação durante a luta.\n\n" +
"Acertos críticos com tocha: tirar 1 no ataque = acerto em cheio, 2d4 de dano, mas a tocha se apaga com o impacto. Tirar 20 = erra e a tocha se apaga.\n\n" +
"Óleo de lamparina: criaturas de doce podem ser incendiadas com combustível. Durante a luta, teste Graça para banhar o monstro com óleo/substância inflamável; falha = erra e o frasco é desperdiçado.\n\n" +
"Em chamas: incendiar com óleo causa d8 de dano imediato. Se ainda em chamas no turno seguinte, o alvo pode: gastar o turno apagando as chamas, ou sofrer d4 de dano adicional enquanto faz outra coisa em chamas.\n\n" +
"Água: grandes quantidades (especialmente fervendo!) podem ajudar contra certas criaturas de doce, dependendo do tipo. Ficar encharcada pode: causar dano que ignora Armadura; deixar a criatura lenta e pegajosa (vantagem na Defesa contra ela); ou distraí-la, dando vantagem a outra Princesa no ataque.",
    },
    {
      titulo: "Achados — Cervovale",
      categoria: "achados",
      texto:
"ACHADOS NARRATIVOS\n" +
"Bilhete amassado — Praça da Vila, perto do poço. Caligrafia de Selene: \"...três coisas. O Rato, o Anel, e algo dela mesma. Preciso ir ver o espelho antes que —\" (rasgado)\n" +
"Caderno de receitas — Padaria do Geraldo. Página emocional sobre o bolo de aniversário de Rui, que ele promete fazer todo ano até o filho voltar.\n" +
"Carta nunca enviada — Ferraria da Maya, atrás de uma bigorna. Carta de Maya para Élton, nunca mandada por não saber pra onde.\n" +
"Livro de hóspedes — Estalagem A Cabra Sorridente. Último nome antes da maldição: \"Élvar\" — nota de Hannah sobre um cliente esquisito perguntando sobre \"convites\".\n" +
"Lista de encomendas antigas — Armazém do Zeca. Pedido de quase um ano atrás endereçado à \"Torre ao Norte do Bosque\" (era de Dulcineia).\n" +
"Desenho de criança — Salão Comunitário. Desenho a giz de cera de uma torre, lua cheia e figuras de mãos dadas: \"nós vamos voltar pra casa.\"\n" +
"Anotações de patrulha — com Baz ou no Salão Comunitário. Entrada sobre as ausências suspeitas de Selene nas patrulhas noturnas.\n" +
"Cartaz desbotado — Mansão da Prefeitura ou Praça. Anúncio de um festival de colheita de antes da maldição, assinado por Teodoro.\n\n" +
"ACHADOS ÚTEIS (dinheiro e itens)\n" +
"Moedas na rachadura do poço — Praça da Vila. 8 pp entalhadas numa fresta, precisa de faca ou objeto fino pra tirar.\n" +
"Bolsa esquecida — Estalagem, debaixo de uma cama no quarto vazio. 12 pp e um Kit de Costura (1).\n" +
"Pote de mel puro — Padaria, atrás de sacos de farinha. Não amaldiçoado; ingrediente ou vale 2 refeições de viagem.\n" +
"Bolsa de moedas sob a tábua solta — Armazém do Zeca, perto do balcão. 15 pp (se devolvidas, Zeca fica muito grato e pode dar desconto permanente em trocas).\n" +
"Faca de cozinha bem feita — Padaria. (1) d4 de dano — fabricação incomum, ligeiramente élfica. Ninguém sabe explicar a origem.\n\n" +
"Resumo de valor total em Cervovale: ~35 pp, além de Kit de Costura, pote de mel e faca de cozinha.",
    },
    {
      titulo: "Achados — Bosque Emaranhado",
      categoria: "achados",
      texto:
"ACHADOS NARRATIVOS\n" +
"Símbolo entalhado numa árvore — perto da trilha principal, onde Rui foi encontrado. Um coração com \"R\" dentro.\n" +
"Página de diário de patrulha — perto da Cova Misteriosa. Anotação de Selene sobre a terra \"não natural\" do local.\n" +
"Ninho de esquilo — em qualquer árvore alta. Além dos óculos do Geraldo, uma coleção de bugigangas trocadas ao longo dos anos.\n" +
"Marca de casco queimada — em qualquer trilha secundária. Sinal recente da passagem do Cavaleiro de Chocolate Amargo.\n" +
"Corda puída amarrada num galho — perto do Lago da Saudade Eterna. Ninguém sabe de quem é.\n" +
"Carta amassada num tronco oco — em qualquer parte densa do bosque. Carta antiga nunca entregue, sugerindo que a Colher de Mel foi vendida para saldar uma dívida.\n\n" +
"ACHADOS ÚTEIS (dinheiro e itens)\n" +
"Bolsa de couro de um viajante perdido — perto de uma trilha secundária. 6 pp e uma bússola enferrujada que ainda funciona.\n" +
"Poção de cura comum — meio enterrada perto de um tronco caído, frasco quebrado mas vedado.\n" +
"Corda e gazuas — dentro de um tronco oco. Kit de gazuas (1) e 15 metros de corda resistente.\n" +
"Saquinho de sementes raras — perto da Área de Coleta. Rosa (Cervovale) pagaria bem, ou Zeca as identifica com a luneta.\n" +
"Anel de latão sem valor mágico — perto do Círculo de Cogumelos. Vale 5 pp se vendido.\n\n" +
"Resumo de valor total no Bosque: ~11 pp, além de bússola, poção de cura, gazuas+corda, sementes raras e anel.",
    },
    {
      titulo: "Achados — Vale das Bagas",
      categoria: "achados",
      texto:
"ACHADOS NARRATIVOS\n" +
"Cartas de amor em miniatura — Praça da Aldeia. Bilhetinhos entre duas fadas pequenas, amarrados com fio de teia.\n" +
"Diário de bordo do apiário — Fazenda Mel Crista. Última entrada do Fazendeiro Listra-d'Olmo sobre o \"pólen estranho\".\n" +
"Ficha de negociação antiga — Castelo da Rainha Gardênia. Registro formal da troca da Colher de Mel por um \"pingente de prata... forte presença mágica\".\n" +
"Cartaz de \"procurada\" desbotado — Entrada da Vila. Retrato rabiscado de uma \"ladra de colheres\" — Dulcineia.\n" +
"Bilhete de Castanho — Depósito Auxiliar de Alimentos, perto de onde o vaga-lume ficou preso. \"Volto pra te buscar, prometo. Não apaga.\"\n\n" +
"ACHADOS ÚTEIS (dinheiro e itens)\n" +
"Moedas de fada — espalhadas na Praça da Aldeia. Um punhado vale 10 pp se trocado com um humano interessado em curiosidades (Zeca compraria).\n" +
"Frasco de mel puro do mercado — Praça da Aldeia, barraca abandonada. Vantagem em um único Teste de Virtude de persuasão, como os Bolos de Mel em menor escala.\n" +
"Tesourinha élfica — Fazenda Mel Crista, entre as ferramentas. Corta com precisão absurda, nunca fica cega.\n" +
"Bolsinha com pequenas gemas — perto do Castelo da Rainha Gardênia. 3 gemas, 20 pp juntas — origem feérica óbvia, vendê-las na vila humana pode levantar sobrancelhas.\n\n" +
"Resumo de valor total em Vale das Bagas: ~30 pp (moeda de fada), além de mel puro e tesourinha élfica.",
    },
    {
      titulo: "Achados — Baile Eterno",
      categoria: "achados",
      texto:
"ACHADOS NARRATIVOS\n" +
"Cartão de dança rabiscado — O Jardim. Nome de Aurélio repetido de forma obsessiva — pertence à Senhora Amaris.\n" +
"Carta de amor escondida atrás de um vaso — O Jardim. Carta não assinada de Aurélio para Penélope.\n" +
"Cardápio manchado de vinho — O Banquete. \"Torta de Amora Silvestre — a favorita de E.\" (Élton.)\n" +
"Bilhete de aposta — perto da mesa de Encrenca em Dobro. Dívida de Finnegan com o Rei-Elfo: uma memória de infância.\n" +
"Página de partitura rasgada — Salão de Baile. Verso inacabado de Arturo sobre \"a bruxa doce que trocou juventude por —\".\n\n" +
"ACHADOS ÚTEIS (dinheiro e itens)\n" +
"Moedas de ouro fada — chão do Salão de Baile. 25 pp em moedas ornamentadas — 1 em 6 de virarem folhas secas sem valor ao sair do reino das fadas (a critério da Mestra).\n" +
"Broche perdido — O Jardim, entre arbustos aparados. Broche de prata em forma de flor, vale 40 pp.\n" +
"Frasco de vinho encantado — O Banquete, mesa lateral. Um gole cura 1d4 PC, mas deixa Confusa por 1 rodada.\n" +
"Par de luvas de seda finas — Salão de Baile, idênticas ao prêmio de Encrenca em Dobro. Valem 60 pp.\n\n" +
"Resumo de valor total no Baile Eterno: ~65 pp (parte instável), além de broche, vinho encantado e luvas de seda.",
    },
    {
      titulo: "Achados — Torre da Bruxa",
      categoria: "achados",
      texto:
"ACHADOS NARRATIVOS\n" +
"Carta de juventude de Dulcineia — Escritório (Sala 5), entre os livros. Rascunho nunca enviado para a mãe dela, sobre não querer envelhecer.\n" +
"Lista de compras da bruxa — Cozinha (Sala 3), na bancada. Ingredientes do Chá de Soneca, com reclamação sobre Fantasma.\n" +
"Bilhete de criança — Torreão (Sala 8), sob os colchões. Assinado \"Rui, Ana, Théo e mais uns que eu esqueci o nome.\"\n" +
"Recibo de compra — Sala de Experimentos (Sala 6), entre os frascos. Registro formal da troca fada-bruxa pela Colher de Mel/Pingente.\n" +
"Anotação de Selene — Dreno da Torre (Sala 1) ou Porta da Frente (Sala 2). Aviso sobre o Espelho Maléfico: \"não confiem no espelho de mão. Ele mente sobre o preço.\"\n\n" +
"ACHADOS ÚTEIS (dinheiro e itens)\n" +
"Moedas espalhadas pela cozinha — Sala 3. 10 pp em moedas antigas.\n" +
"Bolsa de couro com ferramentas de alquimia — Sala de Experimentos (Sala 6), gaveta trancada (fácil de arrombar). Funciona como Kit de Cura (1) em situações com poções/venenos.\n" +
"Frasco extra de poção não rotulada — Escritório (Sala 5), atrás dos livros. Poção de Cura Comum esquecida, intacta.\n" +
"Joias pequenas soltas — Quarto da Bruxa (Sala 9), no chão perto da penteadeira (além do baú). 30 pp em brincos e anéis simples sem valor mágico.\n\n" +
"Resumo de valor total na Torre: ~40 pp, além de ferramentas de alquimia e uma poção extra.\n\n" +
"RESUMO GERAL — se tudo for encontrado em todos os locais: Cervovale ~35 pp, Bosque Emaranhado ~11 pp, Vale das Bagas ~30 pp (fada), Baile Eterno ~65 pp (instável), Torre da Bruxa ~40 pp. Ajuste os valores conforme o ritmo econômico da sua mesa.",
    },
  ];

  const existingTitles = new Set(state.notes.map((n) => n.titulo));
  extraNotes.forEach((n) => {
    if (!existingTitles.has(n.titulo)) {
      state.notes.push({ id: uid(), titulo: n.titulo, texto: n.texto, categoria: n.categoria || "lore" });
    }
  });
}

// Terceira leva: monstros do bestiário que faltavam no banco (identificados a partir
// do livro de regras). Sob flag própria pra não duplicar em quem já tinha os dados antigos.
function seedMoreMonsters() {
  if (state.seededMonstros2) return;
  state.seededMonstros2 = true;

  const monster = (nome, determinacao, graca, astucia, coracao, salvamento, armadura, tags, notas) => ({
    id: uid(),
    nome,
    tipo: "Monstro",
    determinacao,
    graca,
    astucia,
    coracao,
    salvamento,
    armadura,
    tags,
    notas,
  });

  const extraMonsters = [
    monster("Utensílio de Cozinha Animado", 4, 6, 2, 2, 4, 0, ["conjurada"],
      "Cortar (d6) ou Golpear (d4). Uma Princesa com Magia da Cozinha pode comandar um Utensílio de Cozinha Animado com um teste de Astúcia bem-sucedido."),
    monster("Biscoitinha, a Cadelinha Encantada", 6, 10, 8, 4, 8, 0, ["cervovale", "padaria", "companheira"],
      "Mordida (d4). A cadelinha desaparecida de Geraldo Silva, da padaria — achá-la é uma das missões dele."),
    monster("Cervo Amaldiçoado", 6, 10, 6, 4, 6, 0, ["cervovale", "bosque emaranhado"],
      "Chifres (d4, ou d10 quando pega impulso correndo). Coberto de protuberâncias pontiagudas de açúcar cristalizado. A origem do nome de Cervovale."),
    monster("Unicórnio de Algodão-Doce", 10, 16, 12, 10, 16, 1, ["vale das bagas", "fada"],
      "Investida (d10). Suscetível a derretimento — ataques baseados em água ignoram a Armadura. 3 Dados de Dom — pode lançar Jato de Purpurina, Bolha e Restauração."),
    monster("Convidada do Baile Eterno", 8, 14, 12, 6, 14, 0, ["baile eterno"],
      "Desarmada (1) ou Rapieira (d8). 3 Dados de Dom — pode lançar Puf!, Enredar, Dardo Mágico e Bolha."),
    monster("Aranha Gigante de Algodão-Doce", 10, 8, 8, 8, 10, 1, ["bosque emaranhado"],
      "Mordida (d8). Pode lançar uma rajada de teias como uma Ação — agarram quem for pego no jato e têm chance de grudar em quem passar por elas depois. O jato recarrega quando a aranha Descansa."),
    monster("Vulto Sombrio", 6, 14, 14, 4, 12, 0, ["torre da bruxa"],
      "Dedos (d6, ignora Armadura). Ser etéreo e misterioso que habita lugares profundos e escuros; agarra sorrateiramente e arrasta pra as profundezas. Se Ferida por um Vulto Sombrio, teste Astúcia ou sofra a Maldição Melancolia."),
    monster("Trepadeira de Alcaçuz", 8, 4, 2, 2, 6, 0, ["torre da bruxa"],
      "Chicote de Alcaçuz (d4). Tenta agarrar e estrangular suas vítimas."),
    monster("Serpente de Alcaçuz", 6, 10, 8, 2, 8, 0, ["torre da bruxa"],
      "Mordida (d12). Se Ferida por esta serpente, sofra a Maldição do Paladar Infantil."),
    monster("Abelha Rainha", 8, 10, 10, 8, 8, 1, ["vale das bagas"],
      "2 Dados de Dom — pode lançar Hipnotizar. Governa o Enxame de Abelhas."),
    monster("Perseguidor Fungo", 8, 6, 6, 2, 8, 0, ["bosque emaranhado", "círculo de cogumelos"],
      "Cabeçada (d4). Uma vez por dia pode liberar uma nuvem de esporos nocivos — todas Por Perto testam Determinação; falha = efeito de esporo colorido (Vermelho/Laranja/Amarelo = Cansada; Verde/Azul = Atordoada; Anil/Violeta = Confusa)."),
  ];

  extraMonsters.forEach((m) => {
    if (!state.npcs.some((n) => n.nome === m.nome)) state.npcs.push(m);
  });

  const extraItems = [
    { nome: "A Cauda do Rei Rato", custo: "—", origem: "Derrotar o Rei Rato (Vale das Bagas)",
      descricao: "Uma cauda rosada, vermiforme, com tufos de pelo emaranhado ainda grudados, cortada do monstruoso Rei Rato. Um troféu enorme enquanto se está do tamanho de uma fada pequena, mas cabe no bolso quando se é humana. Enquanto a carrega, todos os roedores a temem instintivamente.",
      tags: ["vale das bagas", "objetivo principal"] },
    { nome: "Botas Andarilhas", custo: "(1 se carregada)", origem: "Livro básico — itens mágicos",
      descricao: "Enquanto usa estas botas, forçar a marcha durante viagens não causa Cansaço. Quando carregadas, basta bater os calcanhares uma na outra e testar Astúcia para tentar se transportar instantaneamente, junto com quaisquer amigas de mãos dadas, para um local familiar escolhido. Falha coloca vocês num local aleatório num raio de 10km do destino. Transportar-se para sua própria casa é sempre bem-sucedido automaticamente. Recarregam andando 100km em terreno selvagem enquanto as usa.",
      tags: ["item mágico", "viagem"] },
    { nome: "Máscara de Baile", custo: "—", origem: "Hannah Falcão",
      descricao: "Esta máscara feita pelas fadas garante anonimato total quando usada. Nem seus próprios pais a reconheceriam.",
      tags: ["baile eterno"] },
  ];
  extraItems.forEach((i) => {
    if (!state.items.some((x) => x.nome === i.nome)) state.items.push({ id: uid(), ...i });
  });

  const complicationsNote = {
    titulo: "Tabelas de Complicação (d6, por local)",
    categoria: "regras",
    texto:
      "Role quando fizer sentido narrativamente (ex: ao Gastar Tempo explorando ou viajando por uma área).\n\n" +
      "BOSQUE EMARANHADO (DIA)\n" +
      "1. Vocês são enfeitiçadas por um cheiro doce e inebriante. Aonde ele leva?\n" +
      "2. Um Ratel raivoso salta da folhagem mais próxima.\n" +
      "3. Um cervo agitado, coberto de dolorosas protuberâncias de açúcar cristalizado, vem direto na direção de vocês.\n" +
      "4. Vocês acidentalmente tropeçam numa armadilha de caça esquecida!\n" +
      "5. Uma fada pequena tenta surrupiar algo brilhante que alguém do grupo está segurando.\n" +
      "6. Isso não é uma poça — é uma Gosma de Melaço!\n\n" +
      "BOSQUE EMARANHADO (NOITE)\n" +
      "1. Suas pernas ficam enroscadas em Trepadeiras de Alcaçuz.\n" +
      "2. Uma teia gigante de algodão-doce bloqueia o caminho.\n" +
      "3. A escuridão é tanta e o bosque tão denso — vocês acham que perderam a trilha.\n" +
      "4. Vocês veem o que parecem ser pegadas de cachorro, mas não gostam nada da direção pra onde elas levam.\n" +
      "5. Sussurros sinistros enchem os ouvidos de vocês e um cheiro doce e nauseante toma conta do ar.\n" +
      "6. Esse uivo é tão penetrante… e está perto.\n\n" +
      "VALE DAS BAGAS\n" +
      "1. Um enxame de abelhas loucas por mel aparece!\n" +
      "2. Uma Serpente Mortal Enorme abre caminho através da névoa.\n" +
      "3. Uma fada pequena charlatã tenta barganhar com vocês, oferecendo uma poção inútil.\n" +
      "4. A fada pequena com quem vocês precisam falar teve uma noite particularmente ruim e se recusa a conversar até tomar sua bebida favorita.\n" +
      "5. Começa a chover. FORTE.\n" +
      "6. Uma fada pequena desconfiada ACHA que vocês são as culpadas pela Maldição Doce.\n\n" +
      "NINHO DO REI RATO\n" +
      "1. O túnel em que vocês estão começa a tremer. É um desabamento!\n" +
      "2. O que é esse barulho de assobio? Será que uma cobra entrou aqui?\n" +
      "3. Sua fonte de luz se apaga e vocês ficam completamente no escuro.\n" +
      "4. O cheiro forte e denso de mel e podridão está começando a deixar vocês Atordoadas.\n" +
      "5. Vocês ouvem uma voz chamando por socorro. Há mais alguém aqui?\n" +
      "6. Vocês tropeçam numa das armadilhas antipeste das fadas pequenas.\n\n" +
      "BAILE ETERNO\n" +
      "1. Uma fada furiosa confunde vocês com outra pessoa e exige um duelo.\n" +
      "2. Um nobre começa a flertar com vocês pra provocar ciúmes em seu par. Está funcionando...\n" +
      "3. Vocês tropeçam e derrubam a bebida de uma convidada muito elegante.\n" +
      "4. Finnegan aparece e começa a causar travessuras com sua varinha mágica.\n" +
      "5. Uma convidada extremamente entediante puxa conversa e não deixa vocês saírem.\n" +
      "6. Um item especial de um nobre desapareceu, e ele acusa vocês de terem roubado!\n\n" +
      "TORRE DA BRUXA\n" +
      "1. Um líquido desconhecido se derrama em você!\n" +
      "2. Você dá um passo em falso e o chão começa a tremer.\n" +
      "3. Um objeto próximo ganha vida e começa a atacá-la!\n" +
      "4. Um de seus itens mágicos cai sob influência de Dulcineia.\n" +
      "5. O familiar da bruxa entra voando e rouba um item do grupo.\n" +
      "6. São passos de armadura? O Cavaleiro de Chocolate Amargo está aqui?",
  };
  if (!state.notes.some((n) => n.titulo === complicationsNote.titulo)) {
    state.notes.push({ id: uid(), titulo: complicationsNote.titulo, texto: complicationsNote.texto, categoria: complicationsNote.categoria });
  }
}

// Quarta leva: elenco do Baile Eterno (só existiam no texto corrido, sem ficha pra
// consulta rápida), regras/relógios de fundo que faltavam (Dado de Maldição, progressão
// de nível), tabelas e geradores do livro, e pequenos ajustes em dados já existentes.
function seedBaileENotas() {
  if (state.seededBaileENotas) return;
  state.seededBaileENotas = true;

  const npc = (nome, determinacao, graca, astucia, coracao, salvamento, armadura, tags, notas) => ({
    id: uid(), nome, tipo: "NPC", determinacao, graca, astucia, coracao, salvamento, armadura, tags, notas,
  });

  const newNpcs = [
    npc("Élvar", 10, 10, 14, 8, 12, 0, ["baile eterno", "portão"],
      "Esmerado, Perspicaz, Indiferente. Guarda o portão do Baile Eterno e decide o tema do traje exigido para entrar."),
    npc("Príncipe Aurélio", 10, 16, 10, 8, 14, 0, ["baile eterno", "corte do sol e do céu", "nobre"],
      "Charmoso, Reservado. Da Corte do Sol e do Céu. Secretamente apaixonado por Penélope; tem medo de aranhas; usa uma ilusão para parecer mais musculoso do que é."),
    npc("Senhora Amaris", 10, 14, 12, 8, 14, 0, ["baile eterno", "corte da lua e das estrelas", "nobre"],
      "Bondosa, Sagaz, Modesta. Da Corte da Lua e das Estrelas."),
    npc("Penélope", 9, 12, 11, 7, 12, 0, ["baile eterno", "criada"],
      "Criada da Senhora Amaris. Secretamente namorando o Príncipe Aurélio às escondidas."),
    npc("Cirilla", 8, 13, 10, 6, 12, 0, ["baile eterno", "gêmea"],
      "Gêmea de Cirillo (marca de nascença em forma de estrela no olho direito). As duas estão brigando por causa de looks combinando."),
    npc("Cirillo", 8, 13, 10, 6, 12, 0, ["baile eterno", "gêmeo"],
      "Gêmeo de Cirilla (marca de nascença em forma de estrela no olho esquerdo). Os dois estão brigando por causa de looks combinando."),
    npc("Arturo, o Trovador", 9, 15, 11, 8, 13, 0, ["baile eterno", "trovador"],
      "Curioso, Teatral, Jovial. Dá a Harpa Cantacora em troca de uma boa história para contar."),
    npc("Ilayda", 10, 13, 9, 8, 13, 0, ["baile eterno", "nobre"],
      "Egoísta, Esnobe, Impulsiva. Mantém Élton (marido de Maya) cativo por vaidade/capricho."),
    npc("Élton Élis", 8, 8, 8, 6, 10, 0, ["baile eterno", "cativo"],
      "Marido desaparecido de Maya Élis. Atordoado, Confuso, Saudoso — mantido cativo por Ilayda."),
    npc("Duquesa Jacinda", 12, 14, 14, 10, 16, 0, ["baile eterno", "corte da sombra e da melancolia", "nobre"],
      "Maldosa, Crítica, Soberba. Da Corte da Sombra e da Melancolia. Dona do brinco Brincalhetes Sussurrantes."),
    npc("Senhora Neves", 11, 12, 12, 9, 14, 0, ["baile eterno", "corte da geada e do pinheiro", "nobre"],
      "Reservada, Dedicada, Nostálgica. Da Corte da Geada e do Pinheiro. Tem um fraco secreto por presentes feitos à mão."),
    npc("Finnegan", 6, 14, 16, 6, 16, 0, ["baile eterno", "travessura"],
      "Leviano, Infantil, Impulsivo — aparenta uns 10 anos. Prendeu Ashkan numa pedra no Círculo de Cogumelos. Dono da Varinha do Capricho."),
    npc("Fazendeiro Listra-d'Olmo", 12, 8, 9, 10, 10, 0, ["vale das bagas", "fazendeiro"],
      "Dedicado, Modesto, Franco. Machucou a asa. Dá acesso às ferramentas para entrar no Ninho do Rei Rato; recompensa com Bolos de Mel e o Prendedor Borboleta."),
  ];
  newNpcs.forEach((n) => {
    if (!state.npcs.some((x) => x.nome === n.nome)) state.npcs.push(n);
  });

  const item = (nome, custo, origem, descricao, tags) => ({ id: uid(), nome, custo, origem, descricao, tags });

  const newItems = [
    // Poções à venda na loja de Rosa (Cervovale)
    item("Poção de Cura Comum", "50 pp", "Loja de Rosa (compra)", "Cura ferimentos leves.", ["cervovale", "poção", "compra"]),
    item("Poção de Cura Especial", "100 pp", "Loja de Rosa (compra) — falta um ingrediente", "Cura mais do que a versão comum. Rosa ainda não tem o ingrediente necessário pra fazer mais.", ["cervovale", "poção", "compra"]),
    item("Coragem Líquida", "100 pp", "Loja de Rosa (compra)", "Concede coragem/resistência a medo por um tempo.", ["cervovale", "poção", "compra"]),
    item("Acorda Acorda", "100 pp", "Loja de Rosa (compra) — falta um ingrediente", "Afasta o sono/cansaço. Rosa ainda não tem o ingrediente necessário pra fazer mais.", ["cervovale", "poção", "compra"]),
    item("Acuidade Felina", "150 pp", "Loja de Rosa (compra) — falta um ingrediente", "Aguça os sentidos temporariamente.", ["cervovale", "poção", "compra"]),
    item("Vínculo Mental", "200 pp", "Loja de Rosa (compra)", "Permite comunicação mental temporária entre quem bebe.", ["cervovale", "poção", "compra"]),
    item("Visão de Túnel", "200 pp", "Loja de Rosa (compra) — falta um ingrediente", "Foco extremo, ignorando distrações — mas também periféricos.", ["cervovale", "poção", "compra"]),
    item("Estátua Viva", "200 pp", "Loja de Rosa (compra)", "Transforma temporariamente quem bebe em algo com propriedades de pedra.", ["cervovale", "poção", "compra"]),
    item("Beijo da Morte", "150 pp", "Loja de Rosa (compra) — falta um ingrediente", "Poção perigosa de efeito extremo — usar com cautela.", ["cervovale", "poção", "compra"]),
    item("Névoa da Memória", "200 pp", "Loja de Rosa (compra)", "Apaga ou embaça lembranças recentes de quem bebe.", ["cervovale", "poção", "compra"]),
    // Aquisições da ferraria de Maya (Cervovale)
    item("Espada (ferraria)", "(1), d8 de dano — 20 pp", "Ferraria de Maya (compra)", "Espada comum à venda na ferraria.", ["cervovale", "arma", "compra"]),
    item("Adaga (ferraria)", "(1), d6 de dano — 10 pp", "Ferraria de Maya (compra)", "Adaga comum à venda na ferraria.", ["cervovale", "arma", "compra"]),
    item("Machado de Batalha", "(2), d10 de dano — 20 pp", "Ferraria de Maya (compra)", "Machado pesado à venda na ferraria.", ["cervovale", "arma", "compra"]),
    item("Frigideira", "(1), d4 de dano — 10 pp", "Ferraria de Maya (compra)", "Serve como arma improvisada e como panela.", ["cervovale", "arma", "compra"]),
    item("Mangual", "(1), d6 de dano — 20 pp", "Ferraria de Maya (compra)", "Arma de corrente à venda na ferraria.", ["cervovale", "arma", "compra"]),
    item("Escudo (ferraria)", "(2) — 30 pp", "Ferraria de Maya (compra)", "Escudo comum à venda na ferraria.", ["cervovale", "equipamento", "compra"]),
    item("Armadura Pesada", "(2) — 50 pp", "Ferraria de Maya (compra)", "Armadura pesada à venda na ferraria.", ["cervovale", "equipamento", "compra"]),
    // Itens maravilhosos genéricos (livro básico) que faltavam
    item("Bolotas Robustas", "—", "Itens maravilhosos (livro básico)", "Bolotas que crescem rapidamente em algo útil quando plantadas — detalhes a critério da Mestra.", ["item maravilhoso"]),
    item("Lamparina Reveladora", "—", "Itens maravilhosos (livro básico)", "Sua luz revela algo escondido (ilusões, portas secretas, magia) quando aceso.", ["item maravilhoso"]),
    item("Pó de Fada", "—", "Itens maravilhosos (livro básico)", "Pó mágico com um pequeno efeito feérico — detalhes a critério da Mestra.", ["item maravilhoso"]),
    item("Cola Excelente", "—", "Itens maravilhosos (livro básico)", "Gruda quase qualquer coisa permanentemente.", ["item maravilhoso"]),
    item("Feijões Mágicos", "—", "Itens maravilhosos (livro básico)", "Ao plantar, crescem em algo definido por uma tabela d6 própria — a critério da Mestra.", ["item maravilhoso"]),
    item("Pulseiras da Amizade", "—", "Itens maravilhosos (livro básico)", "Par de pulseiras que ligam duas pessoas de alguma forma mágica menor — detalhes a critério da Mestra.", ["item maravilhoso"]),
    item("Corda de Escalada (genérica)", "—", "Itens maravilhosos (livro básico)", "Corda comum de boa qualidade (não confundir com a Corda de Escalada Encantada de Selene).", ["item maravilhoso"]),
    // Armas encantadas genéricas (livro básico) que faltavam
    item("Espada dos Antepassados", "(1 DD)", "Armas encantadas (livro básico)", "Ao gastar o Dado de Dom, invoca o espírito de um ancestral para ajudar em combate.", ["item mágico", "arma"]),
    item("Lâmina Vorpal", "d10 de dano", "Armas encantadas (livro básico)", "Acerto crítico em 1 ou 2 (causa d10+10 de dano). Tem 3 em 6 de chance de se estilhaçar após um crítico.", ["item mágico", "arma"]),
    item("Espada Cantante", "(1 DD)", "Armas encantadas (livro básico)", "Ao gastar o Dado de Dom, dá vantagem em testes para todo o grupo por um tempo.", ["item mágico", "arma"]),
  ];
  newItems.forEach((i) => {
    if (!state.items.some((x) => x.nome === i.nome)) state.items.push(i);
  });

  const note = (titulo, categoria, texto) => ({ id: uid(), titulo, categoria, texto });

  const newNotes = [
    note("O Dado de Maldição (Cervovale)", "regras",
      "Relógio de fundo da campanha em Cervovale: role um Dado de Maldição uma vez por dia (começa em d8). Se tirar 1, mais um morador da vila sucumbe completamente à maldição (vira doce por completo) E o dado encolhe um degrau (d8 → d6 → d4), ficando em d4 dali em diante. Use isso pra criar pressão de tempo — quanto mais a Mestra deixa passar dias sem as Princesas agirem, maior a chance (e mais rápido o relógio anda) da vila piorar."),
    note("Progressão de nível — Doce Vingança", "regras",
      "Nesta aventura, as Princesas sobem de nível cada vez que recuperam um dos três itens ligados à maldição de Dulcineia (a Cauda do Rei Rato, o Anel do Rei-Elfo, o Pingente Rouba-Alma) — não seguindo XP ou marcos genéricos do livro básico.\n\nAo subir de nível, uma Princesa ganha: a próxima habilidade do seu Dom, +1 no máximo de Dados de Dom, +d4 no Coração máximo, +1 no máximo de Dados de Coração, e pode tentar rerrolar uma Virtude (mantendo o novo valor só se for maior)."),
    note("Recompensas iniciais de Teodoro (d4)", "achados",
      "Antes mesmo da missão de levantar o moral da vila, Teodoro oferece uma recompensa só por aceitar ajudar Cervovale — role d4 ou escolha:\n1. 400 pp\n2. A escritura de um chalé\n3. Uma apresentação a um monarca\n4. Um artefato misterioso"),
    note("Terceiro gancho — Aparições Estranhas", "lore",
      "Gancho alternativo (além do grito na floresta e de Doces Sonhos): uma nobre contrata o grupo para investigar avistamentos estranhos de criaturas de doce nas redondezas — um jeito de puxar Princesas mais ligadas à nobreza/alta sociedade para dentro da aventura."),
    note("Itens Quebrados de Zeca (d6)", "achados",
      "Objetos que Zeca pede para consertar em troca da Luneta Feérica — role d6 ou escolha:\n1. Roca de fiar\n2. Relógio de pêndulo\n3. Tapeçaria rasgada\n4. Alaúde sem cordas\n5. Botas de couro estragadas\n6. Tabuleiro de xadrez incompleto"),
    note("Gerador de Fada Alta (Lago da Saudade Eterna)", "achados",
      "Pra gerar uma fada alta rapidamente:\n\nTRAÇO FÍSICO (d6)\n1. Cabelo que muda de cor com o humor\n2. Pinta em forma de coração\n3. Língua bifurcada\n4. Criatura peluda enrolada no pescoço\n5. Um braço de cristal\n6. Tatuagem de aranha viva\n\nNOME (d6) — combine com um sobrenome feérico à sua escolha, ou use como primeiro nome direto: role e adapte ao gênero/personalidade da fada."),
    note("Animais Companheiros do Bosque Emaranhado (d20)", "achados",
      "Gerador rápido de animal companheiro (Amizade Poderosa ou similar) — role d20:\n1. Cotovia — Canto Brilhante\n2. Raposa — Focinho Molhado\n3. Urso Pardo — Sono Pesado\n4. Pica-pau — Bico de Pederneira\n5. Víbora — Escama da Perdição\n6. Coruja — Olhos Estrelados\n7-20. (mais opções no livro básico — complete com nomes temáticos parecidos quando precisar de mais variedade)"),
    note("Nomes de Convidadas do Baile Eterno (d6)", "achados",
      "Pra nomear rapidamente uma convidada genérica do baile — role d6: Luncina, Baco, Safira, Tristrão, Ozias, Calíope."),
    note("Frases exatas da aventura", "lore",
      "ENIGMA DO ESPELHO MALÉFICO (texto completo do poema): \"Para quebrar a maldição e ter êxito... ou verão que a vingança é doce como canapés.\" (verso completo no livro — use pra ler em voz alta na hora certa.)\n\nMALDIÇÃO FINAL DE DULCINEIA (ao morrer/ser derrotada, cite palavra por palavra): \"Minha magia vai infectar a terra...\""),
    note("Itens na Teia de Aranha (d4) — Caverna opcional", "achados",
      "Loot da caverna com a Aranha Gigante de Algodão-Doce — role d4:\n1. Mochila com uma poção de Vínculo Mental + 20 pp\n2. Martelo de Guerra (2)(d10) que emite uma luz fraca\n3. Pergaminho/selo com o feitiço Puf!\n4. Bolsa com odres vazios e rações mofadas"),
  ];
  newNotes.forEach((n) => {
    if (!state.notes.some((x) => x.titulo === n.titulo)) state.notes.push(n);
  });

  // Ajustes em dados que já existiam (origem errada / lore faltando) — só aplica se o
  // texto novo ainda não estiver lá, pra nunca duplicar em quem já recebeu essa correção.
  const botasAndarilhas = state.items.find((i) => i.nome === "Botas Andarilhas");
  if (botasAndarilhas && botasAndarilhas.origem === "Livro básico — itens mágicos") {
    botasAndarilhas.origem = "Recompensa de Connie Oriente — ajudar a mandar notícias pra família dela";
  }

  const selene = state.npcs.find((n) => n.nome === "Selene (Lobo Mau)");
  if (selene && !selene.notas.includes("Agilidade Feérica")) {
    selene.notas += " Tem todas as habilidades de uma Princesa de Agilidade Feérica de Nível 3. Infiltrou-se na torre pelo esgoto antes de atacar, quando a bruxa estava fora.";
  }

  const hannah = state.npcs.find((n) => n.nome === "Hannah Falcão");
  if (hannah && !hannah.notas.includes("Acorda Acorda")) {
    hannah.notas += " Missão: repor o estoque de Acorda Acorda -> recompensa: Máscara de Baile.";
  }

  const connie = state.npcs.find((n) => n.nome === "Constança \"Connie\" Oriente");
  if (connie && !connie.notas.includes("Botas Andarilhas")) {
    connie.notas += " Missão: mandar notícias para a família dela -> recompensa: Botas Andarilhas.";
  }
}

seedCampaignData();
seedRulesReference();
seedItems();
seedFullAdventureText();
seedExtraLoot();
seedMoreMonsters();
seedBaileENotas();
saveState();

// ---------- Tabs ----------
// Posição dos marcadores, mapa ativo e visibilidade pras jogadoras vivem num documento
// separado e pequeno no Firestore (veja firebase-config.js). Arrastar um marcador só
// escreve nesse documento pequeno — nunca reenvia a campanha inteira (NPCs, itens, texto
// da aventura...), que é o que deixava o mapa lento/impraticável de usar ao vivo.
function buildTokenPositions() {
  const out = {};
  state.maps.forEach((m) => {
    out[m.id] = {};
    m.tokens.forEach((t) => {
      out[m.id][t.id] = { x: t.x, y: t.y };
    });
  });
  return out;
}

function applyTokenPositions(tokenPositions) {
  if (!tokenPositions) return;
  state.maps.forEach((m) => {
    const posForMap = tokenPositions[m.id];
    if (!posForMap) return;
    m.tokens.forEach((t) => {
      const p = posForMap[t.id];
      if (p) {
        t.x = p.x;
        t.y = p.y;
      }
    });
  });
}

async function pushLiveOnly() {
  const mod = await getCloudModule();
  if (!mod) return;
  await mod.saveLiveState({
    tokenPositions: buildTokenPositions(),
    activeMapId: state.activeMapId,
    mapaVisivelJogadores: state.mapaVisivelJogadores,
  });
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "mapa") {
      const map = state.maps.find((m) => m.id === state.activeMapId);
      if (map && map.largura && map.altura) sizeCanvasToRatio(mapCanvas, map.largura, map.altura, 0.7);
    }
  });
});

// ---------- Subtabs (Compendio) ----------
document.querySelectorAll(".subtab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".subtab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".subtab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("subtab-" + btn.dataset.subtab).classList.add("active");
    if (btn.dataset.subtab === "locais") renderLocationView();
  });
});

// ---------- Close modal (X) ----------
document.querySelectorAll(".js-close-modal").forEach((btn) => {
  btn.addEventListener("click", () => {
    btn.closest(".modal-overlay").classList.add("hidden");
  });
});

// ---------- Fechar modais clicando no fundo escuro ----------
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target !== overlay) return;
    overlay.classList.add("hidden");
    const form = overlay.querySelector("form");
    if (form) form.reset();
    if (overlay.id === "modal-token" && pendingNewTokenId) {
      const map = activeMap();
      if (map) {
        map.tokens = map.tokens.filter((t) => t.id !== pendingNewTokenId);
        saveState();
        renderMap();
      }
      pendingNewTokenId = null;
    }
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
      state = Object.assign(defaultState(), imported);
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

// ---------- helpers ----------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ==================== Alertas Visuais (Toasts) ====================
function showToast(message, type = "info", icon = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="icon">${icon}</span> ${escapeHtml(message)}`;
  container.appendChild(toast);
  
  // Some sozinho depois de 3 segundos
  setTimeout(() => {
    toast.classList.add("toast-leave");
    toast.addEventListener("animationend", () => toast.remove());
  }, 3000);
}

// ==================== Glossário de magias, habilidades e traços ====================
const GLOSSARY = {
  "Puf!": "Alcance [DADOS]. Teleporte-se em uma nuvem de fumaça para um lugar que você consiga ver. Pode ser lançada como uma Reação.",
  "Jato de Purpurina": "Alcance Por Perto, Salvamento Astúcia. Dispara uma chuva de purpurina mágica colorida; até [SOMA] criaturas ficam atordoadas por [DADOS] rodadas.",
  "Animar": "[DADOS] objetos Por Perto ganham vida e obedecem a seus comandos da melhor forma possível por [SOMA] minutos.",
  "Enredar": "Alcance [DADOS], Salvamento Astúcia. Segura magicamente [DADOS] criaturas ou objetos no lugar por até [SOMA] minutos.",
  "Escorregadia": "Alcance [DADOS], Salvamento Graça. Uma área fica coberta por uma graxa extremamente escorregadia por [SOMA] rodadas.",
  "É Meu!": "Alcance [DADOS], Salvamento Determinação. Até [DADOS] objetos que você consiga ver movem-se instantaneamente para sua mão.",
  "Abrir/Trancar": "Alcance Por Perto. [DADOS] portas abrem-se com uma batida alta, ou [DADOS] portas fecham-se e são seladas magicamente por [SOMA] horas.",
  "Luz/Trevas": "Alcance Por Perto. Um objeto tocado emite uma esfera de luz ou de trevas, afetando tudo Por Perto, por [DADOS] horas.",
  "Disfarce": "Alcance À Mão, Salvamento Astúcia. Altera a aparência de [DADOS] criaturas por [SOMA] x 10 minutos para outra forma humanoide.",
  "Flutuar": "Alcance Pessoal. Flutue e voe em qualquer direção tão rápido quanto conseguir correr, por [SOMA] rodadas, depois cai suave e seguramente.",
  "De Volta para a Cama": "Alcance Por Perto. [DADOS] criaturas mortas-vivas, despertadas ou animadas devem fazer um Salvamento ou retornam ao seu estado dormente.",
  "Treco Mágico": "Alcance À Mão. [DADOS] desenhos de objetos simples que você faz se tornam reais por [SOMA] minutos.",
  "Mão Amiga": "Alcance [DADOS]. Invoca uma mão etérea que ajuda por [DADOS] minutos. Não pode lutar ou carregar mais que um item leve.",
  "Bolha": "Uma bolha mágica de proteção envolve uma criatura e aumenta seu valor de Armadura em [DADOS] por [SOMA] rodadas. Pode ser lançada como Reação.",
  "Emaranhado": "Alcance A Uma Pedrada, Salvamento Determinação. Vinhas pegajosas prendem as criaturas dentro da área por [SOMA] rodadas.",
  "Aceleração": "Alcance A Uma Pedrada. Uma criatura dobra de velocidade por [SOMA] rodadas, ganhando uma Ação e uma Reação extra por rodada. Fica Cansada quando o efeito termina.",
  "Bola de Fogo": "Alcance A Uma Pedrada, Salvamento Graça. Bola de fogo que causa [SOMA] de dano em área, ou metade com um Salvamento bem-sucedido.",
  "Névoa": "Versão elemental de Dulcineia: nuvem sufocante de pó de canela que preenche uma área, mecanicamente como uma magia de nevoeiro/ocultação.",
  "Restauração": "Cura ferimentos e Aflições — geralmente restaura Pontos Coração ou remove uma Aflição/Maldição menor de quem recebe o efeito.",
  "Hipnotizar": "Deixa uma criatura sujeita a sugestões simples enquanto durar o efeito; geralmente pede um Salvamento para resistir.",
  "Amarrar": "Prende magicamente uma criatura ou objeto no lugar, similar a Enredar.",
  "Medo": "Alcance Por Perto, Salvamento Astúcia. [SOMA] alvos têm visões de seus medos mais profundos e fogem de quem lançou, a menos que passem no Salvamento.",
  "Drenar": "Alcance À Mão, Salvamento Determinação. Drena a vida de uma criatura e cura [SOMA] PC de quem lançou, a menos que o alvo passe no Salvamento.",
  "Afligir": "Alcance Por Perto, Salvamento Determinação. [DADOS] alvos sofrem dores e devem passar no Salvamento ou largam o que seguram e ficam Atordoadas por [SOMA] rodadas.",
  "Dardo Mágico": "Um projétil de energia mágica que acerta automaticamente, causando dano direto ao alvo.",
  "Rugido": "Você solta um rugido bestial. [SOMA] criaturas que possam ouvi-la devem fazer um Salvamento ou ficam aterrorizadas por [DADOS] rodadas.",
  "Farejar": "Sente até o mais fraco traço de cheiro Por Perto; reconhece indivíduos e há quanto tempo estiveram no local.",
  "Forma Selvagem": "Transforma-se num animal já visto por até [DADOS] x 10 minutos, com [SOMA] PC nessa forma.",
  "Virar Sapo": "Alcance Por Perto. [DADOS] objetos inanimados se transformam em sapo por [SOMA] horas.",
  "Encolher": "Alcance Por Perto, Salvamento Determinação. [SOMA] alvos diminuem até o tamanho de camundongos, junto com tudo o que estiverem vestindo ou carregando, por [DADOS] horas. Alvos relutantes que falharem no Salvamento podem tentar de novo depois de uma rodada.",
  "Maldição Doce": "Maldição em 4 estágios que transforma gradualmente a vítima em confeitaria; só é curada quebrando a maldição por completo. Veja a nota 'Maldição Doce — tabela completa' na Campanha.",
  "Suscetível a derretimento": "Ataques baseados em calor ou água ignoram a Armadura dessa criatura, e exposição a calor extremo pode derretê-la (perde d4 de PC máximo).",
};

const GLOSSARY_KEYS_SORTED = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);

// ==================== O NOVO SUPER LINKIFIER (Poderes e NPCs) ====================
function linkifyText(rawText) {
  if (!rawText) return "";
  let result = "";
  let i = 0;
  // Ordena poderes e NPCs do maior nome pro menor, pra não bugar palavras compostas
  const npcNames = state.npcs.map(n => n.nome).sort((a,b) => b.length - a.length);
  
  outer: while (i < rawText.length) {
    // 1. Checa se é um poder/regra
    for (const term of GLOSSARY_KEYS_SORTED) {
      if (rawText.startsWith(term, i)) {
        result += `<span class="ability-link" data-ability="${escapeHtml(term)}">${escapeHtml(term)}</span>`;
        i += term.length;
        continue outer;
      }
    }
    // 2. Checa se é o nome de um NPC ou Monstro
    for (const name of npcNames) {
      if (name.length > 2 && rawText.startsWith(name, i)) {
        result += `<span class="npc-link" data-npc="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
        i += name.length;
        continue outer;
      }
    }
    // 3. Letra normal
    result += escapeHtml(rawText[i]);
    i++;
  }
  return result;
}

// ==================== LÓGICA DAS JANELAS FLUTUANTES DE LEITURA ====================
// Cada nota aberta ganha sua própria janela, então dá pra deixar várias abertas ao
// mesmo tempo (ex.: comparar duas fichas de regras, ou lore + aventura lado a lado).
const floatingNotesContainer = document.getElementById("floating-notes-container");
const openFloatingNotes = new Map(); // noteId -> elemento da janela
let floatingZTop = 500;

function bringFloatingToFront(win) {
  floatingZTop += 1;
  win.style.zIndex = floatingZTop;
}

function closeFloatingNote(noteId) {
  const win = openFloatingNotes.get(noteId);
  if (!win) return;
  win.remove();
  openFloatingNotes.delete(noteId);
}

function makeFloatingDraggable(win, header) {
  let isDragging = false, dragX, dragY;
  header.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    isDragging = true;
    bringFloatingToFront(win);
    const rect = win.getBoundingClientRect();
    dragX = e.clientX - rect.left;
    dragY = e.clientY - rect.top;
  });
  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    win.style.left = (e.clientX - dragX) + "px";
    win.style.top = (e.clientY - dragY) + "px";
    win.style.right = "auto"; // Tira o ancoramento da direita
  });
  document.addEventListener("mouseup", () => { isDragging = false; });
}



// ==================== LÓGICA DO TOOLTIP E CLIQUE NOS NPCs ====================
const tooltip = document.getElementById("tooltip-pop");

// Hover (Passar o mouse) nas Regras/Poderes
document.addEventListener("mouseover", (e) => {
  const link = e.target.closest(".ability-link");
  if (link && tooltip) {
    const term = link.dataset.ability;
    tooltip.innerHTML = `<h4>${term}</h4>${GLOSSARY[term] || "Sem descrição."}`;
    const rect = link.getBoundingClientRect();
    
    // Posiciona no centro da palavra
    tooltip.style.left = (rect.left + rect.width / 2) + "px";
    tooltip.style.top = rect.top + "px";
    tooltip.classList.remove("hidden");
  }
});

document.addEventListener("mouseout", (e) => {
  const link = e.target.closest(".ability-link");
  if (link && tooltip) {
    tooltip.classList.add("hidden");
  }
});

// Clicar no nome de um Personagem para pular pra ficha dele
document.addEventListener("click", (e) => {
  const npcLink = e.target.closest(".npc-link");
  if (npcLink) {
    const name = npcLink.dataset.npc;
    // Pula para a aba Compêndio
    document.querySelector('[data-tab="compendio"]').click();
    // Pula para a sub-aba de NPCs
    document.querySelector('[data-subtab="npcs"]').click();
    // Escreve o nome dele na busca e renderiza
    document.getElementById("npc-search").value = name;
    renderNpcs();
  }
});

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function parseTags(str) {
  return str.split(",").map((t) => t.trim()).filter(Boolean);
}

function fileToResizedDataUrl(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Igual a fileToResizedDataUrl, mas também devolve a proporção real da imagem —
// usado no mapa para o quadro sempre respeitar a forma da imagem (e não da tela),
// garantindo que a posição dos marcadores bata entre o computador e o celular.
function fileToResizedImageWithSize(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.82), width, height });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function setupPhotoInput(inputId, previewId, onChange) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    const localDataUrl = await fileToResizedDataUrl(file, 300);
    preview.src = localDataUrl;
    preview.classList.remove("hidden");
    const url = await uploadToCloudinary(localDataUrl);
    onChange(url || localDataUrl);
  });
}

function showPhotoPreview(previewId, dataUrl) {
  const preview = document.getElementById(previewId);
  if (dataUrl) {
    preview.src = dataUrl;
    preview.classList.remove("hidden");
  } else {
    preview.src = "";
    preview.classList.add("hidden");
  }
}

function dieTrack(total, used, dataAttr, id) {
  let html = `<div class="dice-track">`;
  for (let i = 0; i < total; i++) {
    const filled = i < used;
    html += `<span class="dice-pip ${filled ? "filled" : ""}" data-${dataAttr}="${id}" data-index="${i}"></span>`;
  }
  html += `</div>`;
  return html;
}

// ==================== NPCs ====================
const npcModal = document.getElementById("modal-npc");
const formNpc = document.getElementById("form-npc");
let currentNpcFoto = null;
setupPhotoInput("npc-foto", "npc-foto-preview", (url) => { currentNpcFoto = url; });

function openNpcModal(npc, defaultTipo) {
  document.getElementById("npc-modal-title").textContent = npc ? "Editar NPC/Monstro" : "Novo NPC/Monstro";
  document.getElementById("npc-id").value = npc ? npc.id : "";
  document.getElementById("npc-nome").value = npc ? npc.nome : "";
  document.getElementById("npc-foto").value = "";
  currentNpcFoto = npc ? npc.foto || null : null;
  showPhotoPreview("npc-foto-preview", currentNpcFoto);
  document.getElementById("npc-tipo").value = npc ? npc.tipo : (defaultTipo || "NPC");
  document.getElementById("npc-determinacao").value = npc ? npc.determinacao : 10;
  document.getElementById("npc-graca").value = npc ? npc.graca : 10;
  document.getElementById("npc-astucia").value = npc ? npc.astucia : 10;
  document.getElementById("npc-coracao").value = npc ? npc.coracao : 10;
  document.getElementById("npc-salvamento").value = npc ? npc.salvamento : 10;
  document.getElementById("npc-armadura").value = npc ? npc.armadura : 0;
  document.getElementById("npc-tags").value = npc ? npc.tags.join(", ") : "";
  document.getElementById("npc-notas").value = npc ? npc.notas : "";
  npcModal.classList.remove("hidden");
}

function closeNpcModal() { npcModal.classList.add("hidden"); formNpc.reset(); }

document.getElementById("btn-add-npc").addEventListener("click", () => openNpcModal(null));
document.getElementById("btn-add-monster").addEventListener("click", () => openNpcModal(null, "Monstro"));
document.getElementById("btn-cancel-npc").addEventListener("click", closeNpcModal);

formNpc.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("npc-id").value;
  const data = {
    id: id || uid(),
    nome: document.getElementById("npc-nome").value.trim(),
    tipo: document.getElementById("npc-tipo").value,
    determinacao: Number(document.getElementById("npc-determinacao").value) || 0,
    graca: Number(document.getElementById("npc-graca").value) || 0,
    astucia: Number(document.getElementById("npc-astucia").value) || 0,
    coracao: Number(document.getElementById("npc-coracao").value) || 0,
    salvamento: Number(document.getElementById("npc-salvamento").value) || 0,
    armadura: Number(document.getElementById("npc-armadura").value) || 0,
    tags: parseTags(document.getElementById("npc-tags").value),
    notas: document.getElementById("npc-notas").value.trim(),
    foto: currentNpcFoto,
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

function rollAttrBtn(entityName, label, value) {
  return `<button type="button" class="roll-attr" data-roll-name="${escapeHtml(entityName)}" data-roll-label="${escapeHtml(label)}" data-roll-value="${value}">${value}</button>`;
}

function npcCardHtml(n) {
  const isMonster = n.tipo === "Monstro";
  const statBlock = isMonster
    ? `
      <div class="stat-box"><span>Coração</span><b>${n.coracao}</b></div>
      <div class="stat-box"><span>Salvamento</span>${rollAttrBtn(n.nome, "Salvamento", n.salvamento)}</div>
      <div class="stat-box"><span>Armadura</span><b>${n.armadura}</b></div>
    `
    : `
      <div class="stat-box"><span>Determinação</span>${rollAttrBtn(n.nome, "Determinação", n.determinacao)}</div>
      <div class="stat-box"><span>Graça</span>${rollAttrBtn(n.nome, "Graça", n.graca)}</div>
      <div class="stat-box"><span>Astúcia</span>${rollAttrBtn(n.nome, "Astúcia", n.astucia)}</div>
      <div class="stat-box"><span>Coração</span><b>${n.coracao}</b></div>
      <div class="stat-box"><span>Salvamento</span>${rollAttrBtn(n.nome, "Salvamento", n.salvamento)}</div>
      <div class="stat-box"><span>Armadura</span><b>${n.armadura}</b></div>
    `;
  return `
    <div class="npc-card">
      <div class="card-header-row">
        ${n.foto ? `<img class="avatar" src="${n.foto}" alt="${escapeHtml(n.nome)}">` : ""}
        <div class="npc-card-header">
          <h3>${escapeHtml(n.nome)}</h3>
          <span class="npc-type-badge">${escapeHtml(n.tipo)}</span>
        </div>
      </div>
      <div class="npc-stat-grid ${isMonster ? "monster" : ""}">${statBlock}</div>
      ${n.tags.length ? `<div class="npc-tags">${n.tags.map((t) => `<button type="button" class="npc-tag" data-tag-filter="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}</div>` : ""}
      ${n.notas ? `<div class="npc-section-label">Ataques &amp; notas</div><div class="npc-notes">${linkifyText(n.notas)}</div>` : ""}
      <div class="npc-card-actions">
        <button class="btn btn-ghost" data-edit-npc="${n.id}">Editar</button>
        <button class="btn btn-danger" data-delete-npc="${n.id}">Excluir</button>
      </div>
    </div>
  `;
}

function renderNpcs() {
  const npcListEl = document.getElementById("npc-list");
  const monsterListEl = document.getElementById("monster-list");
  const query = document.getElementById("npc-search").value.trim().toLowerCase();
  const matches = (n) =>
    !query || n.nome.toLowerCase().includes(query) || n.tags.some((t) => t.toLowerCase().includes(query));

  const npcs = state.npcs.filter((n) => n.tipo !== "Monstro" && matches(n));
  const monsters = state.npcs.filter((n) => n.tipo === "Monstro" && matches(n));

  npcListEl.innerHTML = npcs.length
    ? npcs.map(npcCardHtml).join("")
    : emptyState("person_search", "Nenhum NPC ou aliado encontrado.");
  monsterListEl.innerHTML = monsters.length
    ? monsters.map(npcCardHtml).join("")
    : emptyState("pest_control", "Nenhum monstro encontrado.");

  [npcListEl, monsterListEl].forEach((list) => {
    list.querySelectorAll("[data-edit-npc]").forEach((btn) =>
      btn.addEventListener("click", () => openNpcModal(state.npcs.find((n) => n.id === btn.dataset.editNpc)))
    );
    list.querySelectorAll("[data-delete-npc]").forEach((btn) =>
      btn.addEventListener("click", () => deleteNpc(btn.dataset.deleteNpc))
    );
  });
}

document.getElementById("npc-search").addEventListener("input", renderNpcs);

// ==================== Itens ====================
const itemModal = document.getElementById("modal-item");
const formItem = document.getElementById("form-item");

function openItemModal(item) {
  document.getElementById("item-modal-title").textContent = item ? "Editar item" : "Novo item";
  document.getElementById("item-id").value = item ? item.id : "";
  document.getElementById("item-nome").value = item ? item.nome : "";
  document.getElementById("item-custo").value = item ? item.custo : "";
  document.getElementById("item-origem").value = item ? item.origem : "";
  document.getElementById("item-descricao").value = item ? item.descricao : "";
  document.getElementById("item-tags").value = item ? item.tags.join(", ") : "";
  itemModal.classList.remove("hidden");
}

function closeItemModal() { itemModal.classList.add("hidden"); formItem.reset(); }

document.getElementById("btn-add-item").addEventListener("click", () => openItemModal(null));
document.getElementById("btn-cancel-item").addEventListener("click", closeItemModal);

formItem.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("item-id").value;
  const data = {
    id: id || uid(),
    nome: document.getElementById("item-nome").value.trim(),
    custo: document.getElementById("item-custo").value.trim(),
    origem: document.getElementById("item-origem").value.trim(),
    descricao: document.getElementById("item-descricao").value.trim(),
    tags: parseTags(document.getElementById("item-tags").value),
  };
  if (id) {
    const idx = state.items.findIndex((i) => i.id === id);
    state.items[idx] = data;
  } else {
    state.items.push(data);
  }
  saveState();
  closeItemModal();
  renderItems();
});

function deleteItem(id) {
  if (!confirm("Excluir este item?")) return;
  state.items = state.items.filter((i) => i.id !== id);
  saveState();
  renderItems();
}

function itemCardHtml(i) {
  return `
    <div class="npc-card">
      <div class="npc-card-header">
        <h3>${escapeHtml(i.nome)}</h3>
        ${i.custo ? `<span class="npc-type-badge">${escapeHtml(i.custo)}</span>` : ""}
      </div>
      ${i.origem ? `<div class="npc-notes"><b>Origem:</b> ${escapeHtml(i.origem)}</div>` : ""}
      <div class="npc-notes">${linkifyText(i.descricao)}</div>
      ${i.tags.length ? `<div class="npc-tags">${i.tags.map((t) => `<button type="button" class="npc-tag" data-tag-filter="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}</div>` : ""}
      <div class="npc-card-actions">
        <button class="btn btn-ghost" data-share-text="item" data-share-id="${i.id}">${isTextShared("item", i.id) ? "Esconder" : "Mostrar aos jogadores"}</button>
        <button class="btn btn-ghost" data-edit-item="${i.id}">Editar</button>
        <button class="btn btn-danger" data-delete-item="${i.id}">Excluir</button>
      </div>
    </div>
  `;
}

function renderItems() {
  const list = document.getElementById("item-list");
  const query = document.getElementById("item-search").value.trim().toLowerCase();
  const filtered = state.items.filter((i) => {
    if (!query) return true;
    return (
      i.nome.toLowerCase().includes(query) ||
      i.descricao.toLowerCase().includes(query) ||
      i.tags.some((t) => t.toLowerCase().includes(query))
    );
  });
  list.innerHTML = filtered.length
    ? filtered.map(itemCardHtml).join("")
    : emptyState("backpack", "Nenhum item encontrado.");

  list.querySelectorAll("[data-edit-item]").forEach((btn) =>
    btn.addEventListener("click", () => openItemModal(state.items.find((i) => i.id === btn.dataset.editItem)))
  );
  list.querySelectorAll("[data-delete-item]").forEach((btn) =>
    btn.addEventListener("click", () => deleteItem(btn.dataset.deleteItem))
  );
}

document.getElementById("item-search").addEventListener("input", renderItems);

// ==================== Imagens (handouts para jogadores) ====================
document.getElementById("handout-upload").addEventListener("change", async () => {
  const input = document.getElementById("handout-upload");
  const file = input.files[0];
  if (!file) return;
  const nome = prompt("Nome da imagem:", file.name.replace(/\.[^.]+$/, "")) || "Imagem";
  const dataUrl = await fileToResizedDataUrl(file, 1400);
  const url = await uploadToCloudinary(dataUrl);
  state.imagens.push({ id: uid(), nome, imagem: url || dataUrl });
  saveState();
  renderHandouts();
  input.value = "";
});

function toggleHandoutVisible(id) {
  state.handoutAtivoId = state.handoutAtivoId === id ? null : id;
  saveState();
  renderHandouts();
}

function deleteHandout(id) {
  if (!confirm("Excluir esta imagem?")) return;
  state.imagens = state.imagens.filter((h) => h.id !== id);
  if (state.handoutAtivoId === id) state.handoutAtivoId = null;
  saveState();
  renderHandouts();
}

function renderHandouts() {
  const list = document.getElementById("handout-list");
  if (state.imagens.length === 0) {
    list.innerHTML = emptyState("photo_library", "Nenhuma imagem enviada ainda.");
    return;
  }
  list.innerHTML = state.imagens
    .map((h) => {
      const isShowing = state.handoutAtivoId === h.id;
      return `
    <div class="npc-card">
      <img src="${h.imagem}" alt="${escapeHtml(h.nome)}" style="width:100%; border-radius:12px; object-fit:cover; max-height:220px;">
      <h3 style="margin:6px 0 0; color:var(--accent-deep); font-size:1.05rem;">${escapeHtml(h.nome)}</h3>
      ${isShowing ? `<span class="npc-type-badge" style="background:var(--success); color:#0d3a26; border-color:var(--success);">Mostrando aos jogadores</span>` : ""}
      <div class="npc-card-actions">
        <button class="btn ${isShowing ? "btn-danger" : "btn-primary"}" data-toggle-handout="${h.id}">${isShowing ? "Esconder" : "Mostrar aos jogadores"}</button>
        <button class="btn btn-ghost" data-delete-handout="${h.id}">Excluir</button>
      </div>
    </div>
  `;
    })
    .join("");
  list.querySelectorAll("[data-toggle-handout]").forEach((btn) =>
    btn.addEventListener("click", () => toggleHandoutVisible(btn.dataset.toggleHandout))
  );
  list.querySelectorAll("[data-delete-handout]").forEach((btn) =>
    btn.addEventListener("click", () => deleteHandout(btn.dataset.deleteHandout))
  );
}

// ==================== Locais (visão cruzada por local) ====================
const LOCATIONS = [
  { tag: "cervovale", label: "Cervovale" },
  { tag: "bosque emaranhado", label: "Bosque Emaranhado" },
  { tag: "vale das bagas", label: "Vale das Bagas" },
  { tag: "baile eterno", label: "Baile Eterno" },
  { tag: "torre da bruxa", label: "Torre da Bruxa" },
];
let activeLocation = LOCATIONS[0].tag;

function renderLocationPicker() {
  const picker = document.getElementById("location-picker");
  picker.innerHTML = LOCATIONS.map(
    (l) => `<button class="location-btn ${l.tag === activeLocation ? "active" : ""}" data-loc="${l.tag}">${l.label}</button>`
  ).join("");
  picker.querySelectorAll("[data-loc]").forEach((btn) =>
    btn.addEventListener("click", () => {
      activeLocation = btn.dataset.loc;
      renderLocationPicker();
      renderLocationView();
    })
  );
}

function renderLocationView() {
  const content = document.getElementById("location-content");
  const npcs = state.npcs.filter((n) => n.tags.includes(activeLocation) && n.tipo !== "Monstro");
  const monsters = state.npcs.filter((n) => n.tags.includes(activeLocation) && n.tipo === "Monstro");
  const items = state.items.filter((i) => i.tags.includes(activeLocation));
  const locationLabel = LOCATIONS.find((l) => l.tag === activeLocation).label;
  const notes = state.notes.filter(
    (n) => n.titulo.toLowerCase().includes(locationLabel.toLowerCase()) || n.texto.toLowerCase().includes(activeLocation)
  );

  content.innerHTML = `
    <div class="location-section-title">NPCs &amp; Aliados</div>
    <div class="card-grid">${npcs.length ? npcs.map(npcCardHtml).join("") : emptyState("person_search", "Nenhum NPC marcado com esse local ainda.")}</div>
    <div class="location-section-title">Monstros</div>
    <div class="card-grid">${monsters.length ? monsters.map(npcCardHtml).join("") : emptyState("pest_control", "Nenhum monstro marcado com esse local ainda.")}</div>
    <div class="location-section-title">Itens</div>
    <div class="card-grid">${items.length ? items.map(itemCardHtml).join("") : emptyState("backpack", "Nenhum item marcado com esse local ainda.")}</div>
    <div class="location-section-title">Notas relacionadas</div>
    <div class="session-list">${
      notes.length
        ? notes
            .map(
              (n) => `
      <div class="session-card">
        <div class="session-card-header"><h3>${escapeHtml(n.titulo)}</h3></div>
        <p class="session-text note-collapsed">${escapeHtml(n.texto)}</p>
        <div class="session-card-actions">
          <button class="btn btn-ghost" data-open-note="${n.id}">Ver / editar</button>
        </div>
      </div>`
            )
            .join("")
        : emptyState("auto_stories", "Nenhuma nota encontrada para esse local.")
    }</div>
  `;

  content.querySelectorAll("[data-edit-npc]").forEach((btn) =>
    btn.addEventListener("click", () => openNpcModal(state.npcs.find((n) => n.id === btn.dataset.editNpc)))
  );
  content.querySelectorAll("[data-delete-npc]").forEach((btn) =>
    btn.addEventListener("click", () => { deleteNpc(btn.dataset.deleteNpc); renderLocationView(); })
  );
  content.querySelectorAll("[data-edit-item]").forEach((btn) =>
    btn.addEventListener("click", () => openItemModal(state.items.find((i) => i.id === btn.dataset.editItem)))
  );
  content.querySelectorAll("[data-delete-item]").forEach((btn) =>
    btn.addEventListener("click", () => { deleteItem(btn.dataset.deleteItem); renderLocationView(); })
  );
  content.querySelectorAll("[data-open-note]").forEach((btn) =>
    btn.addEventListener("click", () => openNoteModal(state.notes.find((n) => n.id === btn.dataset.openNote)))
  );
}

// ==================== Mostrar texto (itens/notas) e tags clicáveis ====================
function isTextShared(tipo, id) {
  return state.textoCompartilhadoTipo === tipo && state.textoCompartilhadoId === id;
}

function toggleSharedText(tipo, id) {
  if (isTextShared(tipo, id)) {
    state.textoCompartilhadoTipo = null;
    state.textoCompartilhadoId = null;
  } else {
    state.textoCompartilhadoTipo = tipo;
    state.textoCompartilhadoId = id;
  }
  saveState(true);
  renderItems();
  renderNotes();
}

function goToTagFilter(tag) {
  document.querySelector('[data-tab="compendio"]').click();
  const isKnownLocation = LOCATIONS.some((l) => l.tag === tag);
  if (isKnownLocation) {
    document.querySelector('[data-subtab="locais"]').click();
    activeLocation = tag;
    renderLocationPicker();
    renderLocationView();
  } else {
    document.querySelector('[data-subtab="npcs"]').click();
    document.getElementById("npc-search").value = tag;
    renderNpcs();
  }
}

document.addEventListener("click", (e) => {
  const tagBtn = e.target.closest("[data-tag-filter]");
  if (tagBtn) {
    goToTagFilter(tagBtn.dataset.tagFilter);
    return;
  }
  const shareBtn = e.target.closest("[data-share-text]");
  if (shareBtn) {
    toggleSharedText(shareBtn.dataset.shareText, shareBtn.dataset.shareId);
  }
});

// ==================== PCs (Princesas) ====================
const pcModal = document.getElementById("modal-pc");
const formPc = document.getElementById("form-pc");
let currentPcFoto = null;
setupPhotoInput("pc-foto", "pc-foto-preview", (url) => { currentPcFoto = url; });

const DOM_DESCRICOES = {
  "Coração Selvagem": "Por causa de sua natureza animalística, você pode chamar as criaturas da floresta e invocá-las em seu auxílio. Talentos iniciais: Caça, Pesca, Orientação.",
  "Voz Encantadora": "Você arrebata quem pode ouvi-la, atraindo, acalmando ou inspirando com sua voz. Talentos iniciais: Música, Atuação, Poesia.",
  "Agilidade Feérica": "Você é ligeira, acrobática, e se move com agilidade e discrição. Talentos iniciais: Atlética, Dançarina, Equitação.",
  "Conexão Elemental": "Um elemento (Fogo, Terra, Ar, Água ou algo mais caprichoso) é seu amigo e se dobra à sua imaginação. Talentos iniciais: Alquimia, Astronomia.",
  "Magia da Cozinha": "Conhecimento íntimo de flora mágica e misturas herbais; suas guloseimas são mais do que parecem. Talentos iniciais: Cozinhar, Assar, Coletar Alimentos.",
  "Toque Curativo": "Você restaura os outros com as mãos, cabelos e lágrimas; nunca fica doente. Talentos iniciais: Cura, Costura, Herbologia.",
  "Amizade Poderosa": "Uma amizade poderosa com um companheiro animal devotado, que oferece ajuda, conselhos e companhia.",
  "Intelecto Sábio": "Fonte de conhecimento histórico, folclore antigo e saber prático. Talentos iniciais: Caligrafia, Linguística, História, Folclore.",
};

document.getElementById("pc-dom-nome").addEventListener("change", (e) => {
  const desc = DOM_DESCRICOES[e.target.value];
  const field = document.getElementById("pc-dom-descricao");
  if (desc && !field.value.trim()) field.value = desc;
});

function openPcModal(pc) {
  document.getElementById("pc-modal-title").textContent = pc ? "Editar Princesa" : "Nova Princesa";
  document.getElementById("pc-id").value = pc ? pc.id : "";
  document.getElementById("pc-nome").value = pc ? pc.nome : "";
  document.getElementById("pc-jogadora").value = pc ? pc.jogadora : "";
  document.getElementById("pc-foto").value = "";
  currentPcFoto = pc ? pc.foto || null : null;
  showPhotoPreview("pc-foto-preview", currentPcFoto);
  document.getElementById("pc-dom-nome").value = pc ? pc.domNome : "";
  document.getElementById("pc-dom-descricao").value = pc ? pc.domDescricao : "";
  document.getElementById("pc-determinacao").value = pc ? pc.determinacao : 10;
  document.getElementById("pc-graca").value = pc ? pc.graca : 10;
  document.getElementById("pc-astucia").value = pc ? pc.astucia : 10;
  document.getElementById("pc-coracao-max").value = pc ? pc.coracaoMax : 7;
  document.getElementById("pc-armadura").value = pc ? pc.armadura : 0;
  document.getElementById("pc-dinheiro").value = pc ? pc.dinheiro : 0;
  document.getElementById("pc-dado-coracao-total").value = pc ? pc.dadoCoracaoTotal : 1;
  document.getElementById("pc-dado-dom-total").value = pc ? pc.dadoDomTotal : 1;
  document.getElementById("pc-arma").value = pc ? pc.arma : "";
  document.getElementById("pc-talentos").value = pc ? pc.talentos.join(", ") : "";
  document.getElementById("pc-inventario").value = pc ? pc.inventario.join(", ") : "";
  document.getElementById("pc-trauma").value = pc ? pc.trauma : "";
  document.getElementById("pc-maldicao-tipo").value = pc ? pc.maldicaoTipo || "" : "";
  renderMaldicaoPicker(pc ? pc.maldicaoEstagio || 0 : 0);
  pcModal.classList.remove("hidden");
}

function renderMaldicaoPicker(selected) {
  const wrap = document.getElementById("pc-maldicao-picker");
  const labels = ["0 (sem)", "1", "2", "3", "4 (transformada)"];
  wrap.innerHTML = labels
    .map(
      (label, i) =>
        `<button type="button" class="location-btn ${i === selected ? "active" : ""}" data-maldicao-stage="${i}" style="padding:8px 12px; font-size:0.85rem;">${label}</button>`
    )
    .join("");
  document.getElementById("pc-maldicao-estagio").value = selected;
  wrap.querySelectorAll("[data-maldicao-stage]").forEach((btn) =>
    btn.addEventListener("click", () => renderMaldicaoPicker(Number(btn.dataset.maldicaoStage)))
  );
}

function closePcModal() { pcModal.classList.add("hidden"); formPc.reset(); }

document.getElementById("btn-add-pc").addEventListener("click", () => openPcModal(null));
document.getElementById("btn-cancel-pc").addEventListener("click", closePcModal);

formPc.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("pc-id").value;
  const existing = id ? state.pcs.find((p) => p.id === id) : null;
  const coracaoMax = Number(document.getElementById("pc-coracao-max").value) || 0;
  const dadoCoracaoTotal = Number(document.getElementById("pc-dado-coracao-total").value) || 0;
  const dadoDomTotal = Number(document.getElementById("pc-dado-dom-total").value) || 0;
  const data = {
    id: id || uid(),
    nome: document.getElementById("pc-nome").value.trim(),
    jogadora: document.getElementById("pc-jogadora").value.trim(),
    domNome: document.getElementById("pc-dom-nome").value.trim(),
    domDescricao: document.getElementById("pc-dom-descricao").value.trim(),
    determinacao: Number(document.getElementById("pc-determinacao").value) || 0,
    graca: Number(document.getElementById("pc-graca").value) || 0,
    astucia: Number(document.getElementById("pc-astucia").value) || 0,
    coracaoMax,
    coracaoAtual: existing ? Math.min(existing.coracaoAtual, coracaoMax) : coracaoMax,
    armadura: Number(document.getElementById("pc-armadura").value) || 0,
    dinheiro: Number(document.getElementById("pc-dinheiro").value) || 0,
    dadoCoracaoTotal,
    dadoCoracaoUsados: existing ? Math.min(existing.dadoCoracaoUsados, dadoCoracaoTotal) : 0,
    dadoDomTotal,
    dadoDomUsados: existing ? Math.min(existing.dadoDomUsados, dadoDomTotal) : 0,
    arma: document.getElementById("pc-arma").value.trim(),
    talentos: parseTags(document.getElementById("pc-talentos").value),
    inventario: parseTags(document.getElementById("pc-inventario").value),
    trauma: document.getElementById("pc-trauma").value.trim(),
    maldicaoTipo: document.getElementById("pc-maldicao-tipo").value,
    maldicaoEstagio: Number(document.getElementById("pc-maldicao-estagio").value) || 0,
    aflicoes: existing ? existing.aflicoes : { cansada: false, atordoada: false, confusa: false },
    foto: currentPcFoto,
  };
  if (id) {
    const idx = state.pcs.findIndex((p) => p.id === id);
    state.pcs[idx] = data;
  } else {
    state.pcs.push(data);
  }
  saveState();
  closePcModal();
  renderPcs();
}
);

function deletePc(id) {
  if (!confirm("Excluir esta Princesa?")) return;
  state.pcs = state.pcs.filter((p) => p.id !== id);
  saveState();
  renderPcs();
}

function togglePcAffliction(id, key) {
  const pc = state.pcs.find((p) => p.id === id);
  if (!pc) return;
  pc.aflicoes[key] = !pc.aflicoes[key];
  saveState();
  renderPcs();
}

function togglePcDicePip(id, field, index) {
  const pc = state.pcs.find((p) => p.id === id);
  if (!pc) return;
  const usedKey = field === "coracao" ? "dadoCoracaoUsados" : "dadoDomUsados";
  pc[usedKey] = pc[usedKey] === index + 1 ? index : index + 1;
  saveState();
  renderPcs();
}

function renderPcs() {
  const list = document.getElementById("pc-list");
  if (state.pcs.length === 0) {
    list.innerHTML = emptyState("auto_awesome", "Nenhuma Princesa cadastrada ainda.");
    return;
  }
  list.innerHTML = state.pcs
    .map(
      (p) => `
    <div class="pc-card">
      <div class="card-header-row">
        ${p.foto ? `<img class="avatar" src="${p.foto}" alt="${escapeHtml(p.nome)}">` : ""}
        <div class="pc-card-title">
          <h3>${escapeHtml(p.nome)}</h3>
          ${p.jogadora ? `<p class="pc-player">Jogadora: ${escapeHtml(p.jogadora)}</p>` : ""}
        </div>
      </div>
      ${p.domNome ? `<div class="pc-dom">${escapeHtml(p.domNome)}</div>` : ""}
      ${p.domDescricao ? `<p class="pc-dom-desc">${escapeHtml(p.domDescricao)}</p>` : ""}
      <div class="pc-stats">
        <span>DET ${rollAttrBtn(p.nome, "Determinação", p.determinacao)}</span>
        <span>GRA ${rollAttrBtn(p.nome, "Graça", p.graca)}</span>
        <span>AST ${rollAttrBtn(p.nome, "Astúcia", p.astucia)}</span>
        <span>Armadura <b>${p.armadura}</b></span>
        <span>Dinheiro <b>${p.dinheiro} pp</b></span>
      </div>
      <div class="hp-control">
        <button class="icon-btn" data-pc-hp-down="${p.id}"><span class="icon">remove</span></button>
        <span>Coração: ${p.coracaoAtual} / ${p.coracaoMax}</span>
        <button class="icon-btn" data-pc-hp-up="${p.id}"><span class="icon">add</span></button>
      </div>
      <div class="pc-misc">Dados de Coração: ${dieTrack(p.dadoCoracaoTotal, p.dadoCoracaoUsados, "pc-dice-coracao", p.id)}</div>
      <div class="pc-misc">Dados de Dom: ${dieTrack(p.dadoDomTotal, p.dadoDomUsados, "pc-dice-dom", p.id)}</div>
      <div class="affliction-toggles">
        <button class="affliction-btn ${p.aflicoes.cansada ? "active cansada" : ""}" data-pc-affliction="${p.id}" data-key="cansada">Cansada</button>
        <button class="affliction-btn ${p.aflicoes.atordoada ? "active atordoada" : ""}" data-pc-affliction="${p.id}" data-key="atordoada">Atordoada</button>
        <button class="affliction-btn ${p.aflicoes.confusa ? "active confusa" : ""}" data-pc-affliction="${p.id}" data-key="confusa">Confusa</button>
      </div>
      ${
        p.maldicaoTipo
          ? `<div class="maldicao-box">
              <div class="npc-section-label">Maldição Doce — <span class="ability-link" data-ability="${escapeHtml(p.maldicaoTipo)}">${escapeHtml(p.maldicaoTipo)}</span></div>
              <div class="maldicao-stage-track">
                ${[1, 2, 3, 4]
                  .map(
                    (n) =>
                      `<button class="maldicao-pip ${p.maldicaoEstagio >= n ? "filled" : ""}" data-pc-maldicao="${p.id}" data-stage="${n}">${n}</button>`
                  )
                  .join("")}
                ${p.maldicaoEstagio >= 4 ? `<span class="init-status age-depois">Transformada!</span>` : ""}
              </div>
            </div>`
          : ""
      }
      ${p.arma ? `<div class="pc-misc"><b>Arma:</b> ${escapeHtml(p.arma)}</div>` : ""}
      ${p.talentos.length ? `<div class="pc-misc"><b>Talentos:</b> ${p.talentos.map(escapeHtml).join(", ")}</div>` : ""}
      ${p.inventario.length ? `<div class="pc-misc"><b>Minhas coisas:</b> ${p.inventario.map(escapeHtml).join(", ")}</div>` : ""}
      ${p.trauma ? `<div class="pc-misc"><b>Trauma:</b> ${escapeHtml(p.trauma)}</div>` : ""}
      <div class="pc-card-actions">
        <button class="btn btn-ghost" data-edit-pc="${p.id}">Editar</button>
        <button class="btn btn-danger" data-delete-pc="${p.id}">Excluir</button>
      </div>
    </div>
  `
    )
    .join("");

  list.querySelectorAll("[data-edit-pc]").forEach((btn) =>
    btn.addEventListener("click", () => openPcModal(state.pcs.find((p) => p.id === btn.dataset.editPc)))
  );
  list.querySelectorAll("[data-delete-pc]").forEach((btn) =>
    btn.addEventListener("click", () => deletePc(btn.dataset.deletePc))
  );
  list.querySelectorAll("[data-pc-hp-down]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const p = state.pcs.find((x) => x.id === btn.dataset.pcHpDown);
      p.coracaoAtual = Math.max(0, p.coracaoAtual - 1);
      saveState();
      renderPcs();
    })
  );
  list.querySelectorAll("[data-pc-hp-up]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const p = state.pcs.find((x) => x.id === btn.dataset.pcHpUp);
      p.coracaoAtual = Math.min(p.coracaoMax, p.coracaoAtual + 1);
      saveState();
      renderPcs();
    })
  );
  list.querySelectorAll("[data-pc-affliction]").forEach((btn) =>
    btn.addEventListener("click", () => togglePcAffliction(btn.dataset.pcAffliction, btn.dataset.key))
  );
  list.querySelectorAll("[data-pc-dice-coracao]").forEach((pip) =>
    pip.addEventListener("click", () => togglePcDicePip(pip.dataset.pcDiceCoracao, "coracao", Number(pip.dataset.index)))
  );
  list.querySelectorAll("[data-pc-dice-dom]").forEach((pip) =>
    pip.addEventListener("click", () => togglePcDicePip(pip.dataset.pcDiceDom, "dom", Number(pip.dataset.index)))
  );
  list.querySelectorAll("[data-pc-maldicao]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const pc = state.pcs.find((p) => p.id === btn.dataset.pcMaldicao);
      const stage = Number(btn.dataset.stage);
      pc.maldicaoEstagio = pc.maldicaoEstagio === stage ? stage - 1 : stage;
      saveState();
      renderPcs();
    })
  );
}

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

function newAfflictions() {
  return { cansada: false, atordoada: false, confusa: false };
}

function newCombatant(overrides) {
  return Object.assign(
    {
      id: uid(),
      nome: "",
      astucia: 10,
      d20: null,
      coracaoMax: 10,
      coracaoAtual: 10,
      isPc: false,
      aflicoes: newAfflictions(),
      determinacao: null,
      graca: null,
      salvamento: null,
      armadura: 0,
      notas: "",
      tipo: "",
    },
    overrides
  );
}

// sucesso === null quando ainda não rolou; true/false depois de preencher o d20
function computeIniciativa(c) {
  if (c.d20 === null || c.d20 === undefined || c.d20 === "") {
    c.sucesso = null;
    c.critico = false;
    return;
  }
  const roll = Number(c.d20);
  c.critico = roll === 1;
  c.sucesso = roll === 1 ? true : roll === 20 ? false : roll <= c.astucia;
}

formCombatant.addEventListener("submit", (e) => {
  e.preventDefault();
  const coracaoMax = Number(document.getElementById("c-coracao-max").value) || 0;
  const c = newCombatant({
    nome: document.getElementById("c-nome").value.trim(),
    astucia: Number(document.getElementById("c-astucia").value) || 10,
    coracaoMax,
    coracaoAtual: coracaoMax,
    isPc: document.getElementById("c-is-pc").checked,
  });
  computeIniciativa(c);
  state.combat.combatants.push(c);
  saveState();
  combatantModal.classList.add("hidden");
  formCombatant.reset();
  renderCombat();
});

const fromNpcModal = document.getElementById("modal-from-npc");
let fromNpcType = "NPC";

function renderFromNpcList() {
  const list = document.getElementById("from-npc-list");
  const query = document.getElementById("from-npc-search").value.trim().toLowerCase();
  const pool = state.npcs.filter((n) => (fromNpcType === "Monstro" ? n.tipo === "Monstro" : n.tipo !== "Monstro"));
  const filtered = pool.filter(
    (n) => !query || n.nome.toLowerCase().includes(query) || n.tags.some((t) => t.toLowerCase().includes(query))
  );
  if (filtered.length === 0) {
    list.innerHTML = emptyState("search_off", "Nada encontrado. Crie no Compêndio primeiro.");
    return;
  }
  list.innerHTML = filtered
    .map(
      (n) => `
      <div class="from-npc-item">
        <span>${escapeHtml(n.nome)} <small style="color:var(--text-dim)">(Coração ${n.coracao}, Ast. ${n.astucia})</small></span>
        <button class="btn btn-secondary" data-add-from-npc="${n.id}">+ Adicionar</button>
      </div>
    `
    )
    .join("");
  list.querySelectorAll("[data-add-from-npc]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const n = state.npcs.find((x) => x.id === btn.dataset.addFromNpc);
      const c = newCombatant({
        nome: n.nome,
        astucia: n.astucia,
        coracaoMax: n.coracao,
        coracaoAtual: n.coracao,
        isPc: false,
        determinacao: n.determinacao,
        graca: n.graca,
        salvamento: n.salvamento,
        armadura: n.armadura,
        notas: n.notas,
        tipo: n.tipo,
      });
      state.combat.combatants.push(c);
      saveState();
      renderCombat();
    })
  );
}

document.getElementById("btn-add-from-npc").addEventListener("click", () => {
  fromNpcType = "NPC";
  document.getElementById("from-npc-title").textContent = "Adicionar do banco de NPCs";
  document.querySelectorAll("[data-from-npc-type]").forEach((b) => b.classList.toggle("active", b.dataset.fromNpcType === "NPC"));
  document.getElementById("from-npc-search").value = "";
  renderFromNpcList();
  fromNpcModal.classList.remove("hidden");
});
document.querySelectorAll("[data-from-npc-type]").forEach((btn) =>
  btn.addEventListener("click", () => {
    fromNpcType = btn.dataset.fromNpcType;
    document.querySelectorAll("[data-from-npc-type]").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("from-npc-title").textContent =
      fromNpcType === "Monstro" ? "Adicionar do banco de Monstros" : "Adicionar do banco de NPCs";
    renderFromNpcList();
  })
);
document.getElementById("from-npc-search").addEventListener("input", renderFromNpcList);
document.getElementById("btn-cancel-from-npc").addEventListener("click", () => fromNpcModal.classList.add("hidden"));

const fromPcModal = document.getElementById("modal-from-pc");
document.getElementById("btn-add-from-pc").addEventListener("click", () => {
  const list = document.getElementById("from-pc-list");
  if (state.pcs.length === 0) {
    list.innerHTML = emptyState("face_3", "Nenhuma Princesa cadastrada. Crie uma na aba \"Personagens\" primeiro.");
  } else {
    list.innerHTML = state.pcs
      .map(
        (p) => `
      <div class="from-npc-item">
        <span>${escapeHtml(p.nome)} <small style="color:var(--text-dim)">(Coração ${p.coracaoAtual}/${p.coracaoMax}, Ast. ${p.astucia})</small></span>
        <button class="btn btn-secondary" data-add-from-pc="${p.id}">+ Adicionar</button>
      </div>
    `
      )
      .join("");
    list.querySelectorAll("[data-add-from-pc]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const p = state.pcs.find((x) => x.id === btn.dataset.addFromPc);
        const c = newCombatant({
          nome: p.nome,
          astucia: p.astucia,
          coracaoMax: p.coracaoMax,
          coracaoAtual: p.coracaoAtual,
          isPc: true,
          determinacao: p.determinacao,
          graca: p.graca,
          armadura: p.armadura,
          notas: [p.domNome, p.domDescricao].filter(Boolean).join(" — "),
          aflicoes: Object.assign({}, p.aflicoes),
        });
        state.combat.combatants.push(c);
        saveState();
        renderCombat();
      })
    );
  }
  fromPcModal.classList.remove("hidden");
});
document.getElementById("btn-cancel-from-pc").addEventListener("click", () => fromPcModal.classList.add("hidden"));

document.getElementById("btn-roll-init").addEventListener("click", () => {
  if (state.combat.combatants.length === 0) return;
  state.combat.combatants.forEach((c) => {
    if (c.isPc) return; // as jogadoras rolam na mesa; a Mestra digita o resultado
    c.d20 = 1 + Math.floor(Math.random() * 20);
    computeIniciativa(c);
  });
  sortCombatants();
  saveState();
  renderCombat();
});

function setCombatantD20(id, value) {
  const c = state.combat.combatants.find((x) => x.id === id);
  if (!c) return;
  c.d20 = value === "" ? null : Math.max(1, Math.min(20, Number(value)));
  computeIniciativa(c);
  saveState();
  renderCombat();
}

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
  // Regra oficial: quem teve sucesso no teste de Astúcia age antes; quem falhou, age depois.
  // Quem ainda não rolou fica no meio (nem confirmado antes, nem depois).
  const rank = (c) => (c.sucesso === true ? 0 : c.sucesso === null || c.sucesso === undefined ? 1 : 2);
  state.combat.combatants.sort((a, b) => rank(a) - rank(b));
}

function updateHp(id, delta) {
  const c = state.combat.combatants.find((x) => x.id === id);
  if (!c) return;
  c.coracaoAtual = Math.max(0, Math.min(c.coracaoMax, c.coracaoAtual + delta));
  saveState();
  renderCombat();
}

function toggleCombatantAffliction(id, key) {
  const c = state.combat.combatants.find((x) => x.id === id);
  if (!c) return;
  c.aflicoes[key] = !c.aflicoes[key];
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

function openCombatantQuickView(c) {
  document.getElementById("combatant-view-title").textContent = c.nome;
  const body = document.getElementById("combatant-view-body");
  body.innerHTML = `
    <div class="npc-stat-grid">
      ${c.determinacao !== null ? `<div class="stat-box"><span>Determinação</span>${rollAttrBtn(c.nome, "Determinação", c.determinacao)}</div>` : ""}
      ${c.graca !== null ? `<div class="stat-box"><span>Graça</span>${rollAttrBtn(c.nome, "Graça", c.graca)}</div>` : ""}
      <div class="stat-box"><span>Astúcia</span>${rollAttrBtn(c.nome, "Astúcia", c.astucia)}</div>
      ${c.salvamento !== null ? `<div class="stat-box"><span>Salvamento</span>${rollAttrBtn(c.nome, "Salvamento", c.salvamento)}</div>` : ""}
      <div class="stat-box"><span>Armadura</span><b>${c.armadura}</b></div>
    </div>
    ${c.notas ? `<div class="npc-section-label">Ataques &amp; poderes (clique para explicar)</div><div class="npc-notes">${linkifyText(c.notas)}</div>` : `<p class="field-hint">Sem anotações de ataques pra esse combatente.</p>`}
  `;
  document.getElementById("modal-combatant-view").classList.remove("hidden");
}

function renderCombat() {
  document.getElementById("round-number").textContent = state.combat.round;
  const list = document.getElementById("combat-list");
  if (state.combat.combatants.length === 0) {
    list.innerHTML = emptyState("swords", "Nenhum combatente na mesa. Adicione manualmente ou importe do banco de NPCs/Princesas.");
    return;
  }
  list.innerHTML = state.combat.combatants
    .map((c, idx) => {
      const hpPct = c.coracaoMax > 0 ? (c.coracaoAtual / c.coracaoMax) * 100 : 0;
      const hpClass = hpPct <= 25 ? "critical" : hpPct <= 50 ? "low" : "";
      const isCurrent = idx === state.combat.currentIndex;
      let statusBadge = `<span class="init-status pending">aguardando d20</span>`;
      if (c.sucesso === true) statusBadge = `<span class="init-status age-antes">Age antes${c.critico ? " — crítico! 2 ações no 1º turno" : ""}</span>`;
      else if (c.sucesso === false) statusBadge = `<span class="init-status age-depois">Age depois</span>`;

      const hasDetails = c.notas || c.determinacao !== null || c.graca !== null || c.salvamento !== null;

      return `
      <div class="combatant-card ${isCurrent ? "current-turn" : ""} ${c.isPc ? "is-pc" : "is-npc"}">
        <div class="combatant-top">
          <div class="combatant-init-block">
            <input type="number" min="1" max="20" class="combatant-d20-input" data-c-d20="${c.id}" placeholder="d20" value="${c.d20 ?? ""}">
            ${statusBadge}
          </div>
          <div class="combatant-name" ${hasDetails ? `data-toggle-combatant="${c.id}"` : ""}>
            ${isCurrent ? "▶ " : ""}${escapeHtml(c.nome)}${c.tipo ? ` <span class="npc-type-badge">${escapeHtml(c.tipo)}</span>` : ""}
            ${hasDetails ? `<span class="icon expand-caret">info</span>` : ""}
          </div>
          <div class="hp-control">
            <button class="icon-btn" data-hp-down="${c.id}"><span class="icon">remove</span></button>
            <span>${c.coracaoAtual} / ${c.coracaoMax}</span>
            <button class="icon-btn" data-hp-up="${c.id}"><span class="icon">add</span></button>
            <div class="hp-bar-wrap"><div class="hp-bar ${hpClass}" style="width:${hpPct}%"></div></div>
          </div>
          <div class="affliction-toggles">
            <button class="affliction-btn ${c.aflicoes.cansada ? "active cansada" : ""}" data-c-affliction="${c.id}" data-key="cansada">Cansada</button>
            <button class="affliction-btn ${c.aflicoes.atordoada ? "active atordoada" : ""}" data-c-affliction="${c.id}" data-key="atordoada">Atordoada</button>
            <button class="affliction-btn ${c.aflicoes.confusa ? "active confusa" : ""}" data-c-affliction="${c.id}" data-key="confusa">Confusa</button>
          </div>
          <div class="combatant-actions">
            <button class="icon-btn" data-remove-combatant="${c.id}" title="Remover"><span class="icon">delete</span></button>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  list.querySelectorAll("[data-c-d20]").forEach((input) =>
    input.addEventListener("change", () => setCombatantD20(input.dataset.cD20, input.value))
  );
  list.querySelectorAll("[data-toggle-combatant]").forEach((el) =>
    el.addEventListener("click", () => {
      const c = state.combat.combatants.find((cc) => cc.id === el.dataset.toggleCombatant);
      if (c) openCombatantQuickView(c);
    })
  );
  list.querySelectorAll("[data-hp-down]").forEach((btn) => btn.addEventListener("click", () => updateHp(btn.dataset.hpDown, -1)));
  list.querySelectorAll("[data-hp-up]").forEach((btn) => btn.addEventListener("click", () => updateHp(btn.dataset.hpUp, 1)));
  list.querySelectorAll("[data-c-affliction]").forEach((btn) =>
    btn.addEventListener("click", () => toggleCombatantAffliction(btn.dataset.cAffliction, btn.dataset.key))
  );
  list.querySelectorAll("[data-remove-combatant]").forEach((btn) =>
    btn.addEventListener("click", () => removeCombatant(btn.dataset.removeCombatant))
  );
}

// ==================== Mapa ====================
const playerLink = new URL("jogador.html", window.location.href).href;
document.getElementById("player-link-text").textContent = playerLink;
document.getElementById("btn-copy-player-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(playerLink);
    const btn = document.getElementById("btn-copy-player-link");
    const original = btn.textContent;
    btn.textContent = "Copiado!";
    setTimeout(() => (btn.textContent = original), 1500);
  } catch (err) {
    prompt("Copie o link manualmente:", playerLink);
  }
});

function renderMapVisibilityToggle() {
  const btn = document.getElementById("btn-toggle-map-visible");
  const visivel = state.mapaVisivelJogadores !== false;
  btn.innerHTML = visivel ? `<span class="icon">visibility_off</span>` : `<span class="icon">visibility</span>`;
  btn.title = visivel ? "Esconder mapa das jogadoras" : "Mostrar mapa às jogadoras";
  btn.classList.toggle("btn-ghost", visivel);
  btn.classList.toggle("btn-secondary", !visivel);
}
document.getElementById("btn-toggle-map-visible").addEventListener("click", () => {
  state.mapaVisivelJogadores = state.mapaVisivelJogadores === false;
  saveState();
  pushLiveOnly();
  renderMapVisibilityToggle();
});

const mapCanvas = document.getElementById("map-canvas");
const mapSelect = document.getElementById("map-select");
const mapUpload = document.getElementById("map-upload");
const tokenModal = document.getElementById("modal-token");
const formToken = document.getElementById("form-token");
const TOKEN_COLORS = ["#b483d1", "#93cfa3", "#e88ba0", "#e8c07a", "#7ab8e8", "#e8956a", "#c9d97a", "#f3ead9"];
let pendingNewTokenId = null;

function activeMap() {
  return state.maps.find((m) => m.id === state.activeMapId) || null;
}

// Faz o quadro do mapa sempre ter a mesma proporção da imagem, para que a posição
// dos marcadores (em %) bata em qualquer tela (computador, tablet, celular).
// Usa largura/altura em pixels (não CSS aspect-ratio) porque aspect-ratio junto
// com max-height quebra a proporção quando o limite de altura entra em ação —
// e isso é o que deixava o mapa esticado/deformado.
function sizeCanvasToRatio(canvasEl, ratioW, ratioH, maxHeightVh) {
  const parent = canvasEl.parentElement;
  const availWidth = parent ? parent.clientWidth : canvasEl.clientWidth;
  const maxHeight = window.innerHeight * maxHeightVh;
  let w = availWidth;
  let h = (w * ratioH) / ratioW;
  if (h > maxHeight) {
    h = maxHeight;
    w = (h * ratioW) / ratioH;
  }
  canvasEl.style.width = Math.round(w) + "px";
  canvasEl.style.height = Math.round(h) + "px";
}

function applyMapAspectRatio(canvasEl, map, onMeasured) {
  if (map.largura && map.altura) {
    sizeCanvasToRatio(canvasEl, map.largura, map.altura, 0.7);
    return;
  }
  const img = new Image();
  img.onload = () => {
    map.largura = img.naturalWidth;
    map.altura = img.naturalHeight;
    sizeCanvasToRatio(canvasEl, map.largura, map.altura, 0.7);
    saveState();
    if (onMeasured) onMeasured();
  };
  img.src = map.imagem;
}

let mapResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(mapResizeTimer);
  mapResizeTimer = setTimeout(() => {
    const map = state.maps.find((m) => m.id === state.activeMapId);
    if (map && map.largura && map.altura) sizeCanvasToRatio(mapCanvas, map.largura, map.altura, 0.7);
    updateGridCell();
  }, 150);
});

// ---------- Grid e régua (só do lado da Mestra, não sincroniza com as jogadoras) ----------
let gridOn = false;
let gridSize = 20;
let rulerMode = false;
let rulerPoints = [];

function updateGridCell() {
  if (!mapCanvas.clientWidth) return;
  mapCanvas.style.setProperty("--grid-cell", mapCanvas.clientWidth / gridSize + "px");
}

document.getElementById("btn-toggle-grid").addEventListener("click", () => {
  gridOn = !gridOn;
  mapCanvas.classList.toggle("grid-on", gridOn);
  document.getElementById("btn-toggle-grid").classList.toggle("btn-secondary", gridOn);
  updateGridCell();
});

document.getElementById("grid-size-input").addEventListener("input", (e) => {
  gridSize = Math.max(4, Number(e.target.value) || 20);
  updateGridCell();
});

function clearRulerLine() {
  const svg = document.getElementById("ruler-svg");
  if (svg) svg.remove();
}

function drawRulerLine(p1, p2) {
  clearRulerLine();
  const w = mapCanvas.clientWidth;
  const h = mapCanvas.clientHeight;
  const x1 = (p1.x / 100) * w, y1 = (p1.y / 100) * h;
  const x2 = (p2.x / 100) * w, y2 = (p2.y / 100) * h;
  const distPx = Math.hypot(x2 - x1, y2 - y1);
  const cellPx = w / gridSize;
  const squares = (distPx / cellPx).toFixed(1);
  const metros = (distPx / cellPx * 1.5).toFixed(1);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "ruler-svg";
  svg.setAttribute("style", "position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:7;");
  svg.innerHTML = `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#d4af37" stroke-width="3" stroke-dasharray="6,4"/>
    <circle cx="${x1}" cy="${y1}" r="5" fill="#d4af37"/>
    <circle cx="${x2}" cy="${y2}" r="5" fill="#d4af37"/>
    <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 10}" fill="#5a2f4a" font-size="14" font-weight="700" text-anchor="middle" style="paint-order:stroke; stroke:#fff; stroke-width:4px;">${squares} quadros (~${metros}m)</text>
  `;
  mapCanvas.appendChild(svg);
}

document.getElementById("btn-toggle-ruler").addEventListener("click", () => {
  rulerMode = !rulerMode;
  rulerPoints = [];
  clearRulerLine();
  document.getElementById("btn-toggle-ruler").classList.toggle("btn-secondary", rulerMode);
  mapCanvas.style.cursor = rulerMode ? "crosshair" : "";
});

mapUpload.addEventListener("change", async () => {
  const file = mapUpload.files[0];
  if (!file) return;
  const nome = prompt("Nome do mapa:", file.name.replace(/\.[^.]+$/, "")) || "Mapa sem nome";
  const { dataUrl, width, height } = await fileToResizedImageWithSize(file, 1600);
  const url = await uploadToCloudinary(dataUrl);
  const map = { id: uid(), nome, imagem: url || dataUrl, largura: width, altura: height, tokens: [] };
  state.maps.push(map);
  state.activeMapId = map.id;
  saveState();
  pushLiveOnly();
  renderMap();
  mapUpload.value = "";
});

mapSelect.addEventListener("change", () => {
  state.activeMapId = mapSelect.value || null;
  saveState();
  pushLiveOnly();
  renderMap();
});

document.getElementById("btn-rename-map").addEventListener("click", () => {
  const map = activeMap();
  if (!map) return;
  const nome = prompt("Novo nome do mapa:", map.nome);
  if (nome && nome.trim()) {
    map.nome = nome.trim();
    saveState();
    renderMap();
  }
});

document.getElementById("btn-delete-map").addEventListener("click", () => {
  const map = activeMap();
  if (!map) return;
  if (!confirm(`Excluir o mapa "${map.nome}" e todos os seus marcadores?`)) return;
  state.maps = state.maps.filter((m) => m.id !== map.id);
  state.activeMapId = state.maps.length ? state.maps[0].id : null;
  saveState();
  renderMap();
});

function renderColorPicker(selected) {
  const wrap = document.getElementById("token-color-picker");
  wrap.innerHTML = TOKEN_COLORS.map(
    (c) => `<span class="color-swatch ${c === selected ? "selected" : ""}" style="background:${c}" data-color="${c}"></span>`
  ).join("");
  wrap.querySelectorAll(".color-swatch").forEach((sw) =>
    sw.addEventListener("click", () => {
      wrap.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
      sw.classList.add("selected");
      document.getElementById("token-cor").value = sw.dataset.color;
    })
  );
}

function openTokenModal(token, isNew) {
  pendingNewTokenId = isNew ? token.id : null;
  document.getElementById("token-id").value = token.id;
  document.getElementById("token-nome").value = token.nome;
  document.getElementById("token-cor").value = token.cor;
  renderColorPicker(token.cor);
  tokenModal.classList.remove("hidden");
}

function closeTokenModal() {
  tokenModal.classList.add("hidden");
  pendingNewTokenId = null;
}

document.getElementById("btn-cancel-token").addEventListener("click", () => {
  const map = activeMap();
  if (pendingNewTokenId && map) {
    map.tokens = map.tokens.filter((t) => t.id !== pendingNewTokenId);
    saveState();
    renderMap();
  }
  closeTokenModal();
});

document.getElementById("btn-delete-token").addEventListener("click", () => {
  const map = activeMap();
  const id = document.getElementById("token-id").value;
  if (map && id) {
    map.tokens = map.tokens.filter((t) => t.id !== id);
    saveState();
    renderMap();
  }
  closeTokenModal();
});

formToken.addEventListener("submit", (e) => {
  e.preventDefault();
  const map = activeMap();
  if (!map) return;
  const id = document.getElementById("token-id").value;
  const token = map.tokens.find((t) => t.id === id);
  if (token) {
    token.nome = document.getElementById("token-nome").value.trim() || "Marcador";
    token.cor = document.getElementById("token-cor").value;
  }
  pendingNewTokenId = null;
  saveState();
  closeTokenModal();
  renderMap();
});

function addTokenToMap(nome, cor, x, y, origemTipo, origemId) {
  const map = activeMap();
  if (!map) {
    alert("Crie ou selecione um mapa primeiro.");
    return null;
  }
  const token = {
    id: uid(),
    nome,
    cor: cor || TOKEN_COLORS[map.tokens.length % TOKEN_COLORS.length],
    x,
    y,
    origemTipo: origemTipo || null,
    origemId: origemId || null,
  };
  map.tokens.push(token);
  saveState();
  renderMap();
  return token;
}

const mapPickerModal = document.getElementById("modal-map-picker");
document.getElementById("btn-cancel-map-picker").addEventListener("click", () => mapPickerModal.classList.add("hidden"));

function openMapPicker(title, entries) {
  document.getElementById("map-picker-title").textContent = title;
  const list = document.getElementById("map-picker-list");
  if (entries.length === 0) {
    list.innerHTML = emptyState("inventory_2", "Nada cadastrado ainda.");
  } else {
    list.innerHTML = entries
      .map((e) => `<div class="from-npc-item"><span>${escapeHtml(e.nome)}</span><button class="btn btn-secondary" data-pick="${e.id}">+ Adicionar</button></div>`)
      .join("");
    list.querySelectorAll("[data-pick]").forEach((btn) => {
      const entry = entries.find((e) => e.id === btn.dataset.pick);
      btn.addEventListener("click", () => {
        const jitter = () => 40 + Math.random() * 20;
        addTokenToMap(entry.nome, entry.cor, jitter(), jitter(), entry.tipo, entry.id);
      });
    });
  }
  mapPickerModal.classList.remove("hidden");
}

document.getElementById("btn-map-add-npc").addEventListener("click", () => {
  const entries = state.npcs.filter((n) => n.tipo !== "Monstro").map((n) => ({ id: n.id, nome: n.nome, cor: TOKEN_COLORS[1], tipo: "npc" }));
  openMapPicker("Adicionar NPC do banco", entries);
});
document.getElementById("btn-map-add-monster").addEventListener("click", () => {
  const entries = state.npcs.filter((n) => n.tipo === "Monstro").map((n) => ({ id: n.id, nome: n.nome, cor: TOKEN_COLORS[2], tipo: "npc" }));
  openMapPicker("Adicionar Monstro do banco", entries);
});
document.getElementById("btn-map-add-pc").addEventListener("click", () => {
  const entries = state.pcs.map((p) => ({ id: p.id, nome: p.nome, cor: TOKEN_COLORS[3], tipo: "pc" }));
  openMapPicker("Adicionar Princesa", entries);
});
document.getElementById("btn-map-add-generic").addEventListener("click", () => {
  const token = addTokenToMap("Marcador", TOKEN_COLORS[0], 50, 50);
  if (token) openTokenModal(token, true);
});

function onMapCanvasClick(e) {
  if (e.target !== mapCanvas) return;
  const rect = mapCanvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  if (rulerMode) {
    rulerPoints.push({ x, y });
    if (rulerPoints.length === 2) {
      drawRulerLine(rulerPoints[0], rulerPoints[1]);
      rulerPoints = [];
    } else {
      clearRulerLine();
    }
    return;
  }
  const map = activeMap();
  if (!map) return;
  const token = { id: uid(), nome: "Marcador", cor: TOKEN_COLORS[map.tokens.length % TOKEN_COLORS.length], x, y };
  map.tokens.push(token);
  saveState();
  renderMap();
  openTokenModal(token, true);
}

function attachTokenDrag(el, token) {
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
  el.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    dragging = false;
    if (moved) {
      const rect = mapCanvas.getBoundingClientRect();
      let x = ((e.clientX - rect.left) / rect.width) * 100;
      let y = ((e.clientY - rect.top) / rect.height) * 100;
      token.x = Math.max(0, Math.min(100, x));
      token.y = Math.max(0, Math.min(100, y));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      pushLiveOnly();
    } else {
      openTokenModal(token, false);
    }
  });
}

// Um marcador criado a partir do banco de NPCs/Monstros/Princesas guarda de onde veio
// (origemTipo/origemId), pra puxar a foto e a vida atual sem precisar copiar esses dados
// — assim, se a foto ou a vida mudar na ficha, o marcador no mapa reflete sozinho.
function getTokenVisual(token) {
  if (!token.origemTipo || !token.origemId) return null;
  if (token.origemTipo === "pc") {
    const pc = state.pcs.find((p) => p.id === token.origemId);
    if (!pc) return null;
    return { foto: pc.foto || null, hpAtual: pc.coracaoAtual, hpMax: pc.coracaoMax };
  }
  if (token.origemTipo === "npc") {
    const npc = state.npcs.find((n) => n.id === token.origemId);
    if (!npc) return null;
    const combatant = state.combat.combatants.find((c) => !c.isPc && c.nome === npc.nome);
    return {
      foto: npc.foto || null,
      hpAtual: combatant ? combatant.coracaoAtual : null,
      hpMax: combatant ? combatant.coracaoMax : null,
    };
  }
  return null;
}

function tokenInnerHtml(t) {
  const visual = getTokenVisual(t);
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

function renderMap() {
  mapSelect.innerHTML = state.maps.length
    ? state.maps.map((m) => `<option value="${m.id}" ${m.id === state.activeMapId ? "selected" : ""}>${escapeHtml(m.nome)}</option>`).join("")
    : `<option value="">Nenhum mapa</option>`;

  renderMapVisibilityToggle();
  const map = activeMap();
  mapCanvas.removeEventListener("click", onMapCanvasClick);
  if (!map) {
    mapCanvas.style.backgroundImage = "";
    mapCanvas.style.width = "";
    mapCanvas.style.height = "";
    mapCanvas.innerHTML = emptyState("add_photo_alternate", "Nenhum mapa ainda. Clique em \"+ Novo mapa\" para enviar uma imagem.");
    return;
  }
  applyMapAspectRatio(mapCanvas, map, renderMap);
  updateGridCell();
  mapCanvas.style.backgroundImage = `url(${map.imagem})`;
  mapCanvas.innerHTML = map.tokens
    .map((t) => `<div class="map-token" style="left:${t.x}%; top:${t.y}%" data-token-id="${t.id}">${tokenInnerHtml(t)}</div>`)
    .join("");
  mapCanvas.querySelectorAll(".map-token").forEach((el) => {
    const token = map.tokens.find((t) => t.id === el.dataset.tokenId);
    attachTokenDrag(el, token);
  });
  mapCanvas.addEventListener("click", onMapCanvasClick);
}

// ==================== Campanha: objetivos ====================
document.getElementById("btn-add-objective").addEventListener("click", () => {
  const texto = prompt("Novo objetivo:");
  if (texto && texto.trim()) {
    state.objectives.push({ id: uid(), texto: texto.trim(), feito: false });
    saveState();
    renderObjectives();
  }
});

function renderObjectives() {
  const list = document.getElementById("objective-list");
  if (state.objectives.length === 0) {
    list.innerHTML = emptyState("flag", "Nenhum objetivo cadastrado.");
    return;
  }
  list.innerHTML = state.objectives
    .map(
      (o) => `
    <div class="objective-row ${o.feito ? "done" : ""}">
      <input type="checkbox" data-objective-check="${o.id}" ${o.feito ? "checked" : ""}>
      <span>${escapeHtml(o.texto)}</span>
      <button class="icon-btn" data-objective-delete="${o.id}" title="Remover"><span class="icon">delete</span></button>
    </div>
  `
    )
    .join("");

  list.querySelectorAll("[data-objective-check]").forEach((cb) =>
    cb.addEventListener("change", () => {
      const o = state.objectives.find((x) => x.id === cb.dataset.objectiveCheck);
      o.feito = cb.checked;
      saveState();
      renderObjectives();
    })
  );
  list.querySelectorAll("[data-objective-delete]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.objectives = state.objectives.filter((x) => x.id !== btn.dataset.objectiveDelete);
      saveState();
      renderObjectives();
    })
  );
}

// ==================== Campanha: notas ====================
const noteModal = document.getElementById("modal-note");
const formNote = document.getElementById("form-note");

function openNoteModal(note) {
  document.getElementById("note-modal-title").textContent = note ? "Editar nota" : "Nova nota";
  document.getElementById("note-id").value = note ? note.id : "";
  document.getElementById("note-titulo").value = note ? note.titulo : "";
  document.getElementById("note-categoria").value = note ? note.categoria || "lore" : "lore";
  document.getElementById("note-texto").value = note ? note.texto : "";
  noteModal.classList.remove("hidden");
}
function closeNoteModal() { noteModal.classList.add("hidden"); formNote.reset(); }

document.getElementById("btn-add-note").addEventListener("click", () => openNoteModal(null));
document.getElementById("btn-cancel-note").addEventListener("click", closeNoteModal);

formNote.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("note-id").value;
  const data = {
    id: id || uid(),
    titulo: document.getElementById("note-titulo").value.trim(),
    categoria: document.getElementById("note-categoria").value,
    texto: document.getElementById("note-texto").value.trim(),
  };
  if (id) {
    const idx = state.notes.findIndex((n) => n.id === id);
    state.notes[idx] = data;
  } else {
    state.notes.push(data);
  }
  saveState();
  closeNoteModal();
  renderNotes();
});

function deleteNote(id) {
  if (!confirm("Excluir esta nota?")) return;
  state.notes = state.notes.filter((n) => n.id !== id);
  saveState();
  renderNotes();
}

// Em vez de uma lista única filtrável por categoria (que obriga a clicar num filtro pra
// entender o que existe), cada categoria vira sua própria "prateleira" sempre visível —
// mais fácil de escanear com o olho. "Aventura completa" fica separada como uma lista
// compacta de capítulos (é material de preparo, não algo pra consultar no meio da mesa),
// seguindo o princípio de prep enxuto do Sly Flourish (slyflourish.com/organizing_notes.html).
const NOTE_SHELVES = [
  { key: "aventura", label: "Aventura completa", icon: "menu_book" },
  { key: "regras", label: "Regras rápidas", icon: "gavel" },
  { key: "lore", label: "Lore & Mundo", icon: "auto_stories" },
  { key: "achados", label: "Achados", icon: "diamond" },
];


function openNoteReadModal(note) {
  // Já tem uma janela aberta pra essa nota? Só traz ela pra frente em vez de duplicar.
  if (openFloatingNotes.has(note.id)) {
    const existing = openFloatingNotes.get(note.id);
    existing.querySelector(".floating-body").innerHTML = linkifyText(note.texto);
    bringFloatingToFront(existing);
    return;
  }

  const win = document.createElement("div");
  win.className = "floating-window";
  win.dataset.noteId = note.id;
  const cascade = (openFloatingNotes.size % 6) * 28;
  win.style.top = `calc(10vh + ${cascade}px)`;
  win.style.right = `calc(5vw + ${cascade}px)`;
  win.innerHTML = `
    <div class="floating-header">
      <span class="icon" style="color: var(--royal-gold);">menu_book</span>
      <h2>${escapeHtml(note.titulo)}</h2>
      <button type="button" class="btn-ghost icon-only btn-edit-from-read" style="padding: 4px; margin-right: 8px;" title="Editar">
        <span class="icon">edit</span>
      </button>
      <button type="button" class="btn-close-modal btn-close-floating" style="position: static; padding: 0;">&times;</button>
    </div>
    <div class="floating-body">${linkifyText(note.texto)}</div>
  `;
  floatingNotesContainer.appendChild(win);
  openFloatingNotes.set(note.id, win);
  bringFloatingToFront(win);

  win.addEventListener("mousedown", () => bringFloatingToFront(win));
  makeFloatingDraggable(win, win.querySelector(".floating-header"));
  win.querySelector(".btn-close-floating").addEventListener("click", () => closeFloatingNote(note.id));
  win.querySelector(".btn-edit-from-read").addEventListener("click", () => {
    closeFloatingNote(note.id);
    openNoteModal(note);
  });
}

function noteRowHtml(n, shelfKey) {
  const categoria = shelfKey === "aventura" ? "aventura" : n.categoria || "lore";
  const shared = isTextShared("nota", n.id);
  return `
    <div class="note-row note-row-${categoria}" data-note-id="${n.id}">
      <button type="button" class="note-row-main" data-read-note="${n.id}">
        <span class="icon">${shelfKey === "aventura" ? "bookmark" : "description"}</span>
        <span class="note-row-title">${escapeHtml(n.titulo)}</span>
        <span class="icon note-row-chevron">chevron_right</span>
      </button>
      <div class="note-row-actions">
        <button class="btn btn-ghost icon-only" data-share-text="nota" data-share-id="${n.id}" title="${shared ? "Esconder" : "Mostrar aos jogadores"}"><span class="icon">${shared ? "visibility_off" : "visibility"}</span></button>
        <button class="btn btn-ghost icon-only" data-edit-note="${n.id}" title="Editar"><span class="icon">edit</span></button>
        <button class="btn btn-danger icon-only" data-delete-note="${n.id}" title="Excluir"><span class="icon">delete</span></button>
      </div>
    </div>`;
}

function renderNotes() {
  const list = document.getElementById("note-list");
  const query = document.getElementById("note-search").value.trim().toLowerCase();
  const matches = (n) => !query || n.titulo.toLowerCase().includes(query) || n.texto.toLowerCase().includes(query);
  const grouped = NOTE_SHELVES.map((shelf) => ({
    shelf,
    notes: state.notes.filter((n) => (n.categoria || "lore") === shelf.key && matches(n)),
  })).filter((g) => g.notes.length > 0);

  if (grouped.length === 0) {
    list.innerHTML = emptyState("auto_stories", "Nenhuma nota encontrada.");
    return;
  }

  list.innerHTML = grouped
    .map(
      ({ shelf, notes }) => `
      <div class="note-shelf">
        <div class="note-shelf-title"><span class="icon">${shelf.icon}</span> ${shelf.label}</div>
        <div class="note-row-list">${notes.map((n) => noteRowHtml(n, shelf.key)).join("")}</div>
      </div>`
    )
    .join("");

  list.querySelectorAll("[data-read-note]").forEach((btn) =>
    btn.addEventListener("click", () => openNoteReadModal(state.notes.find((n) => n.id === btn.dataset.readNote)))
  );
  list.querySelectorAll("[data-edit-note]").forEach((btn) =>
    btn.addEventListener("click", () => openNoteModal(state.notes.find((n) => n.id === btn.dataset.editNote)))
  );
  list.querySelectorAll("[data-delete-note]").forEach((btn) =>
    btn.addEventListener("click", () => deleteNote(btn.dataset.deleteNote))
  );
}

document.getElementById("note-search").addEventListener("input", renderNotes);

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
    list.innerHTML = emptyState("history_edu", "Nenhuma sessão registrada ainda.");
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
        <button class="btn btn-ghost" data-edit-session="${s.id}">Editar</button>
        <button class="btn btn-danger" data-delete-session="${s.id}">Excluir</button>
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

function renderAll() {
  renderCombat();
  renderPcs();
  renderNpcs();
  renderItems();
  renderHandouts();
  renderLocationPicker();
  renderMap();
  renderObjectives();
  renderNotes();
  renderSessions();
}

renderAll();
bootstrapCloudSync();

// ==================== Ferramentas de mesa: um botão por ferramenta ====================
const TOOL_PANELS = {
  dice: "panel-dice",
  timer: "panel-timer",
  music: "panel-music",
  scratchpad: "panel-scratchpad",
};

function toggleToolPanel(key) {
  const panelId = TOOL_PANELS[key];
  Object.entries(TOOL_PANELS).forEach(([k, id]) => {
    const panel = document.getElementById(id);
    const btn = document.getElementById(`btn-toggle-${k}`);
    if (k === key) {
      panel.classList.toggle("hidden");
      btn.classList.toggle("active", !panel.classList.contains("hidden"));
    } else {
      panel.classList.add("hidden");
      btn.classList.remove("active");
    }
  });
}

function openToolPanel(key) {
  Object.entries(TOOL_PANELS).forEach(([k, id]) => {
    document.getElementById(id).classList.toggle("hidden", k !== key);
    document.getElementById(`btn-toggle-${k}`).classList.toggle("active", k === key);
  });
}

Object.keys(TOOL_PANELS).forEach((key) => {
  document.getElementById(`btn-toggle-${key}`).addEventListener("click", () => toggleToolPanel(key));
});
document.querySelectorAll(".js-close-tool-panel").forEach((btn) =>
  btn.addEventListener("click", () => {
    btn.closest(".tools-panel").classList.add("hidden");
    document.querySelectorAll(".tools-fab").forEach((f) => f.classList.remove("active"));
  })
);

let diceHistory = [];

function rollAttributeCheck(entityName, attrLabel, value) {
  const roll = 1 + Math.floor(Math.random() * 20);
  let outcome;
  if (roll === 1) outcome = "sucesso crítico";
  else if (roll === 20) outcome = "falha";
  else outcome = roll <= value ? "sucesso" : "falha";
  const cls = outcome.includes("sucesso") ? "dice-check-success" : "dice-check-fail";
  document.getElementById("dice-result").innerHTML = `${roll} <span class="${cls}" style="font-size:1.1rem;">${outcome}</span>`;
  diceHistory.unshift(`${entityName} — ${attrLabel} (${value}): d20=${roll} → ${outcome}`);
  diceHistory = diceHistory.slice(0, 6);
  document.getElementById("dice-history").innerHTML = diceHistory.map(escapeHtml).join("<br>");
  openToolPanel("dice");
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".roll-attr");
  if (btn) rollAttributeCheck(btn.dataset.rollName, btn.dataset.rollLabel, Number(btn.dataset.rollValue));
});

function showDiceResult(total, detail) {
  document.getElementById("dice-result").textContent = total;
  diceHistory.unshift(`${detail} = ${total}`);
  diceHistory = diceHistory.slice(0, 6);
  document.getElementById("dice-history").innerHTML = diceHistory.map(escapeHtml).join("<br>");
}

document.querySelectorAll("[data-roll-die]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const sides = Number(btn.dataset.rollDie);
    const roll = 1 + Math.floor(Math.random() * sides);
    showDiceResult(roll, `d${sides}`);
  })
);

document.getElementById("btn-roll-formula").addEventListener("click", () => {
  const raw = document.getElementById("dice-formula").value.trim().toLowerCase();
  const match = raw.match(/^(\d*)d(\d+)\s*([+-]\s*\d+)?$/);
  if (!match) {
    showDiceResult("?", `fórmula inválida (use ex: 2d6+3)`);
    return;
  }
  const count = Math.min(20, Number(match[1] || 1));
  const sides = Number(match[2]);
  const mod = match[3] ? Number(match[3].replace(/\s/g, "")) : 0;
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  showDiceResult(total, `${count}d${sides}${mod ? (mod > 0 ? "+" + mod : mod) : ""} (${rolls.join(", ")})`);
});

let timerInterval = null;
let timerSecondsLeft = 0;

function updateTimerDisplay() {
  const m = Math.floor(timerSecondsLeft / 60).toString().padStart(2, "0");
  const s = (timerSecondsLeft % 60).toString().padStart(2, "0");
  const display = document.getElementById("timer-display");
  display.textContent = `${m}:${s}`;
  display.classList.toggle("timer-done", timerSecondsLeft === 0 && timerInterval === null && document.getElementById("timer-minutes").dataset.started === "1");
}

document.getElementById("btn-timer-start").addEventListener("click", () => {
  if (timerInterval) return;
  const minutesInput = document.getElementById("timer-minutes");
  if (timerSecondsLeft <= 0) {
    timerSecondsLeft = Math.max(1, Number(minutesInput.value) || 1) * 60;
    minutesInput.dataset.started = "1";
  }
  timerInterval = setInterval(() => {
    timerSecondsLeft = Math.max(0, timerSecondsLeft - 1);
    updateTimerDisplay();
    if (timerSecondsLeft === 0) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }, 1000);
  updateTimerDisplay();
});

document.getElementById("btn-timer-pause").addEventListener("click", () => {
  clearInterval(timerInterval);
  timerInterval = null;
});

document.getElementById("btn-timer-reset").addEventListener("click", () => {
  clearInterval(timerInterval);
  timerInterval = null;
  timerSecondsLeft = 0;
  document.getElementById("timer-minutes").dataset.started = "0";
  document.getElementById("timer-display").classList.remove("timer-done");
  document.getElementById("timer-display").textContent = "00:00";
});

// ==================== Trilha Sonora ====================
// As músicas vão pro Cloudinary (mesmo esquema das fotos) — só o link de cada faixa
// fica salvo no estado da campanha, então as playlists agora aparecem iguais em
// qualquer aparelho, não só no navegador onde a música foi enviada.
// As categorias de playlist são editáveis (não só Combate/Casual/Chefe fixas).
if (!state.playlists) state.playlists = {};
if (!state.playlistCategorias) {
  state.playlistCategorias = [
    { key: "combate", label: "Combate" },
    { key: "casual", label: "Casual" },
    { key: "chefe", label: "Chefe" },
  ];
}

let activePlaylist = state.playlistCategorias[0] ? state.playlistCategorias[0].key : null;
let currentTrackId = null;
const musicAudioEl = document.getElementById("music-audio-el");
const musicVolumeEl = document.getElementById("music-volume");
musicAudioEl.volume = Number(musicVolumeEl.value) / 100;

function renderPlaylistPicker() {
  const wrap = document.getElementById("playlist-picker");
  wrap.innerHTML =
    state.playlistCategorias
      .map(
        (p) => `
      <span class="playlist-pill-wrap">
        <button type="button" class="subtab-btn ${p.key === activePlaylist ? "active" : ""}" data-playlist="${p.key}" style="padding:6px 12px; font-size:0.82rem;">${escapeHtml(p.label)}</button>
        <span class="icon playlist-pill-remove" data-remove-playlist="${p.key}" title="Excluir playlist">close</span>
      </span>
    `
      )
      .join("") +
    `<button type="button" class="subtab-btn" id="btn-add-playlist" style="padding:6px 12px; font-size:0.82rem;"><span class="icon" style="font-size:0.9rem; vertical-align:-2px;">add</span> Nova</button>`;
  wrap.querySelectorAll("[data-playlist]").forEach((btn) =>
    btn.addEventListener("click", () => {
      activePlaylist = btn.dataset.playlist;
      renderPlaylistPicker();
      renderMusicTrackList();
    })
  );
  wrap.querySelectorAll("[data-remove-playlist]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.removePlaylist;
      const cat = state.playlistCategorias.find((c) => c.key === key);
      if (!confirm(`Excluir a playlist "${cat.label}" e todas as músicas dela?`)) return;
      state.playlistCategorias = state.playlistCategorias.filter((c) => c.key !== key);
      delete state.playlists[key];
      if (activePlaylist === key) {
        activePlaylist = state.playlistCategorias[0] ? state.playlistCategorias[0].key : null;
        if (currentTrackId && key === key) stopMusic();
      }
      saveState();
      renderPlaylistPicker();
      renderMusicTrackList();
    })
  );
  document.getElementById("btn-add-playlist").addEventListener("click", () => {
    const label = prompt("Nome da nova playlist (ex: Floresta, Taverna, Mistério):");
    if (!label || !label.trim()) return;
    const key = uid();
    state.playlistCategorias.push({ key, label: label.trim() });
    state.playlists[key] = [];
    activePlaylist = key;
    saveState();
    renderPlaylistPicker();
    renderMusicTrackList();
  });
}

function renderMusicTrackList() {
  const list = document.getElementById("music-track-list");
  const tracks = state.playlists[activePlaylist] || [];
  if (!tracks.length) {
    list.innerHTML = `<div class="music-empty-hint">Nenhuma música nessa playlist ainda.</div>`;
    return;
  }
  list.innerHTML = tracks
    .map(
      (t) => `
    <div class="music-track-row ${t.id === currentTrackId ? "playing" : ""}" data-track-id="${t.id}">
      <span class="icon" style="font-size:1rem;">music_note</span>
      <span class="music-track-name">${escapeHtml(t.nome)}</span>
      <span class="icon music-track-remove" data-remove-track="${t.id}">close</span>
    </div>
  `
    )
    .join("");
  list.querySelectorAll(".music-track-row").forEach((row) =>
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove-track]")) return;
      playTrack(row.dataset.trackId);
    })
  );
  list.querySelectorAll("[data-remove-track]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.removeTrack;
      if (id === currentTrackId) stopMusic();
      state.playlists[activePlaylist] = state.playlists[activePlaylist].filter((t) => t.id !== id);
      saveState();
      renderMusicTrackList();
    })
  );
}

function playTrack(id) {
  const tracks = state.playlists[activePlaylist] || [];
  const track = tracks.find((t) => t.id === id);
  if (!track || !track.url) return;
  musicAudioEl.src = track.url;
  musicAudioEl.play();
  currentTrackId = id;
  document.getElementById("music-now-playing").textContent = track.nome;
  document.getElementById("btn-music-playpause").innerHTML = `<span class="icon">pause</span>`;
  renderMusicTrackList();
}

function stopMusic() {
  musicAudioEl.pause();
  musicAudioEl.removeAttribute("src");
  currentTrackId = null;
  document.getElementById("music-now-playing").textContent = "Nada tocando";
  document.getElementById("btn-music-playpause").innerHTML = `<span class="icon">play_arrow</span>`;
  renderMusicTrackList();
}

function playAdjacentTrack(direction) {
  const tracks = state.playlists[activePlaylist] || [];
  if (!tracks.length) return;
  const idx = tracks.findIndex((t) => t.id === currentTrackId);
  const nextIdx = idx === -1 ? 0 : (idx + direction + tracks.length) % tracks.length;
  playTrack(tracks[nextIdx].id);
}

document.getElementById("music-upload").addEventListener("change", async () => {
  if (!activePlaylist) {
    alert("Crie uma playlist primeiro (botão \"+ Nova\").");
    document.getElementById("music-upload").value = "";
    return;
  }
  const files = Array.from(document.getElementById("music-upload").files || []);
  const nowPlayingEl = document.getElementById("music-now-playing");
  for (const file of files) {
    nowPlayingEl.textContent = `Enviando "${file.name}"...`;
    const url = await uploadToCloudinary(file, "video");
    if (!url) {
      alert(`Não foi possível enviar "${file.name}". Confira sua internet e tente de novo.`);
      continue;
    }
    if (!state.playlists[activePlaylist]) state.playlists[activePlaylist] = [];
    state.playlists[activePlaylist].push({ id: uid(), nome: file.name.replace(/\.[^.]+$/, ""), url });
    saveState();
    renderMusicTrackList();
  }
  const playing = (state.playlists[activePlaylist] || []).find((t) => t.id === currentTrackId);
  nowPlayingEl.textContent = playing ? playing.nome : "Nada tocando";
  document.getElementById("music-upload").value = "";
});

document.getElementById("btn-music-playpause").addEventListener("click", () => {
  if (!currentTrackId) {
    const tracks = state.playlists[activePlaylist] || [];
    if (tracks.length) playTrack(tracks[0].id);
    return;
  }
  if (musicAudioEl.paused) {
    musicAudioEl.play();
    document.getElementById("btn-music-playpause").innerHTML = `<span class="icon">pause</span>`;
  } else {
    musicAudioEl.pause();
    document.getElementById("btn-music-playpause").innerHTML = `<span class="icon">play_arrow</span>`;
  }
});

document.getElementById("btn-music-next").addEventListener("click", () => playAdjacentTrack(1));
document.getElementById("btn-music-prev").addEventListener("click", () => playAdjacentTrack(-1));
musicAudioEl.addEventListener("ended", () => playAdjacentTrack(1));
musicVolumeEl.addEventListener("input", () => {
  musicAudioEl.volume = Number(musicVolumeEl.value) / 100;
});

renderPlaylistPicker();
renderMusicTrackList();

// ==================== Rascunho flutuante ====================
const scratchpadEl = document.getElementById("scratchpad-text");
scratchpadEl.value = state.rascunho || "";
let scratchpadTimer = null;
scratchpadEl.addEventListener("input", () => {
  state.rascunho = scratchpadEl.value;
  clearTimeout(scratchpadTimer);
  scratchpadTimer = setTimeout(() => saveState(), 400);
});

// ==================== Modo Foco ====================
document.getElementById("btn-toggle-foco").addEventListener("click", () => {
  document.body.classList.toggle("foco-mode");
});
