const STORAGE_KEY = "mestre-pep-data-v2";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultState() {
  return {
    campaignName: "Cervovale",
    npcs: [],
    pcs: [],
    sessions: [],
    notes: [],
    objectives: [],
    combat: { round: 1, currentIndex: 0, combatants: [] },
    seeded: false,
    seededV2: false,
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

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
      texto:
        "Vocês são Princesas num mundo de conto de fadas com um verniz mais sombrio do que o normal. Uma de vocês tem uma amiga mensageira que sumiu há quase um ano; preocupada, formou um grupo de busca com as outras.\n\n" +
        "O mundo: reinos próximos, vilas pequenas, florestas encantadas com reputações e perigos próprios. Magia existe e é aceita, mas ainda temida. \"Princesa\" é um título ligado a ter um Dom concedido por uma Fada Madrinha — não precisa ser realeza de sangue.",
    },
    {
      id: uid(),
      titulo: "Gancho inicial — O grito na floresta",
      texto:
        "No Bosque Emaranhado, a caminho de Cervovale, um cheiro doce se mistura ao da terra molhada e um grito de criança corta o silêncio. É Rui Silva, preso numa árvore, perseguido por um Ursinho de Goma.\n\n" +
        "Se salvarem Rui: ele guia o grupo até Cervovale e seu pai Geraldo (padeiro) fica aliviado.\n" +
        "Se ignorarem/perderem: o urso leva Rui embora; ele reaparece depois capturado pelo Cavaleiro de Chocolate Amargo. Isso muda a disponibilidade da Padaria (Geraldo fica preocupado demais para abrir).",
    },
    {
      id: uid(),
      titulo: "A Maldição de Dulcineia",
      texto:
        "Há um ano, moradores mataram a bruxa Dulcineia, que sequestrava crianças. Antes de morrer, ela amaldiçoou a vila: todos aos poucos viram doce.\n\n" +
        "A guarda Selene usou o Espelho Maléfico (escondido por Teodoro na Mansão da Prefeitura) para descobrir a cura — e morreu logo depois. A resposta: reunir 3 itens e jogá-los no poço da praça (ver aba Objetivos).\n\n" +
        "O Cavaleiro de Chocolate Amargo patrulha o Bosque Emaranhado e bloqueia quem tenta sair da vila.",
      },
    {
      id: uid(),
      titulo: "Cervovale — locais e NPCs-chave",
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
      texto:
        "Vale das Bagas: aldeia das fadas pequenas, protegida por névoa; aterrorizada pelo Rei Rato (→ objetivo 1).\n" +
        "Lago da Saudade Eterna: portal para o Baile Eterno — ativa entrando na água com um item de origem feérica.\n" +
        "Torre da Bruxa: isolada e protegida por magia; onde está o Pingente Rouba-Alma (→ objetivo 3).\n" +
        "Cova Misteriosa: onde o Espelho Maléfico pode ser recarregado se estiver quebrado.\n" +
        "O Cavaleiro de Chocolate Amargo patrulha a floresta; regenera 1 dia depois de derrotado, a menos que seja derretido/dissolvido.",
    },
    {
      id: uid(),
      titulo: "Vale das Bagas — o Rei Rato",
      texto:
        "Pólen amaldiçoado deixou o mel enfeitiçado; os ratos se uniram pelas caudas em mel pegajoso, formando o Rei Rato, que ocupa o depósito de comida das fadas pequenas.\n\n" +
        "Rainha Gardênia governa a aldeia e ensina como ativar o Lago da Saudade Eterna. Derrotar o Rei Rato e cortar sua cauda dá a Cauda do Rei Rato (objetivo 1).",
    },
    {
      id: uid(),
      titulo: "Baile Eterno — o Anel do Rei-Elfo",
      texto:
        "Festa sem fim no reino das fadas altas, dividida em 3 seções: Alvorada (Jardim), Meio-Dia (Banquete) e Crepúsculo (Salão de Baile, onde fica o Rei-Elfo).\n\n" +
        "O Rei-Elfo dá seu anel a quem completar seu desafio cronometrado: conseguir um Sorriso da Senhora Neves, um Segredo do Príncipe Aurélio e um Elogio da Duquesa Jacinda antes que a ampulheta se esgote.\n\n" +
        "Élton (marido de Maya) também está preso aqui, com Ilayda — devolvê-lo resolve a missão pessoal de Maya.",
    },
    {
      id: uid(),
      titulo: "Torre da Bruxa — confronto final",
      texto:
        "Três entradas: porta da frente (guardada por Construtos de Chocolate com Hortelã), janela do topo (pequena demais) ou dreno sob a torre (leva à cozinha).\n" +
        "Senha para entrar pela frente: \"Maçapão Maravilhoso\".\n\n" +
        "O Pingente Rouba-Alma está num corpo-construto no Quarto da Bruxa. Ao removê-lo, a alma de Dulcineia escapa:\n" +
        "— Se o Ovo de Dragão do Viveiro foi destruído → ela vira uma Aparição.\n" +
        "— Se não foi destruído → ela possui o dragão e ataca Cervovale em ~1 hora.\n\n" +
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
      "Prefeito de Cervovale, transformando-se em algodão-doce. Esconde o Espelho Maléfico (rachado) num baú com fundo falso sob a cama. Missão: ajudar a levantar o moral da vila → Chave de prata da cidade."),
    npc("Baltasar \"Baz\" Hartly", "NPC", 14, 10, 10, 12, 12, 1, ["cervovale", "guarda", "salão comunitário"],
      "Líder de fato da guarda, virando bala azeda de limão. Sabe sobre fadas na névoa e já lutou contra o Cavaleiro de Chocolate Amargo. Missão: controle de pragas → Hortelãnça (d8, 2d8 em carga)."),
    npc("Hannah Falcão", "NPC", 8, 12, 10, 8, 10, 0, ["cervovale", "estalagem"],
      "Dona d'A Cabra Sorridente, cheira a canela. Sabe que Élton sonhava com música vinda da floresta antes de sumir."),
    npc("Constança \"Connie\" Oriente", "NPC", 10, 14, 11, 9, 12, 0, ["cervovale", "estalagem", "mensageira"],
      "Mensageira presa na vila, pele virando hortelã listrada. Já enfrentou o Cavaleiro de Chocolate Amargo tentando fugir; tem canivete de prata."),
    npc("Ezequiel \"Zeca\" Grifo", "NPC", 9, 9, 13, 9, 11, 0, ["cervovale", "armazém", "lojista"],
      "Lojista otimista, troca itens comuns 1-por-1. Missão: consertar objetos quebrados → Luneta Feérica (revela magia, itens escondidos, forma verdadeira de Selene)."),
    npc("Geraldo Silva", "NPC", 11, 8, 9, 11, 11, 1, ["cervovale", "padaria"],
      "Padeiro virando biscoito de gengibre, pai de Rui. Esteve no ataque original a Dulcineia. Missões: óculos perdidos (esquilo levou) → biscoitos com efeito Restauração; achar Biscoitinha, a cadela."),
    npc("Rui Silva", "NPC", 9, 11, 10, 7, 12, 0, ["cervovale", "padaria", "criança"],
      "Filho de Geraldo, resgatado no gancho inicial (ou capturado pelo Cavaleiro, se falharem). Único sequestrado ainda não transformado em doce; lembra da cantiga da bruxa."),
    npc("Rosana \"Rosa\" Águas-Claras", "NPC", 9, 10, 13, 8, 11, 0, ["cervovale", "poções", "irmã de selene"],
      "Irmã mais nova de Selene, vira bolinho aos poucos, administra a loja de poções sozinha. Missão: testar vacina contra a Maldição Doce (50% de sucesso) → Poção Encolhedora + 2 poções."),
    npc("Maya Élis", "NPC", 13, 9, 12, 11, 12, 1, ["cervovale", "ferraria", "lore de fadas"],
      "Ferreira, esposa do desaparecido Élton. Grande conhecedora de fadas; dá retalhos de ferro contra fadas. Missão: encontrar Élton no Baile Eterno → espada Estalar de Segundos (d8, ataca 2x)."),
    npc("Ashkan", "NPC", 12, 11, 15, 12, 14, 0, ["bosque emaranhado", "fada alta", "círculo de cogumelos"],
      "Fada alta presa numa pedra por Finnegan, no Círculo de Cogumelos. Se libertado (resposta do enigma: \"laranja\"), ensina a ativar o Lago da Saudade Eterna e menciona a Senhora Neves."),
    npc("Castanho", "NPC", 13, 11, 10, 10, 14, 1, ["vale das bagas", "guarda espinheiro"],
      "Líder da Guarda Espinheiro, desconfiado de humanos. Missão: achar seu vaga-lume de estimação (preso no Depósito, sala 3, no Limo Vermelho Tóxico) → Arco Ferrão."),
    npc("Rainha Gardênia", "NPC", 15, 13, 14, 14, 16, 1, ["vale das bagas", "realeza fada"],
      "Monarca das fadas pequenas, enganada por Dulcineia no passado. Sabe ativar o Lago da Saudade Eterna. Devolver a Colher de Mel a deixa em dívida com o grupo."),
    npc("O Rei-Elfo", "Monstro", 18, 16, 20, 15, 15, 0, ["baile eterno", "chefe", "fada alta"],
      "Anfitrião do Baile Eterno, quase onipotente em seu domínio. Se reduzido a 0 Coração, reaparece curado. 4 Dados de Dom — pode lançar qualquer magia. Dá seu anel a quem completar seu desafio."),
    npc("Selene (Lobo Mau)", "Monstro", 12, 10, 9, 8, 12, 3, ["bosque emaranhado", "lobisomem"],
      "Ataca duas vezes: Garras (d4) e Mordida (d6). Armas prateadas/encantadas ignoram Armadura. Se Ferida, teste Determinação ou vire lobisomem. Derrotada, volta à forma humana e dá sua Corda de Escalada."),
    npc("O Cavaleiro de Chocolate Amargo", "Monstro", 14, 8, 8, 12, 13, 3, ["bosque emaranhado", "chefe", "regenera"],
      "Ataca 2x com Espada (d8) ou 1x com Lança (d8, 2d8 em carga montada). Ferida por ele → Maldição Doce (avança 1 estágio se já afligido). Suscetível a derretimento. Regenera após 1 dia, a menos que derretido/dissolvido."),
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
      texto:
        "TESTE DE VIRTUDE: role 1d20 — tirar igual ou menos que o atributo (Determinação/Graça/Astúcia) é sucesso. 1 é sempre sucesso; 20 é sempre falha.\n" +
        "Vantagem: role 2d20, use o menor. Desvantagem: role 2d20, use o maior.\n\n" +
        "DADOS DE DOM (DD): 1d6 por nível, gastos para usar habilidades de Dom/magia. Ao rolar, escolha quantos DD usar. Resultado 1-3: o dado volta. Resultado 4-6: é gasto até Descansar. Tirar duplas = sofre um Acidente (efeito colateral do Dom).\n" +
        "DADOS CORAÇÃO (DC): 1d4 por nível. Gaste durante um Piquenique para recuperar PC (Coração), ou gaste para somar ao teste falho de uma amiga (+ o valor rolado).\n\n" +
        "[DADOS] = quantos DD você rolou. [SOMA] = o total desses DD. Alcance por [DADOS]: 1 = Por Perto, 2 = A Uma Pedrada, 3+ = Lá Longe.",
    },
    {
      titulo: "Regras rápidas — Combate",
      texto:
        "INICIATIVA: teste ASTÚCIA. Sucesso = age antes do inimigo; falha = age depois. Mantém a mesma ordem toda rodada. Tirar 1 é crítico: pode agir duas vezes no primeiro turno.\n\n" +
        "NO SEU TURNO: mover-se Por Perto + uma Ação. Pode Reagir 1x por rodada no turno de qualquer pessoa (ex: usar Dom, gastar Dado Coração).\n\n" +
        "ATACANDO: teste Determinação (corpo a corpo) ou Graça (à distância). Sucesso → role o dano. Tirar 1 é crítico: role 2 dados de dano e some.\n" +
        "DEFENDENDO: teste Graça para evitar o ataque; subtraia a Armadura do dano recebido. O inimigo tirar 20 é crítico: ignora sua Armadura.\n" +
        "MANOBRAS (agarrar, derrubar, empurrar etc.): Teste de Virtude de Determinação, Graça ou Astúcia, conforme a manobra.\n\n" +
        "FERIMENTOS: chegar a 0 Coração = não pode Agir/Mover-se até ser estabilizada. Role d8 na Tabela de Ferimentos (efeitos de curto/médio prazo, algumas permanentes). Dano maior que o dobro do Coração máximo = 1 ponto de Trauma imediato.",
    },
    {
      titulo: "Regras rápidas — Recuperação, Aflições & Trauma",
      texto:
        "PIQUENIQUE: pequena pausa (Gastar Tempo + 1 refeição). Gaste Dados Coração à vontade, role e recupere PC igual à soma.\n" +
        "DESCANSO: 1x a cada 24h. 8h de sono com comida, água e abrigo/fogueira → restaura todo o Coração e todos os Dados de Dom/Coração gastos. Consome 1 refeição.\n\n" +
        "AFLIÇÕES (dão Desvantagem numa Virtude específica):\n" +
        "• Cansada → Desvantagem em Determinação\n" +
        "• Atordoada → Desvantagem em Graça\n" +
        "• Confusa → Desvantagem em Astúcia\n" +
        "Um Descanso ou Piquenique geralmente encerra uma Aflição, salvo indicação contrária.\n\n" +
        "TRAUMA (ao acumular, role/consulte a Mestra): 1) não pode usar DD por 24h; 2) idem + fica apavorada pela causa até superar o medo; 3) fim de jogo para a personagem (aposentadoria, sono mágico, captura, morte trágica — decidido à mesa).\n\n" +
        "SOBRECARGA: carrega até seu valor de Determinação sem penalidade; fica Cansada acima disso; não pode carregar mais que o dobro da Determinação. Itens Volumosos contam como 2 espaços; consumíveis (flechas, comida, tochas) se amontoam num único espaço.",
    },
    {
      titulo: "Maldições (tabela oficial, d12)",
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
      texto:
        "Aventura para 2 a 4 Princesas, do nível 1 ao 4. Combina exploração de masmorra, encontros sociais e resolução de problemas — a ordem fica a critério do grupo.\n\n" +
        "Ganchos alternativos (escolha um ou crie o seu):\n" +
        "• O grito na floresta (o que já está na aba Notas): uma Princesa tem uma amiga mensageira desaparecida.\n" +
        "• Doces Sonhos: a Fada Madrinha de uma Princesa nunca deixa de indicar boas ações através de sonhos enigmáticos. O sonho mais recente trazia cheiro de pão de mel e a voz sussurrando: \"Nada, minha querida, é tão doce quanto ajudar quem precisa.\"\n\n" +
        "Sempre descreva a premissa às jogadoras antes de começar, para que possam criar Princesas que se encaixem na história.",
    },
    {
      titulo: "Ferramentas de segurança à mesa",
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
      state.notes.push({ id: uid(), titulo: n.titulo, texto: n.texto });
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

seedCampaignData();
seedRulesReference();
saveState();

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

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function parseTags(str) {
  return str.split(",").map((t) => t.trim()).filter(Boolean);
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

function openNpcModal(npc) {
  document.getElementById("npc-modal-title").textContent = npc ? "Editar NPC/Monstro" : "Novo NPC/Monstro";
  document.getElementById("npc-id").value = npc ? npc.id : "";
  document.getElementById("npc-nome").value = npc ? npc.nome : "";
  document.getElementById("npc-tipo").value = npc ? npc.tipo : "NPC";
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
        <span>Coração <b>${n.coracao}</b></span>
        <span>Salv. <b>${n.salvamento}</b></span>
        <span>Armadura <b>${n.armadura}</b></span>
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

// ==================== PCs (Princesas) ====================
const pcModal = document.getElementById("modal-pc");
const formPc = document.getElementById("form-pc");

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
  pcModal.classList.remove("hidden");
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
    aflicoes: existing ? existing.aflicoes : { cansada: false, atordoada: false, confusa: false },
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
    list.innerHTML = `<div class="empty-state">Nenhuma Princesa cadastrada ainda.</div>`;
    return;
  }
  list.innerHTML = state.pcs
    .map(
      (p) => `
    <div class="pc-card">
      <h3>${escapeHtml(p.nome)}</h3>
      ${p.jogadora ? `<p class="pc-player">Jogadora: ${escapeHtml(p.jogadora)}</p>` : ""}
      ${p.domNome ? `<div class="pc-dom">✨ ${escapeHtml(p.domNome)}</div>` : ""}
      ${p.domDescricao ? `<p class="pc-dom-desc">${escapeHtml(p.domDescricao)}</p>` : ""}
      <div class="pc-stats">
        <span>DET <b>${p.determinacao}</b></span>
        <span>GRA <b>${p.graca}</b></span>
        <span>AST <b>${p.astucia}</b></span>
        <span>Armadura <b>${p.armadura}</b></span>
        <span>Dinheiro <b>${p.dinheiro} pp</b></span>
      </div>
      <div class="hp-control">
        <button class="icon-btn" data-pc-hp-down="${p.id}">➖</button>
        <span>Coração: ${p.coracaoAtual} / ${p.coracaoMax}</span>
        <button class="icon-btn" data-pc-hp-up="${p.id}">➕</button>
      </div>
      <div class="pc-misc">Dados de Coração: ${dieTrack(p.dadoCoracaoTotal, p.dadoCoracaoUsados, "pc-dice-coracao", p.id)}</div>
      <div class="pc-misc">Dados de Dom: ${dieTrack(p.dadoDomTotal, p.dadoDomUsados, "pc-dice-dom", p.id)}</div>
      <div class="affliction-toggles">
        <button class="affliction-btn ${p.aflicoes.cansada ? "active cansada" : ""}" data-pc-affliction="${p.id}" data-key="cansada">Cansada</button>
        <button class="affliction-btn ${p.aflicoes.atordoada ? "active atordoada" : ""}" data-pc-affliction="${p.id}" data-key="atordoada">Atordoada</button>
        <button class="affliction-btn ${p.aflicoes.confusa ? "active confusa" : ""}" data-pc-affliction="${p.id}" data-key="confusa">Confusa</button>
      </div>
      ${p.arma ? `<div class="pc-misc"><b>Arma:</b> ${escapeHtml(p.arma)}</div>` : ""}
      ${p.talentos.length ? `<div class="pc-misc"><b>Talentos:</b> ${p.talentos.map(escapeHtml).join(", ")}</div>` : ""}
      ${p.inventario.length ? `<div class="pc-misc"><b>Minhas coisas:</b> ${p.inventario.map(escapeHtml).join(", ")}</div>` : ""}
      ${p.trauma ? `<div class="pc-misc"><b>Trauma:</b> ${escapeHtml(p.trauma)}</div>` : ""}
      <div class="pc-card-actions">
        <button class="btn btn-ghost" data-edit-pc="${p.id}">✏️ Editar</button>
        <button class="btn btn-danger" data-delete-pc="${p.id}">🗑️ Excluir</button>
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

formCombatant.addEventListener("submit", (e) => {
  e.preventDefault();
  const coracaoMax = Number(document.getElementById("c-coracao-max").value) || 0;
  state.combat.combatants.push({
    id: uid(),
    nome: document.getElementById("c-nome").value.trim(),
    iniciativa: Number(document.getElementById("c-iniciativa").value) || 0,
    coracaoMax,
    coracaoAtual: coracaoMax,
    isPc: document.getElementById("c-is-pc").checked,
    aflicoes: newAfflictions(),
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
        <span>${escapeHtml(n.nome)} <small style="color:var(--text-dim)">(${escapeHtml(n.tipo)}, Coração ${n.coracao})</small></span>
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
          coracaoMax: n.coracao,
          coracaoAtual: n.coracao,
          isPc: false,
          aflicoes: newAfflictions(),
        });
        saveState();
        renderCombat();
      })
    );
  }
  fromNpcModal.classList.remove("hidden");
});
document.getElementById("btn-cancel-from-npc").addEventListener("click", () => fromNpcModal.classList.add("hidden"));

const fromPcModal = document.getElementById("modal-from-pc");
document.getElementById("btn-add-from-pc").addEventListener("click", () => {
  const list = document.getElementById("from-pc-list");
  if (state.pcs.length === 0) {
    list.innerHTML = `<div class="empty-state">Nenhuma Princesa cadastrada. Crie uma na aba "Personagens" primeiro.</div>`;
  } else {
    list.innerHTML = state.pcs
      .map(
        (p) => `
      <div class="from-npc-item">
        <span>${escapeHtml(p.nome)} <small style="color:var(--text-dim)">(Coração ${p.coracaoAtual}/${p.coracaoMax})</small></span>
        <button class="btn btn-secondary" data-add-from-pc="${p.id}">+ Adicionar</button>
      </div>
    `
      )
      .join("");
    list.querySelectorAll("[data-add-from-pc]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const p = state.pcs.find((x) => x.id === btn.dataset.addFromPc);
        state.combat.combatants.push({
          id: uid(),
          nome: p.nome,
          iniciativa: p.astucia,
          coracaoMax: p.coracaoMax,
          coracaoAtual: p.coracaoAtual,
          isPc: true,
          aflicoes: Object.assign({}, p.aflicoes),
        });
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

function renderCombat() {
  document.getElementById("round-number").textContent = state.combat.round;
  const list = document.getElementById("combat-list");
  if (state.combat.combatants.length === 0) {
    list.innerHTML = `<div class="empty-state">Nenhum combatente na mesa. Adicione manualmente ou importe do banco de NPCs/Princesas.</div>`;
    return;
  }
  list.innerHTML = state.combat.combatants
    .map((c, idx) => {
      const hpPct = c.coracaoMax > 0 ? (c.coracaoAtual / c.coracaoMax) * 100 : 0;
      const hpClass = hpPct <= 25 ? "critical" : hpPct <= 50 ? "low" : "";
      const isCurrent = idx === state.combat.currentIndex;
      return `
      <div class="combatant-card ${isCurrent ? "current-turn" : ""} ${c.isPc ? "is-pc" : "is-npc"}">
        <div class="combatant-init">${c.iniciativa}</div>
        <div class="combatant-name">${isCurrent ? "▶ " : ""}${escapeHtml(c.nome)}</div>
        <div class="hp-control">
          <button class="icon-btn" data-hp-down="${c.id}">➖</button>
          <span>${c.coracaoAtual} / ${c.coracaoMax}</span>
          <button class="icon-btn" data-hp-up="${c.id}">➕</button>
          <div class="hp-bar-wrap"><div class="hp-bar ${hpClass}" style="width:${hpPct}%"></div></div>
        </div>
        <div class="affliction-toggles">
          <button class="affliction-btn ${c.aflicoes.cansada ? "active cansada" : ""}" data-c-affliction="${c.id}" data-key="cansada">Cansada</button>
          <button class="affliction-btn ${c.aflicoes.atordoada ? "active atordoada" : ""}" data-c-affliction="${c.id}" data-key="atordoada">Atordoada</button>
          <button class="affliction-btn ${c.aflicoes.confusa ? "active confusa" : ""}" data-c-affliction="${c.id}" data-key="confusa">Confusa</button>
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
  list.querySelectorAll("[data-c-affliction]").forEach((btn) =>
    btn.addEventListener("click", () => toggleCombatantAffliction(btn.dataset.cAffliction, btn.dataset.key))
  );
  list.querySelectorAll("[data-remove-combatant]").forEach((btn) =>
    btn.addEventListener("click", () => removeCombatant(btn.dataset.removeCombatant))
  );
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
    list.innerHTML = `<div class="empty-state">Nenhum objetivo cadastrado.</div>`;
    return;
  }
  list.innerHTML = state.objectives
    .map(
      (o) => `
    <div class="objective-row ${o.feito ? "done" : ""}">
      <input type="checkbox" data-objective-check="${o.id}" ${o.feito ? "checked" : ""}>
      <span>${escapeHtml(o.texto)}</span>
      <button class="icon-btn" data-objective-delete="${o.id}" title="Remover">🗑️</button>
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

function renderNotes() {
  const list = document.getElementById("note-list");
  if (state.notes.length === 0) {
    list.innerHTML = `<div class="empty-state">Nenhuma nota cadastrada.</div>`;
    return;
  }
  list.innerHTML = state.notes
    .map(
      (n) => `
    <div class="session-card">
      <div class="session-card-header"><h3>${escapeHtml(n.titulo)}</h3></div>
      <p class="session-text">${escapeHtml(n.texto)}</p>
      <div class="session-card-actions">
        <button class="btn btn-ghost" data-edit-note="${n.id}">✏️ Editar</button>
        <button class="btn btn-danger" data-delete-note="${n.id}">🗑️ Excluir</button>
      </div>
    </div>
  `
    )
    .join("");

  list.querySelectorAll("[data-edit-note]").forEach((btn) =>
    btn.addEventListener("click", () => openNoteModal(state.notes.find((n) => n.id === btn.dataset.editNote)))
  );
  list.querySelectorAll("[data-delete-note]").forEach((btn) =>
    btn.addEventListener("click", () => deleteNote(btn.dataset.deleteNote))
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

function renderAll() {
  renderCombat();
  renderPcs();
  renderNpcs();
  renderObjectives();
  renderNotes();
  renderSessions();
}

renderAll();
