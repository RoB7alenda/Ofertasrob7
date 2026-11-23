# Ofertas RoB7 — V3

Programa que roda escondido no seu PC e posta ofertas de afiliado (Mercado Livre, Shopee e TikTok Shop) nos seus grupos do WhatsApp, pela **Luna Ofertas**.

- WhatsApp conectado **por QR code** (como "aparelho conectado"), sem API paga e sem extensão no Chrome.
- Você manda o link pra Luna no zap (ou cola no painel), ela monta a oferta com **foto grande + texto embaixo** e pergunta se pode postar.
- Você responde **sim** e ela põe na **fila**, que solta 1 oferta a cada 30 minutos, das 8h às 22h (dá pra mudar).
- **Categorias** (Veículos, Moda, Casa e cozinha, Eletrônicos e games + Geral): cada uma tem o **seu grupo** e a **sua fila**, com horários desencontrados.
- **Subcategorias** (dentro de uma categoria, ex.: na Moda: panelas, roupas, íntimas, maquiagem, unhas): a fila sai em **rodízio** entre elas, então o grupo não recebe várias do mesmo tipo em sequência. Vem preenchida na Moda e você edita em Configurações › Categorias.
- **Copiar de outros grupos**: a Luna entra num grupo de promoção de outra pessoa e só lê. Cada oferta de lá vira oferta sua, com o **seu link de afiliado** pro mesmo produto, na fila da categoria certa.
- **Agente RoB7**: procura ofertas sozinho no Mercado Livre (e na Shopee, quando tiver a API), filtra (desconto 20%+, nota 4,5+, frete grátis/Full), a **IA (Claude)** escolhe as melhores e ele gera o **seu link meli.la**. No **modo treino** tudo espera você aprovar; no **piloto automático** vai direto pra fila.
- Painel no PC e no celular, com senha.

---

## 1. Instalar (uma vez só)

1. Baixe este projeto: no GitHub, botão verde **Code › Download ZIP**.
2. Extraia o ZIP numa pasta fixa, por exemplo `C:\OfertasRoB7` (não deixe na pasta Downloads).
3. Abra a pasta `windows` e dê dois cliques em **INSTALAR.bat**.
   - Se pedir pra instalar o **Node.js**, deixe instalar, feche a janela e abra o **INSTALAR.bat** de novo.
4. No fim, o painel abre sozinho no navegador: **http://127.0.0.1:3777**
5. Crie a senha do painel (mínimo 6 caracteres).

O INSTALAR.bat também:
- faz o programa **ligar sozinho junto com o Windows** (escondido, sem janela);
- cria o atalho **Ofertas RoB7** na Área de Trabalho, que abre o painel.

## 2. Configurar (uma vez só)

Siga o quadro **Primeiros passos** na tela Início:

1. **Conectar o WhatsApp da Luna** — na tela Início aparece o QR code. No celular da Luna: WhatsApp › ⋮ › **Aparelhos conectados** › **Conectar aparelho** › aponte pro QR.
2. **Criar o grupo de comando** — no WhatsApp, crie um grupo só seu com o número da Luna (ex.: "Luna Ofertas").
3. **Configurações › Grupo de comando** — escolha o "Luna Ofertas" e salve. Clique em 👋 Testar: a Luna manda um oi lá.
4. **Configurações › Categorias** — abra a categoria (ex.: 🚗 Veículos), marque **Postar aqui** no grupo dela e salve. Categoria sem grupo não posta (as ofertas ficam esperando). Ligue as outras quando criar os grupos.
5. **Configurações › Contas das lojas** — clique em **Entrar nas contas**, faça login na **Central de Afiliados do Mercado Livre** (e na Shopee) e feche a janela. O RoB7 usa essa conta pra gerar o seu meli.la.
6. **(Recomendado) Configurações › Agente RoB7** — cole a **chave da IA** (a mesma da Luna da Central) e deixe o limite em **US$ 0,25 por dia**. Passou do limite, a IA para até o dia seguinte e o RoB7 continua só com as regras.
7. **(Depois) API da Shopee** — em affiliate.shopee.com.br › **Open API**, peça o **App ID** e o **Secret** e cole em Configurações › Avançado. Aí o RoB7 também procura na Shopee.

## 3. Usar no dia a dia

### Pelo zap (grupo de comando)

| Você manda | A Luna faz |
|---|---|
| um link (ou vários) | monta a oferta e mostra a prévia com foto |
| `sim` | aprova (vai pra fila). `sim 12 13` aprova só essas |
| `não` | descarta. `não 12` descarta só a #12 |
| `preço 12 49,90` | corrige o preço da #12 |
| `de 12 99,90` | corrige o preço "De" (`de 12 0` tira) |
| `nome 12 Fone Bluetooth` | corrige o nome |
| `cupom 12 FONE10` | põe cupom na oferta (`cupom 12 0` tira) |
| `categoria 12 moda` | muda a #12 de categoria (vai pro grupo e fila dela) |
| `ver 12` | mostra a #12 com foto |
| `buscar` | o RoB7 procura ofertas agora (`buscar moda` só uma categoria) |
| `fila` | mostra a fila com os horários |
| `pendentes` | mostra o que espera aprovação |
| `status` | resumo do dia |
| `pausar` / `voltar` | pausa / liga a fila |
| `agora` | posta a próxima da fila na hora. `agora 12` posta a #12 |
| `tirar 12` | tira a #12 da fila |
| `repetir 12` | monta de novo um produto já postado |
| `ajuda` | lista os comandos |

