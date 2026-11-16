// Funções de texto e dinheiro usadas no programa todo.

export function normalizeSpaces(value) {
  return String(value ?? '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function folded(value) {
  return normalizeSpaces(value)
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function roundMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

// "1.299,90" | "R$ 49,90" | "49.90" | 49.9 -> número. Texto inválido -> NaN.
export function parsePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? roundMoney(value) : NaN;
  let text = String(value ?? '').trim();
  if (!text) return NaN;
  text = text.replace(/R\$|BRL/gi, '').replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!text || !/\d/.test(text)) return NaN;
  if (text.includes(',') && text.includes('.')) {
    // Formato brasileiro com milhar: 1.299,90
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  } else if ((text.match(/\./g) || []).length > 1) {
    text = text.replace(/\./g, '');
  } else if (/^\d{1,3}\.\d{3}$/.test(text)) {
    // "1.299" sem centavos = mil duzentos e noventa e nove
    text = text.replace('.', '');
  }
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? roundMoney(n) : NaN;
}

export function validPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 1_000_000;
}

export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Preço inválido.');
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

// O Mercado Livre manda o nome do link meli.la como "Produto - R$ 99,99": o preço sai do nome
// (o preço certo já vai no "🔥 Por").
export function stripPriceSuffix(value) {
  return normalizeSpaces(value || '')
    .replace(/\s*[-–|]\s*R\$\s*[\d.,]*\s*$/i, '')
    .replace(/\s*[-–|]\s*$/, '')
    .trim();
}

// Título curto e limpo pro grupo (sem "OFERTA", "frete grátis", nome da loja etc.).
export function compactTitle(rawTitle) {
  let title = stripPriceSuffix(rawTitle);
  title = title
    .replace(/^\s*(?:até\s*)?\d{1,3}%\s*off\s*/i, '')
    .replace(/^\s*(?:oferta|promoção|promocao|lançamento|lancamento)\s*[:\-–|]?\s*/i, '')
    .replace(/\bcomissão\s*extra\b/gi, '')
    .replace(/\b(?:imperdível|imperdivel|super oferta|mais vendido|frete grátis|frete gratis)\b/gi, '')
    .replace(/\s+[|–-]\s+(?:shopee(?: brasil)?|mercado livre|tiktok shop|tiktok)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const words = title.split(' ').filter(Boolean).slice(0, 16);
  let result = words.join(' ');
  if (result.length > 112) {
    result = result.slice(0, 113).replace(/\s+\S*$/, '').trim();
  }
  return result.replace(/\s*[-–|,]\s*$/, '');
}

export function decodeHtml(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, '&');
}

export function hhmm(date = new Date()) {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit'});
}

export function ddmm(date = new Date()) {
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit'});
}
