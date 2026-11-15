// Monta o texto que vai embaixo da foto no grupo.
// Layout combinado: (🔥 % OFF) / 🛍️ nome / ❌ De / 🔥 Por / (🎟️ Cupom) / 🛒 Compre aqui + link / ⚠️ aviso.
// O "% OFF" é conta de verdade do De/Por (nada inventado) e só aparece quando tem "De".

import { compactTitle, money, validPrice } from './text.js';

export const DEFAULT_FOOTER = '⚠️ Atenção: O preço pode sofrer alteração...';

// O que falta pra oferta poder ir pro grupo. Nada é inventado: se falta, a gente pergunta.
export function missingFields(offer) {
  const missing = [];
  if (!compactTitle(offer.title)) missing.push('nome');
  if (!validPrice(offer.price)) missing.push('preço');
  if (!offer.imageUrl) missing.push('foto');
  if (!offer.publishUrl) missing.push('link');
  return missing;
}

// Desconto em % (arredondado pra baixo, pra nunca prometer mais do que é). 0 = sem desconto.
export function discountPercent(price, oldPrice) {
  const p = Number(price);
  const o = Number(oldPrice);
  if (!validPrice(p) || !validPrice(o) || o <= p) return 0;
  return Math.floor((1 - p / o) * 100 + 1e-9);
}

// Cupom: só letras, números, hífen e _ (como as lojas usam). Vazio = sem cupom.
export function cleanCoupon(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').slice(0, 40);
}

export function validCoupon(value) {
  return value === '' || /^[\p{L}\p{N}_-]{2,40}$/u.test(value);
}

export function buildCaption(offer, { footer = DEFAULT_FOOTER, showDiscount = true, showCoupon = true } = {}) {
  const missing = missingFields(offer).filter((field) => field !== 'foto');
  if (missing.length) throw new Error(`Faltando: ${missing.join(', ')}.`);
  const title = compactTitle(offer.title);
  const price = Number(offer.price);
  const oldPrice = Number(offer.oldPrice || 0);
  const hasOld = validPrice(oldPrice) && oldPrice > price;
  const lines = [];
  const percent = hasOld ? discountPercent(price, oldPrice) : 0;
  if (showDiscount && percent >= 5) lines.push(`*🔥 ${percent}% OFF*`);
  lines.push(`🛍️ ${title}`, '');
  if (hasOld) lines.push(`❌ De: ${money(oldPrice)}`);
  lines.push(`🔥 Por: ${money(price)}`);
  const coupon = cleanCoupon(offer.coupon);
  if (showCoupon && coupon) lines.push(`🎟️ Cupom: ${coupon}`);
  lines.push('', '🛒 Compre aqui:', offer.publishUrl);
  const end = String(footer ?? '').trim();
  if (end) lines.push('', end);
  return lines.join('\n');
}

// Opções da mensagem a partir das Configurações.
export function captionOptions(settings) {
  const m = settings?.message || {};
  return { footer: m.footer, showDiscount: m.showDiscount !== false, showCoupon: m.showCoupon !== false };
}