### Pelo painel

- **Início**: WhatsApp, o **Agente RoB7** (o que achou, gasto da IA, botão 🔎 Procurar agora) e as **filas de cada categoria**.
- **Nova oferta**: cole 1 ou vários links (um por linha). A categoria pode ser **Automática** (a IA escolhe) ou uma que você marcar.
- **Aprovar** e **Fila**: em cima tem os botões das categorias pra filtrar.
- **Aprovar**: clique numa oferta e ela abre do lado pra editar (nome, categoria, preço, De, cupom, foto). Embaixo aparece **como ela vai chegar no grupo**, mudando enquanto você digita. Depois é só **Salvar e aprovar**.
- **Fila**: veja o horário de cada uma, mude a ordem (↑ ↓, escolhendo a categoria) e clique pra editar do lado, postar agora ou tirar. Escolhendo uma categoria com subcategorias aparece o botão **🔀 Intercalar fila**: ele guarda uma cópia de segurança do banco e reordena as que estão esperando em rodízio (quem já foi postado não muda).
- **Configurações**: o essencial em cima (Categorias, Agente RoB7, Grupo de comando, Contas). O resto fica em **⚙️ Avançado**.
- **Postadas**: o que já foi, e o que falhou (com "Tentar de novo").

## 4. Regras que o programa segue

- O link que vai pro grupo é **exatamente o que você colou** (meli.la / s.shopee.com.br). Nada de encurtar, converter ou tirar parâmetros.
  - Exceção: link **normal** da Shopee com a API configurada vira link de afiliado da sua conta.
  - Link normal do Mercado Livre é recusado: cole o **meli.la**.
- **Nada inventado**: se não conseguir ler o preço, o nome ou a foto, a oferta fica marcada "falta preço" e espera você completar.
- **Não repete** o mesmo produto por 7 dias (dá pra mudar). Se quiser repetir, use `repetir 12`.
- A Luna **só posta nos grupos marcados** e **só obedece no grupo de comando**. Nos outros grupos do número ela não faz nada.
- O **% OFF** é a conta de verdade entre o De e o Por (só aparece com desconto de 5% ou mais). O **cupom** só aparece quando a oferta tem. Os dois dá pra desligar em Configurações › Mensagem.
- Formato da mensagem:

```
🔥 50% OFF
🛍️ Nome do produto

❌ De: R$ 99,90
🔥 Por: R$ 49,90
🎟️ Cupom: FONE10

🛒 Compre aqui:
https://meli.la/xxxx

⚠️ Atenção: O preço pode sofrer alteração...
```

## 5. Ligar, desligar e atualizar

Na pasta `windows`:

- **INICIAR.bat** — liga (se já estiver ligado, só abre o painel).
- **PARAR.bat** — desliga.
- **ATUALIZAR.bat** — baixa a versão nova (se a pasta veio pelo Git) e reinicia.
- **REMOVER_INICIO_AUTOMATICO.bat** — não liga mais sozinho com o Windows.

Seus dados (sessão do WhatsApp, ofertas, fotos, senha) ficam em `%LOCALAPPDATA%\OfertasRoB7`, **fora** da pasta do programa. Atualizar ou trocar a pasta não apaga nada e não pede QR de novo.

## 6. Painel no celular (e ícone de app no iPhone)

O programa liga sozinho um túnel da Cloudflare (igual à Central), e o painel abre no celular de qualquer lugar, com senha. No iPhone dá pra pôr o ícone na tela de início e ele abre como app.

Passo a passo: [docs/CELULAR.md](docs/CELULAR.md). Resumo: cria o túnel no site da Cloudflare, cola o token em **Configurações › 📱 Celular**, lê o QR com o iPhone e toca em **Compartilhar › Adicionar à Tela de Início**.

## 7. Deu problema?

- **QR não aparece / WhatsApp caiu**: Configurações › Conexão do WhatsApp › 🔄 Reconectar.
- **"Outra cópia do programa conectou"**: o programa foi aberto duas vezes. Rode PARAR.bat e depois INICIAR.bat.
- **Shopee "pediu login"**: Configurações › Entrar nas contas › faça login na Shopee.
- **RoB7 deu erro no Mercado Livre**: ou a conta de afiliado deslogou (clique em **Entrar nas contas** de novo), ou o Mercado Livre mudou a tela. O resto continua funcionando. A página que deu problema fica salva na pasta `diagnostico` (dentro de `%LOCALAPPDATA%\OfertasRoB7`); me mande o erro de Configurações › Avançado › Registro e esse arquivo.
- Registro completo do dia: `%LOCALAPPDATA%\OfertasRoB7\logs`.

## Aviso importante

A conexão por QR não é oficial do WhatsApp. Postar muita promoção pode levar o WhatsApp a bloquear o número. Por isso: intervalo de 30 min, só nos grupos marcados. Se um dia quiser trocar pra um chip só das ofertas, é só **Desconectar / trocar número** e ler o QR com o outro celular.
