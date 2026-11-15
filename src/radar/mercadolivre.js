// Radar Mercado Livre: abre a Central de Afiliados no navegador invisível (com a sua conta logada),
// lê "Produtos selecionados para você", e em cada produto novo usa Compartilhar > Copiar link
// pra pegar o meli.la oficial da sua conta. Adaptado da extensão V1.12.3.
//
// ATENÇÃO: depende da tela do Mercado Livre. Se eles mudarem o site, o radar avisa o erro
// e o resto do programa continua funcionando normal.

import { withPage } from '../browser.js';
import { mercadoLivreId } from '../links.js';
import { bigMercadoLivreImage } from '../products/mercadolivre.js';
import { log } from '../log.js';

export const ML_HUB = 'https://www.mercadolivre.com.br/afiliados/hub';

// Esta função roda DENTRO da página do Mercado Livre (é enviada pro navegador). Não usa nada de fora.
function installMlHelpers() {
  if (window.__rob7ml) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const lower = (v) => norm(v).toLocaleLowerCase('pt-BR');
  const folded = (v) => lower(v).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const textOf = (el) => norm(el?.innerText || el?.textContent || '');
  const visible = (el) => Boolean(el && el.isConnected && el.getClientRects().length
    && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');
  const clickLike = (el) => {
    const target = el?.closest('button,a,[role="button"],[role="menuitem"],[tabindex]') || el;
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.click();
    return true;
  };
  const findVisibleText = (needle, root = document, exact = false) => {
    const wanted = lower(needle);
    const value = (el) => lower(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${textOf(el)}`);
    return [...root.querySelectorAll('button,a,[role="button"],[role="menuitem"],span,div,label')]
      .filter(visible).find((el) => (exact ? value(el) === wanted : value(el).includes(wanted))) || null;
  };
  const shareButtons = () => {
    const set = new Set();
    for (const el of [...document.querySelectorAll('button,a,[role="button"]')].filter(visible)) {
      if (/^compartilhar$/i.test(norm(textOf(el)))) set.add(el.closest('button,a,[role="button"]') || el);
    }
    return [...set];
  };
  const recommendationsHeading = () => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],main p,main span,main div')]
    .filter(visible).find((el) => { const v = folded(textOf(el)); return v.length <= 80 && v === 'produtos selecionados para voce'; }) || null;
  const loggedIn = () => {
    const body = lower(document.body?.innerText || '');
    const marker = ['perfil de afiliado', 'produtos selecionados para você', 'produtos selecionados para voce', 'afiliados e criadores',
      'campanhas exclusivas', 'gerador de links', 'ganho estimado'].some((v) => body.includes(v));
    const password = [...document.querySelectorAll('input[type="password"]')].some(visible);
    return marker && !password;
  };
  const nearestRoot = (button) => {
    let node = button;
    for (let d = 0; d < 10 && node && node !== document.body; d++, node = node.parentElement) {
      const t = textOf(node);
      if (node.querySelector?.('img') && /R\$\s*\d/i.test(t) && t.length > 30 && t.length < 2600) return node;
    }
    return button.parentElement || button;
  };
  const validTitle = (v) => { const t = norm(v); return t.length >= 9 && t.length <= 220 && !/compartilhar|ganhos extras|mais vendido|oferta imperd|off no pix|outros meios|vendidos|r\$/i.test(t); };
  const pickTitle = (root) => {
    for (const sel of ['h2', 'h3', 'h4', 'img[alt]', '[title]']) {
      const values = [...root.querySelectorAll(sel)].map((el) => norm(el.getAttribute('alt') || el.getAttribute('title') || textOf(el))).filter(validTitle);
      if (values.length) return values.sort((a, b) => b.length - a.length)[0].slice(0, 180);
    }
    return '';
  };
  const parseBr = (v) => {
    let t = String(v || '').replace(/R\$|BRL/gi, '').replace(/\s/g, '').replace(/[^\d,.-]/g, '');
    if (!t) return 0;
    if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
    else if (t.includes(',')) t = t.replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : 0;
  };
  const priceFromElement = (el) => {
    const clone = el.cloneNode(true);
    const cents = clone.querySelector('sup,[class*="cents" i],[class*="decimal" i]');
    let c = '';
    if (cents && /^\d{2}$/.test(norm(textOf(cents)))) { c = norm(textOf(cents)); cents.remove(); }
    const base = parseBr(textOf(clone));
    if (!base) return 0;
    return c ? Math.floor(base) + Number(c) / 100 : base;
  };
  const extractPrices = (root) => {
    const rows = [];
    for (const el of root.querySelectorAll('*')) {
      if (!visible(el) || !/R\$\s*\d/i.test(textOf(el))) continue;
      if ([...el.children].some((ch) => /R\$\s*\d/i.test(textOf(ch)))) continue;
      const number = priceFromElement(el);
      if (!number) continue;
      const style = getComputedStyle(el);
      const size = parseFloat(style.fontSize) || 0;
      const weight = parseInt(style.fontWeight, 10) || 400;
      const strike = /line-through/i.test(style.textDecorationLine || style.textDecoration || '') || Boolean(el.closest('s,del,[class*="original" i],[class*="previous" i]'));
      const alternative = /outros meios|parcel/i.test(lower(textOf(el.parentElement)));
      rows.push({ number, strike, alternative, score: size + weight / 100 - (alternative ? 4 : 0) });
    }
    const current = rows.filter((r) => !r.strike && !r.alternative).sort((a, b) => b.score - a.score)[0]?.number
      || rows.filter((r) => !r.strike).sort((a, b) => b.score - a.score)[0]?.number || 0;
    const old = rows.filter((r) => r.strike && r.number > current).sort((a, b) => b.number - a.number)[0]?.number || 0;
    return { price: current, oldPrice: old };
  };
  const absolute = (raw) => { try { return new URL(raw, location.href).href; } catch { return ''; } };
  const productLink = (root) => {
    const links = [...root.querySelectorAll('a[href]')].map((a) => absolute(a.getAttribute('href')))
      .concat([...root.querySelectorAll('[data-url],[data-href],[data-link],[data-product-url]')].flatMap((el) => [el.getAttribute('data-url'), el.getAttribute('data-href'), el.getAttribute('data-link'), el.getAttribute('data-product-url')]).map(absolute))
      .filter(Boolean);
    return links.find((u) => /mercadolivre\.com\.br\/.+MLB/i.test(u)) || '';
  };
  const bestImage = (root) => [...root.querySelectorAll('img')].map((img) => img.currentSrc || img.src || img.getAttribute('data-src') || '')
    .filter((u) => /^https?:/i.test(u) && !/logo|avatar|icon/i.test(u))[0] || '';
  const affiliateFromText = (v) => {
    const m = String(v || '').match(/https?:\/\/(?:meli\.la|mercado\.li|(?:www\.)?mercadolivre\.com(?:\.br)?\/sec)\/[A-Za-z0-9_-]+/i);
    return m?.[0]?.replace(/[),.;\]}]+$/, '') || '';
  };
  const readClipboard = async () => { try { return affiliateFromText(await navigator.clipboard.readText()); } catch { return ''; } };
  const currentDialog = () => [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,[class*="modal" i]')]
    .filter((el) => visible(el) && /compartilhe para ganhar dinheiro|copiar link/i.test(textOf(el))).at(-1) || null;
  const closeDialog = async () => {
    const dialog = currentDialog();
    if (dialog) {
      const close = [...dialog.querySelectorAll('button,[role="button"]')].find((el) => /fechar|close/i.test(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`) || /^[×✕✖x]$/i.test(norm(textOf(el))));
      if (close) clickLike(close); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }
    await sleep(350);
  };
  const linksInDialog = (dialog) => {
    const out = [];
    for (const el of dialog.querySelectorAll('input,textarea,a[href],[data-clipboard-text]')) {
      for (const v of [el.value, el.href, el.getAttribute?.('data-clipboard-text'), textOf(el)]) { const l = affiliateFromText(v); if (l) out.push(l); }
    }
    return out;
  };
  let buttons = [];
  window.__rob7ml = {
    status: () => ({ loggedIn: loggedIn(), central: Boolean(recommendationsHeading()), url: location.href }),
    async ensureCentral() {
      if (recommendationsHeading()) return true;
      const central = findVisibleText('Central', document, true);
      if (central) { clickLike(central); await sleep(1800); }
      for (let i = 0; i < 40; i++) { if (recommendationsHeading()) return true; await sleep(250); }
      return false;
    },
    scan() {
      buttons = shareButtons();
      const roots = new Set();
      const out = [];
      buttons.forEach((button, index) => {
        const root = nearestRoot(button);
        if (roots.has(root)) return;
        roots.add(root);
        const title = pickTitle(root);
        const { price, oldPrice } = extractPrices(root);
        const url = productLink(root);
        const imageUrl = bestImage(root);
        const text = textOf(root);
        if (!title || !price || !imageUrl) return;
        out.push({ index, title, price, oldPrice: oldPrice > price ? oldPrice : 0, url, imageUrl, unavailable: /esgotado|indispon|pausado/i.test(text) });
      });
      return out;
    },
    async obtain(index) {
      const button = buttons[index];
      if (!button || !button.isConnected) return '';
      button.scrollIntoView({ block: 'center' });
      await sleep(200);
      const before = await readClipboard();
      clickLike(button);
      let dialog = null;
      for (let i = 0; i < 30 && !dialog; i++) { dialog = currentDialog(); if (!dialog) await sleep(180); }
      if (!dialog) return '';
      const inside = linksInDialog(dialog)[0];
      if (inside) { await closeDialog(); return inside; }
      const copy = [...dialog.querySelectorAll('button,a,[role="button"]')].find((el) => /^copiar link$/i.test(norm(textOf(el)))) || findVisibleText('Copiar link', dialog, true);
      if (!copy) { await closeDialog(); return ''; }
      clickLike(copy);
      let result = '';
      for (let i = 0; i < 40 && !result; i++) {
        const clip = await readClipboard();
        if (clip && clip !== before) result = clip;
        else await sleep(180);
      }
      await closeDialog();
      return result;
    },
    async loadMore() {
      window.scrollBy({ top: Math.max(650, Math.round(innerHeight * 0.82)), behavior: 'auto' });
      await sleep(1200);
      const more = findVisibleText('Mostrar mais', document, true) || findVisibleText('Ver mais produtos', document, true) || findVisibleText('Carregar mais', document, true);
      if (more) { clickLike(more); await sleep(1500); }
      return true;
    }
  };
}

