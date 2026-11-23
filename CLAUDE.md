# Ofertas RoB7 V3 — notas pro Claude

Programa Node.js (ESM, Node >= 22) que roda escondido no Windows do RoB e posta ofertas de afiliado no WhatsApp.
O dono fala português do Brasil, de forma simples; mensagens, comentários e textos do painel são em PT-BR.

## Arquitetura
- `src/main.js` liga tudo. Dados ficam em `%LOCALAPPDATA%\OfertasRoB7` (ou `ROB7_DATA_DIR`), nunca na pasta do código.
- `src/store.js` banco em JSON com gravação atômica (`db.json`, `settings.json`).
- `src/whatsapp.js` Baileys (conexão por QR, `markOnlineOnConnect: false`, sem histórico).
- `src/categories.js` categorias (geral, veiculos, moda, casa, eletronicos): grupos, horário (`offsetMin` desencontra), palavras e filtros do agente, e `subcategories` (id, nome, palavras) de cada categoria. `classifySubcategory()` nunca devolve vazio quando a categoria tem subcategoria. Migrações por `categoriesVersion`: 1 = config antiga (groups.offers + queue) vira "Geral"; 2 = subcategorias (e as palavras do Bea7 na Moda, se você não tiver editado as suas).
- `src/offers.js` ofertas (status: aguardando, fila, enviando, postada, falhou, descartada), `category` e `subcategory` em cada oferta, anti-repetição por identidade do produto. Tudo que entra na fila passa por `approve()`, que chama `rebalance()` (rodízio das subcategorias). `interleaveQueue()` é o botão do painel: faz `db.backup()` antes.
- `src/queue-order.js` funções puras da ordem da fila: `interleave()` (rodízio estável por subcategoria, `keepFirst` protege a próxima a postar) e `sameOrder()`.
- `src/queue.js` uma fila por categoria (horário/dias/intervalo dela), posta foto (JPEG) + legenda nos grupos da categoria. Um grupo só pode ser de uma categoria.
- `src/commands.js` Luna Ofertas no grupo de comando (comandos simples; `buscar`, `categoria 12 moda`, `ver 12`).
- `src/ai.js` IA Claude (chave em settings.ai, nunca vai pro painel) com limite de gasto por dia (`dailyLimitUsd`, padrão 0,25); passou, para até amanhã.
- `src/agent/*` agente RoB7: busca no ML (lista.mercadolivre.com.br no navegador invisível), filtra (`rules.js`), IA escolhe, gera meli.la no Gerador de links da Central de Afiliados (plano B: Compartilhar). Shopee só com a API. Modo treino (aguardando + aviso no zap) ou piloto automático (vai pra fila).
- `src/sources.js` "Copiar de outros grupos": a Luna só LÊ grupos de promoção de fora (settings.sources), lê o produto do link deles, gera o NOSSO link (meli.la pelo Gerador; Shopee só com API) e cria a oferta na categoria certa (direto na fila ou esperando aprovação). Grupo de fora não pode ser de categoria nem o de comando.
- `src/products/*` leitura de produto: Mercado Livre (HTML/JSON-LD/JSON embutido + navegador invisível), Shopee (Open API oficial ou navegador invisível capturando `/api/v4/pdp/get_pc`), TikTok (desligado por padrão).
- `src/browser.js` Chrome do PC via playwright-core, headless, perfil próprio; janela visível só pra login.
- `src/server.js` painel Express (127.0.0.1:3777), login com senha, SSE em `/api/events`. `public/` é o painel (JS puro).
- `windows/` instalador, início automático escondido (VBS + loop.cmd), parar/atualizar.
- `src/tunnel.js` túnel Cloudflare pro celular: roda `cloudflared tunnel run` com `TUNNEL_TOKEN` (sem serviço do Windows); PID em `tunel.pid` pra fechar sobra. Mudar túnel/senha/login das lojas: só pedido local (`isLocalRequest`).
- `public/manifest.webmanifest` + `public/icons/` deixam o painel instalável no iPhone (Adicionar à Tela de Início).

## Regras do dono (não quebrar)
1. O link publicado é EXATAMENTE o colado (`publishUrl` = `inputUrl`). Nunca encurtar/normalizar/tirar parâmetro. Única exceção: link normal da Shopee + API configurada → `generateShortLink`.
2. Nada inventado: dado que não dá pra confirmar fica vazio e vira "falta X".
3. Foto sempre como imagem JPEG com legenda (nunca figurinha, nunca arquivo).
4. Layout: (*🔥 X% OFF*, conta real do De/Por, ≥5%) / 🛍️ nome / ❌ De / 🔥 Por / (🎟️ Cupom) / 🛒 Compre aqui + link / ⚠️ aviso. A prévia do painel (`previewCaption` em public/app.js) copia `buildCaption` de src/message.js: mudou um, muda o outro.
5. A Luna só posta nos grupos marcados (das categorias) e só obedece no grupo de comando. O número é o mesmo da Luna da Central: nunca mexer em outros grupos. Única exceção: os grupos de "Copiar de outros grupos", que ela só LÊ (nunca escreve neles).
6. Mercado Livre por link `meli.la` é o fluxo principal e tem que continuar funcionando.
7. A Moda é a categoria do grupo feminino (Ofertas Bea7) e por isso procura panelas e maquiagem. "jogo de panelas" está nela e na Casa: hoje ganha a Moda (vem antes na lista). Se a Casa ganhar grupo, decidir de quem fica.
8. O link que o RoB7 (e a cópia de outros grupos) publica é o gerado na conta de afiliado do RoB; o link de outra pessoa NUNCA é publicado (sem o nosso link = não vira oferta). Gasto da IA nunca passa do limite do dia.

## Testes
`npm test` (node:test) e `npm run check` (sintaxe). Rodar os dois antes de entregar.
