# Ofertas RoB7 — V3

Programa que roda escondido no seu PC e posta ofertas de afiliado (Mercado Livre, Shopee e TikTok Shop) nos seus grupos do WhatsApp, pela **Luna Ofertas**.

- WhatsApp conectado **por QR code** (como "aparelho conectado"), sem API paga e sem extensão no Chrome.
- Você manda o link pra Luna no zap (ou cola no painel), ela monta a oferta com **foto grande + texto embaixo** e pergunta se pode postar.
- Você responde **sim** e ela põe na **fila**, que solta 1 oferta a cada 30 minutos, das 8h às 22h (dá pra mudar).
- Posta em **vários grupos** ao mesmo tempo (#01, #02...).
- **Radar** automático da Shopee (pela API oficial) e do Mercado Livre (pela Central de Afiliados).
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
3. **Configurações › Grupos** — clique em 🔄 Atualizar lista, marque **Comando** no "Luna Ofertas" e **Postar aqui** no "Ofertas RoB7 #01". Salve. Clique em 👋 Testar: a Luna manda um oi no grupo de comando.
4. **Configurações › Contas no navegador invisível** — clique em **Entrar nas contas**, faça login na **Shopee** e na **Central de Afiliados do Mercado Livre** e feche a janela. Só precisa fazer isso uma vez.
5. **(Recomendado) API da Shopee** — em affiliate.shopee.com.br › **Open API**, pegue o **App ID** e o **Secret** e cole em Configurações. Com ela, nome/preço/foto da Shopee vêm certinhos e o radar da Shopee funciona.

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
| `fila` | mostra a fila com os horários |
| `pendentes` | mostra o que espera aprovação |
| `status` | resumo do dia |
| `pausar` / `voltar` | pausa / liga a fila |
| `agora` | posta a próxima da fila na hora. `agora 12` posta a #12 |
| `tirar 12` | tira a #12 da fila |
| `repetir 12` | monta de novo um produto já postado |
| `ajuda` | lista os comandos |

### Pelo painel

- **Nova oferta**: cole 1 ou vários links (um por linha).
- **Aprovar**: confira foto, nome e preços, corrija se precisar e aprove.
- **Fila**: veja o horário de cada uma, mude a ordem, poste agora ou tire.
- **Postadas**: o que já foi, e o que falhou (com "Tentar de novo").

## 4. Regras que o programa segue

- O link que vai pro grupo é **exatamente o que você colou** (meli.la / s.shopee.com.br). Nada de encurtar, converter ou tirar parâmetros.
  - Exceção: link **normal** da Shopee com a API configurada vira link de afiliado da sua conta.
  - Link normal do Mercado Livre é recusado: cole o **meli.la**.
- **Nada inventado**: se não conseguir ler o preço, o nome ou a foto, a oferta fica marcada "falta preço" e espera você completar.
- **Não repete** o mesmo produto por 7 dias (dá pra mudar). Se quiser repetir, use `repetir 12`.
- A Luna **só posta nos grupos marcados** e **só obedece no grupo de comando**. Nos outros grupos do número ela não faz nada.
- Formato da mensagem:

```
🛍️ Nome do produto

❌ De: R$ 99,90
🔥 Por: R$ 49,90

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

## 6. Painel no celular

Veja [docs/CELULAR.md](docs/CELULAR.md) (usa o túnel da Cloudflare, igual à Central).

## 7. Deu problema?

- **QR não aparece / WhatsApp caiu**: Configurações › Conexão do WhatsApp › 🔄 Reconectar.
- **"Outra cópia do programa conectou"**: o programa foi aberto duas vezes. Rode PARAR.bat e depois INICIAR.bat.
- **Shopee "pediu login"**: Configurações › Entrar nas contas › faça login na Shopee.
- **Radar do Mercado Livre deu erro**: o Mercado Livre pode ter mudado a tela. O resto continua funcionando; me mande o erro que aparece em Configurações › Registro.
- Registro completo do dia: `%LOCALAPPDATA%\OfertasRoB7\logs`.

## Aviso importante

A conexão por QR não é oficial do WhatsApp. Postar muita promoção pode levar o WhatsApp a bloquear o número. Por isso: intervalo de 30 min, só nos grupos marcados. Se um dia quiser trocar pra um chip só das ofertas, é só **Desconectar / trocar número** e ler o QR com o outro celular.