export async function runMercadoLivreRadar({ settings, offers, awaitingZap = false }) {
  const cfg = settings.get().radar.mercadolivre;
  const perRun = Math.min(12, Math.max(1, Number(cfg.perRun) || 5));
  const known = offers.allIdentityKeys();
  const found = await withPage(async (page) => {
    await page.goto(ML_HUB, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(3500);
    await page.bringToFront().catch(() => {});
    await page.evaluate(installMlHelpers);
    const status = await page.evaluate(() => window.__rob7ml.status());
    if (!status.loggedIn) throw new Error('Não estou logado na Central de Afiliados do Mercado Livre. Em Configurações, clique em "Entrar nas contas".');
    if (!await page.evaluate(() => window.__rob7ml.ensureCentral())) throw new Error('Não achei "Produtos selecionados para você" na Central de Afiliados.');
    const picked = [];
    const seenLinks = new Set();
    const seenProducts = new Set();
    let stalled = 0;
    for (let round = 0; round < 10 && picked.length < perRun; round++) {
      const candidates = await page.evaluate(() => window.__rob7ml.scan());
      let fresh = 0;
      for (const c of candidates) {
        if (picked.length >= perRun) break;
        const id = mercadoLivreId(c.url);
        const productKey = id ? `ml:${id}` : `titulo:${c.title.toLowerCase()}`;
        if (seenProducts.has(productKey)) continue;
        seenProducts.add(productKey);
        if (c.unavailable || (id && known.has(`ml:${id}`))) continue;
        fresh++;
        const link = await page.evaluate((index) => window.__rob7ml.obtain(index), c.index);
        if (!link || seenLinks.has(link) || known.has(`link:${link}`)) continue;
        seenLinks.add(link);
        picked.push({ ...c, link, productId: id });
      }
      if (picked.length >= perRun) break;
      stalled = fresh ? 0 : stalled + 1;
      if (stalled >= 2) break;
      await page.evaluate(() => window.__rob7ml.loadMore());
    }
    return picked;
  }, { timeoutMs: 6 * 60_000 });

  const added = [];
  for (const c of found) {
    try {
      const result = await offers.addFromUrl(c.link, {
        origin: 'radar',
        awaitingZap,
        preset: {
          resolvedUrl: c.url,
          title: c.title,
          price: c.price,
          oldPrice: c.oldPrice || null,
          imageUrl: bigMercadoLivreImage(c.imageUrl),
          productId: c.productId,
          notes: ['Radar Mercado Livre (Produtos selecionados para você)']
        }
      });
      if (result.offer) added.push(result.offer);
    } catch (error) {
      log.warn('radar', `Mercado Livre: não salvei um produto do radar (${error.message})`);
    }
  }
  return added;
}
