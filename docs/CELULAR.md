# Painel no celular (de qualquer lugar) + ícone de app no iPhone

O painel roda no seu PC e, por segurança, só abre nesse PC.
Pra abrir no celular fora de casa (até no 4G), o programa liga sozinho um **túnel da Cloudflare** (grátis), igual ao da Central.
Você só precisa criar o túnel uma vez no site da Cloudflare e colar o token no painel.

> O PC precisa estar ligado com o programa aberto. Desligou o PC, o celular não abre o painel
> (o controle pelo zap, no grupo "Luna Ofertas", também depende do PC ligado).

## Parte 1 — Criar o túnel no site da Cloudflare (uma vez só)

1. Entre em **dash.cloudflare.com** com a sua conta.
2. No menu da esquerda: **Zero Trust** › **Networks** › **Tunnels**.
3. Clique em **Create a tunnel** › escolha **Cloudflared** › nome: `ofertas-rob7` › **Save tunnel**.
4. Na tela seguinte aparece um comando com um texto bem longo que começa com `eyJ`.
   **Copie o comando inteiro** (ou só o texto `eyJ...`). Esse é o **token**.
   **Não** rode o comando no PC: o programa liga o túnel sozinho.
5. Clique em **Next** e preencha o **Public hostname**:
   - **Subdomain**: `ofertas`
   - **Domain**: o seu domínio na Cloudflare
   - **Type**: `HTTP`
   - **URL**: `localhost:3777`
6. Clique em **Save tunnel**. O endereço fica assim: `https://ofertas.seudominio.com.br`

## Parte 2 — Ligar no painel (no PC)

1. No painel do PC: **Configurações** › **📱 Celular (de qualquer lugar)**.
2. Se aparecer "o cloudflared ainda não está instalado", clique em **Instalar o cloudflared** e espere 1 ou 2 minutos.
3. Cole o **token** no campo "Token do túnel".
4. Em "Endereço pra abrir no celular", coloque `https://ofertas.seudominio.com.br`.
5. Marque **Túnel ligado** e clique em **Salvar**.
6. Em alguns segundos aparece **✅ Ligado!** e um **QR code**.

## Parte 3 — Virar app no iPhone

1. Aponte a câmera do iPhone pro QR code do painel e toque no link (abre no Safari).
2. Entre com a **senha do painel**.
3. Toque em **Compartilhar** (o quadrado com a setinha pra cima) › **Adicionar à Tela de Início** › **Adicionar**.
4. Pronto: o ícone **Ofertas RoB7** fica na tela do iPhone e abre em tela cheia, como app.
   (Na primeira vez que abrir pelo ícone, ele pede a senha de novo. Depois fica 30 dias sem pedir.)

## Segurança

- O painel sempre pede a senha. Depois de 5 senhas erradas, bloqueia por 10 minutos.
- Pelo celular dá pra usar tudo do dia a dia, **menos**: criar a senha, abrir a janela de login das lojas e mexer no túnel. Isso só pelo PC, pra ninguém de fora conseguir te trancar do lado de fora.
- O token do túnel fica guardado só no seu PC e nunca aparece no painel.
- Quer uma trava a mais? Na Cloudflare, em **Zero Trust › Access › Applications**, crie uma aplicação pra `ofertas.seudominio.com.br` liberando só o seu e-mail (igual à portaria da Central).

## Deu problema?

- **"O token do túnel não é válido"**: copie de novo na Cloudflare (Parte 1, passo 4) e cole no painel.
- **Ficou em "Ligando o túnel…"**: confira a internet do PC e clique em **🔄 Reiniciar túnel**.
- **Abre a página da Cloudflare com erro 502/1033**: o programa está desligado no PC. Ligue pelo atalho "Ofertas RoB7".
