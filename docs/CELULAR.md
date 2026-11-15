# Painel no celular (de qualquer lugar)

O painel roda no seu PC em `http://127.0.0.1:3777` e, por segurança, **só abre nesse PC**.
Pra abrir no celular fora de casa, a gente usa o **túnel da Cloudflare** (grátis), igual ao que você já usa na Central.
O túnel liga um endereço fixo (ex.: `ofertas.seudominio.com.br`) direto no seu PC, sem abrir porta no roteador.

> Dica: dá pra fazer isso depois. O controle pelo zap (grupo "Luna Ofertas") já funciona de qualquer lugar.

## Passo a passo

1. **Instale o cloudflared** no PC das ofertas: abra o PowerShell e rode
   `winget install --id Cloudflare.cloudflared`
2. **Faça login** (abre o navegador, escolha o seu domínio na Cloudflare):
   `cloudflared tunnel login`
3. **Crie o túnel**:
   `cloudflared tunnel create ofertas-rob7`
4. **Aponte um endereço pro túnel** (troque pelo seu domínio):
   `cloudflared tunnel route dns ofertas-rob7 ofertas.seudominio.com.br`
5. **Crie o arquivo** `C:\Users\SEU_USUARIO\.cloudflared\config.yml` com:

   ```yaml
   tunnel: ofertas-rob7
   credentials-file: C:\Users\SEU_USUARIO\.cloudflared\<ID-DO-TUNEL>.json
   ingress:
     - hostname: ofertas.seudominio.com.br
       service: http://127.0.0.1:3777
     - service: http_status:404
   ```

6. **Deixe o túnel ligando sozinho com o Windows**:
   `cloudflared service install`
7. No celular, abra `https://ofertas.seudominio.com.br` e entre com a **senha do painel**.

## Segurança

- O painel sempre pede a senha. Depois de 5 senhas erradas, bloqueia por 10 minutos.
- A senha só pode ser **criada** pelo próprio PC (nunca pelo túnel).
- A janela "Entrar nas contas" só abre pelo PC.
- Quer uma trava a mais? Na Cloudflare, em **Zero Trust › Access**, crie uma aplicação pra `ofertas.seudominio.com.br` liberando só o seu e-mail (igual à portaria da Central).
