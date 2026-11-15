// Porta única pra ler um produto, qualquer loja.

import { readMercadoLivre } from './mercadolivre.js';
import { readShopee } from './shopee.js';
import { readTiktok } from './tiktok.js';

export async function readProduct(platform, inputUrl, settings) {
  if (platform === 'mercadolivre') return readMercadoLivre(inputUrl);
  if (platform === 'shopee') return readShopee(inputUrl, settings);
  if (platform === 'tiktok') return readTiktok(inputUrl);
  throw new Error('Loja não suportada.');
}
