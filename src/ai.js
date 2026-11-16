// IA (Claude) do agente RoB7: escolhe ofertas e descobre a categoria de um link.
// Usa a chave da conta da Anthropic e conta o gasto do dia. Passou do limite do dia,
// a IA para até amanhã e o agente segue só com as regras (nada trava).

import { listCategories, GENERAL_ID } from './categories.js';
import { log } from './log.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// Preço por 1 milhão de tokens (entrada, saída) em US$, da tabela da Anthropic (nov/2026; pedidos
// pequenos, abaixo de 100 mil tokens). Modelo desconhecido: conta como caro, pra nunca estourar o limite.
const PRICES = [
  [/haiku-5/i, 0.1, 0.5],
  [/haiku/i, 1, 5],
  [/sonnet-5/i, 2, 10],
  [/sonnet/i, 3, 15],
  [/opus-5/i, 4, 20],
  [/opus/i, 15, 75],
  [/fable|mythos/i, 10, 50]
];

export function costOf(model, usage = {}) {
  const [, input, output] = PRICES.find(([re]) => re.test(model)) || [null, 15, 75];
  const inTokens = Number(usage.input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0) + Number(usage.cache_read_input_tokens || 0) * 0.1;
  const outTokens = Number(usage.output_tokens || 0);
  return (inTokens * input + outTokens * output) / 1_000_000;
}

function today(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Pega o primeiro JSON { ... } da resposta (a IA às vezes escreve algo em volta).
export function extractJson(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('A IA não devolveu JSON.');
  return JSON.parse(raw.slice(start, end + 1));
}

export class AiService {
  constructor({ settings, db, fetchImpl = (...args) => fetch(...args) }) {
    this.settings = settings;
    this.db = db;
    this.fetch = fetchImpl;
  }

  config() {
    return this.settings.get().ai || {};
  }

  usage(now = new Date()) {
    const u = this.db.get().aiUsage || {};
    return u.date === today(now) ? { date: u.date, usd: u.usd || 0, calls: u.calls || 0 } : { date: today(now), usd: 0, calls: 0 };
  }

  // Tem chave e ainda tem limite hoje?
  available(now = new Date()) {
    const cfg = this.config();
    if (!cfg.apiKey) return false;
    return this.usage(now).usd < Number(cfg.dailyLimitUsd ?? 0.25);
  }

  status() {
    const cfg = this.config();
    const u = this.usage();
    return { hasKey: Boolean(cfg.apiKey), model: cfg.model, limitUsd: Number(cfg.dailyLimitUsd ?? 0.25), usedUsd: Math.round(u.usd * 10000) / 10000, calls: u.calls, available: this.available() };
  }

  async ask({ system, prompt, maxTokens = 800 }) {
    const cfg = this.config();
    if (!cfg.apiKey) throw new Error('Falta a chave da IA (Configurações › Agente RoB7).');
    if (!this.available()) throw new Error('A IA bateu o limite de gasto de hoje. Volta amanhã.');
    const response = await this.fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] })
    });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      const message = data?.error?.message || `HTTP ${response.status}`;
      if (response.status === 401) throw new Error('A chave da IA foi recusada. Confira em Configurações.');
      if (/credit|billing|balance/i.test(message)) throw new Error('A conta da IA está sem crédito.');
      throw new Error(`IA: ${message}`);
    }
    const usd = costOf(cfg.model, data?.usage);
    this.db.update((d) => {
      const u = d.aiUsage && d.aiUsage.date === today() ? d.aiUsage : { date: today(), usd: 0, calls: 0 };
      u.usd = (u.usd || 0) + usd;
      u.calls = (u.calls || 0) + 1;
      d.aiUsage = u;
    });
    return (data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  }

  // Qual categoria é esse produto? Devolve o id (ou "geral").
  async classify(title) {
    const settings = this.settings.get();
    if (settings.ai?.classifyLinks === false || !this.available()) return '';
    const enabled = listCategories(settings).filter((c) => c.id !== GENERAL_ID && c.enabled);
    if (!enabled.length) return GENERAL_ID; // só a Geral ligada: nem gasta IA
    const options = enabled.map((c) => `- ${c.id}: ${c.name} — ${c.description}`).join('\n');
    const text = await this.ask({
      system: 'Você classifica produtos de lojas online em categorias de grupos de ofertas. Responda só com o id da categoria, sem mais nada.',
      prompt: `Categorias:\n${options}\n- ${GENERAL_ID}: nenhuma das acima\n\nProduto: ${String(title).slice(0, 200)}\n\nResposta (só o id):`,
      maxTokens: 20
    });
    const id = String(text || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return listCategories(settings).some((c) => c.id === id) ? id : '';
  }

  // Escolhe as melhores ofertas de uma lista pra categoria. Devolve [{ index, reason }].
  async pick(category, candidates, max) {
    const lines = candidates.map((c, i) => {
      const bits = [
        `${i + 1}. ${c.title}`,
        `R$ ${c.price.toFixed(2)}`,
        c.discount ? `${c.discount}% OFF` : '',
        c.rating ? `nota ${c.rating}` : '',
        c.reviews ? `${c.reviews} avaliações` : '',
        c.sales ? `${c.sales} vendidos` : '',
        c.freeShipping ? 'frete grátis' : '',
        c.full ? 'Full' : '',
        c.platform === 'shopee' ? 'Shopee' : 'Mercado Livre'
      ].filter(Boolean);
      return bits.join(' | ');
    }).join('\n');
    const text = await this.ask({
      system: [
        `Você é o RoB7, agente que escolhe ofertas pra um grupo de WhatsApp da categoria "${category.name}".`,
        `A categoria é: ${category.description}`,
        'Escolha só produtos que: são claramente dessa categoria; as pessoas compram de verdade; têm bom desconto e boa avaliação.',
        'Recuse: fora da categoria, adulto, arma, remédio, cigarro, réplica/pirataria, usado/recondicionado, peça muito específica sem apelo, e produtos repetidos (escolha só um).',
        'Responda só com JSON: {"escolhidos":[{"n":1,"motivo":"curto"}],"recusados":[{"n":2,"motivo":"curto"}]}'
      ].join('\n'),
      prompt: `Escolha no máximo ${max} da lista, do melhor pro pior:\n${lines}`,
      maxTokens: 900
    });
    const json = extractJson(text);
    const picked = [];
    for (const item of Array.isArray(json.escolhidos) ? json.escolhidos : []) {
      const index = Number(item?.n) - 1;
      if (Number.isInteger(index) && index >= 0 && index < candidates.length && !picked.some((p) => p.index === index)) {
        picked.push({ index, reason: String(item.motivo || '').slice(0, 120) });
      }
      if (picked.length >= max) break;
    }
    log.info('rob7', `IA escolheu ${picked.length} de ${candidates.length} em ${category.name}.`);
    return picked;
  }
}
