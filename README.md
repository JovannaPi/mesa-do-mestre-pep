# Mesa do Mestre — Perigos & Princesas

Ferramenta web para ajudar a mestrar campanhas de **Perigos & Princesas** (sistema d20 roll-under com os atributos Determinação, Graça e Astúcia).

Site estático, sem backend — todos os dados ficam salvos no `localStorage` do navegador, com exportação/importação de backup em JSON.

## Funcionalidades

- **Combate**: rastreador de iniciativa com rolagem de d20, controle de PV, indicador de turno/rodada.
- **NPCs & Monstros**: banco de fichas rápidas (atributos, PV, defesa, tags, anotações) que podem ser adicionadas direto ao combate.
- **Sessões**: diário de campanha com resumo e ganchos para a próxima sessão.
- **Backup**: exporte/importe todos os dados em um arquivo `.json`.

## Uso

Abra o `index.html` em qualquer navegador — não precisa de instalação nem servidor. Para publicar, basta hospedar os arquivos estáticos (ex: GitHub Pages, Netlify, Vercel).

## Estrutura

```
index.html   estrutura da página e modais
styles.css   tema visual
app.js       estado da aplicação (localStorage) e lógica das três abas
```
