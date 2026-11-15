// Prepara a foto da oferta: baixa, converte pra JPEG (foto normal, nunca figurinha) e guarda no PC.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PATHS } from './config.js';
import { fetchBinary, isAllowedHost } from './products/http.js';

function cacheFile(imageUrl) {
  const key = crypto.createHash('sha1').update(String(imageUrl)).digest('hex').slice(0, 20);
  return path.join(PATHS.images, `${key}.jpg`);
}

// Qualquer formato (webp, png, avif...) vira JPEG de até 1280px, fundo branco.
export async function toOfferJpeg(bytes) {
  try {
    const image = sharp(bytes, { failOn: 'none', animated: false }).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height) throw new Error('arquivo não é uma imagem');
    if (meta.width < 150 || meta.height < 150) throw new Error('foto pequena demais');
    return await image
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    throw new Error(`Não consegui usar a foto (${error.message}).`);
  }
}

export async function loadOfferImage(imageUrl) {
  if (!imageUrl) throw new Error('A oferta está sem foto.');
  const file = cacheFile(imageUrl);
  try {
    return await fs.promises.readFile(file);
  } catch {}
  const { bytes } = await fetchBinary(imageUrl, { anyHost: !isAllowedHost(imageUrl) });
  const jpeg = await toOfferJpeg(bytes);
  await fs.promises.mkdir(PATHS.images, { recursive: true });
  await fs.promises.writeFile(file, jpeg);
  return jpeg;
}

// Limpa fotos guardadas há mais de X dias (roda uma vez por dia).
export async function cleanOldImages(days = 30) {
  const limit = Date.now() - days * 86_400_000;
  let removed = 0;
  try {
    for (const name of await fs.promises.readdir(PATHS.images)) {
      const file = path.join(PATHS.images, name);
      const stat = await fs.promises.stat(file);
      if (stat.mtimeMs < limit) {
        await fs.promises.unlink(file);
        removed++;
      }
    }
  } catch {}
  return removed;
}
