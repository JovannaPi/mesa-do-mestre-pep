# Mesa do Mestre — Perigos & Princesas

Ferramenta web para ajudar a mestrar campanhas de **Perigos & Princesas** (sistema d20 roll-under com os atributos Determinação, Graça e Astúcia).

Site estático, sem backend — todos os dados ficam salvos no `localStorage` do navegador, com exportação/importação de backup em JSON.

## Funcionalidades

- **Combate**: rastreador de iniciativa com rolagem de d20, controle de Coração (PC), Aflições (Cansada/Ferida/Confusa), indicador de turno/rodada.
- **Personagens**: fichas completas das Princesas — Dom da Fada Madrinha, atributos, Coração, Armadura, Dados de Coração/Dom, Talentos, arma, inventário, dinheiro e Trauma.
- **NPCs & Monstros**: banco de fichas rápidas (atributos, Coração, Salvamento, Armadura, tags, anotações) que podem ser adicionadas direto ao combate. Já vem com os principais NPCs e monstros da campanha de Cervovale pré-cadastrados.
- **Campanha**: checklist dos 3 objetivos principais e notas de referência rápida (lore, locais, ganchos).
- **Sessões**: diário de campanha com resumo e ganchos para a próxima sessão.
- **Backup**: exporte/importe todos os dados em um arquivo `.json`.

## Uso

Abra o `index.html` em qualquer navegador — não precisa de instalação nem servidor. Para publicar, basta hospedar os arquivos estáticos (ex: GitHub Pages, Netlify, Vercel).

## Estrutura

```
index.html   estrutura da página e modais
styles.css   tema visual
app.js       estado da aplicação (localStorage), dados pré-cadastrados de Cervovale e lógica das abas
```
