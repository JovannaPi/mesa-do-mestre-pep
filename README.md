# Mesa do Mestre — Perigos & Princesas

Ferramenta web para ajudar a mestrar campanhas de **Perigos & Princesas** (sistema d20 roll-under com os atributos Determinação, Graça e Astúcia).

Site estático (sem servidor próprio), com `localStorage` como base local — sempre funciona offline — e sincronização opcional na nuvem via Firebase Firestore, pra acessar a mesma campanha de qualquer aparelho. Fotos e músicas vão pro Cloudinary (upload não-assinado). Login é anônimo e automático (sem tela, sem senha), só pra restringir leitura/escrita no Firestore a quem carregou o app de verdade.

## Funcionalidades

- **Combate**: rastreador de iniciativa com rolagem de d20, controle de Coração (PC), Aflições (Cansada/Ferida/Confusa), indicador de turno/rodada, ficha rápida de combatente.
- **Personagens**: fichas completas das Princesas — Dom da Fada Madrinha, atributos, Coração, Armadura, Dados de Coração/Dom, Talentos, arma, inventário, dinheiro, Trauma e Maldição Doce.
- **NPCs & Monstros**: banco de fichas rápidas (atributos, Coração, Salvamento, Armadura, tags, anotações) que podem ser adicionadas direto ao combate. Já vem com os principais NPCs e monstros da campanha de Cervovale pré-cadastrados.
- **Compêndio**: NPCs, Monstros, Itens, busca por Local, e Imagens (com opção de mostrar/esconder pras jogadoras).
- **Mapa**: múltiplos mapas, marcadores ligados a NPCs/Monstros/Princesas do banco ou livres, grid, régua, sincronizado ao vivo com a página das jogadoras (`jogador.html`).
- **Campanha**: objetivos, notas por prateleira (Aventura completa, Regras rápidas, Lore & Mundo, Achados), janelas de leitura flutuantes.
- **Sessões**: diário de campanha com resumo e ganchos para a próxima sessão.
- **Ferramentas de mesa**: dados (com fórmulas e notação clicável dentro de qualquer texto), cronômetro, playlists de música por categoria, bloco de rascunho.
- **Backup**: exporte/importe todos os dados em um arquivo `.json`.

## Uso

Abra o `index.html` em qualquer navegador — não precisa de instalação nem servidor. Para publicar, basta hospedar os arquivos estáticos (ex: GitHub Pages, Netlify, Vercel). Pra sincronização na nuvem funcionar, o projeto Firebase precisa ter "Anonymous" ativado em Authentication → Sign-in method (as regras do Firestore em `firestore.rules` exigem login).

## Estrutura

```
index.html          estrutura da página e modais (visão da Mestra)
jogador.html         página compartilhada com as jogadoras (mapa + handout)
styles.css           tema visual
app.js               estado da aplicação, dados pré-cadastrados de Cervovale e lógica das abas (Mestra)
jogador.js            lógica da página das jogadoras
firebase-config.js    conexão com Firestore (sincronização na nuvem) e login anônimo
firestore.rules       regras de acesso do Firestore — precisam ser publicadas manualmente no Console do Firebase
```
