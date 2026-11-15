// Monta o texto que vai embaixo da foto no grupo.
// Layout combinado: 🛍️ nome / ❌ De / 🔥 Por / 🛒 Compre aqui + link / ⚠️ aviso.

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

export function buildCaption(offer, { footer = DEFAULT_FOOTER } = {}) {
  const missing = missingFields(offer).filter((field) => field !== 'foto');
  if (missing.length) throw new Error(`Faltando: ${missing.join(', ')}.`);
  const title = compactTitle(offer.title);
  const price = Number(offer.price);
  const oldPrice = Number(offer.oldPrice || 0);
  const lines = [`🛍️ ${title}`, ''];
  if (validPrice(oldPrice) && oldPrice > price) lines.push(`❌ De: ${money(oldPrice)}`);
  lines.push(`🔥 Por: ${money(price)}`, '', '🛒 Compre aqui:', offer.publishUrl);
  const end = String(footer ?? '').trim();
  if (end) lines.push('', end);
  return lines.join('\n');
}
