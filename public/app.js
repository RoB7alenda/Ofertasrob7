// Painel do Ofertas RoB7 V3 (sem framework, só JavaScript).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const usd = (n) => `US$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const priceInput = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toFixed(2).replace('.', ','));
const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const ddmmhh = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const PLATFORM = { mercadolivre: ['Mercado Livre', 'ml'], shopee: ['Shopee', 'shopee'], tiktok: ['TikTok Shop', 'tiktok'] };
const ORIGIN = { painel: 'painel', lista: 'lista', zap: 'zap', radar: 'radar', rob7: 'RoB7 🤖' };
const CAT_ICON = { geral: '📦', veiculos: '🚗', moda: '👕', casa: '🏠', eletronicos: '🎮' };
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

let state = null;
let currentTab = 'inicio';
let lastRev = -1;
let groupsList = [];
let events = null;
let pairingOpen = false;
const filter = { aprovar: '', fila: '' };

// ---------- categorias ----------
const catList = () => state?.settings.categories || [];
function catName(id) {
  const c = catList().find((x) => x.id === id) || catList().find((x) => x.id === 'geral');
  return c ? `${CAT_ICON[c.id] || '🏷️'} ${c.name}` : String(id || '');
}

// ---------- utilidades ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth')) {
    checkAuth();
    throw new Error('Faça login de novo.');
  }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 3500);
}

async function busy(button, task) {
  if (button) button.disabled = true;
  try {
    return await task();
  } catch (error) {
    toast(error.message, 'bad');
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

function on(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', (e) => { e.preventDefault(); handler(el, e); });
}

// ---------- login ----------
async function checkAuth() {
  const auth = await api('/api/auth').catch(() => null);
  if (!auth) return;
  if (auth.authenticated) return startApp();
  if (events) { events.close(); events = null; }
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  const setup = !auth.hasPassword;
  $('#authPassword2').classList.toggle('hidden', !setup);
  $('#authPassword').autocomplete = setup ? 'new-password' : 'current-password';
  $('#authButton').textContent = setup ? 'Criar senha' : 'Entrar';
  $('#authButton').disabled = setup && !auth.canSetup;
  $('#authText').textContent = setup
    ? (auth.canSetup ? 'Primeiro acesso: crie a senha do painel (mínimo 6 caracteres).' : 'Crie a senha primeiro pelo painel no próprio PC.')
    : 'Digite a senha do painel.';
  $('#authForm').dataset.mode = setup ? 'setup' : 'login';
  $('#authPassword').focus();
}

$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const mode = event.currentTarget.dataset.mode;
  const password = $('#authPassword').value;
  $('#authError').textContent = '';
  try {
    if (mode === 'setup') {
      if (password !== $('#authPassword2').value) throw new Error('As duas senhas não são iguais.');
      await api('/api/auth/setup', { method: 'POST', body: { password } });
    } else {
      await api('/api/auth/login', { method: 'POST', body: { password } });
    }
    $('#authPassword').value = '';
    $('#authPassword2').value = '';
    startApp();
  } catch (error) {
    $('#authError').textContent = error.message;
  }
});

function startApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  if (!events) connectEvents();
  loadLogs();
}

function connectEvents() {
  events = new EventSource('/api/events');
  events.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  events.addEventListener('log', (e) => addLog(JSON.parse(e.data)));
  events.onerror = () => {
    if (events.readyState === EventSource.CLOSED) {
      events = null;
      setTimeout(checkAuth, 3000);
    }
  };
}

// ---------- abas ----------
$$('#tabs button').forEach((button) => button.addEventListener('click', () => openTab(button.dataset.tab)));

function openTab(tab) {
  currentTab = tab;
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${tab}`));
  refreshCurrent();
  if (tab === 'config') {
    fillConfig();
    loadGroups(false);
  }
  window.scrollTo({ top: 0 });
}

function refreshCurrent() {
  if (currentTab === 'aprovar') loadPending();
  if (currentTab === 'fila') loadQueue();
  if (currentTab === 'postadas') loadPosted();
}

// ---------- estado ao vivo ----------
function onState(next) {
  const first = !state;
  state = next;
  renderTop();
  renderHome();
  renderAgent();
  renderFilter('aprovar');
  renderFilter('fila');
  renderCategorySelect();
  renderCatMeta();
  renderWaConfig();
  renderBrowserInfo();
  renderTunnel();
  if (first) fillConfig();
  if (state.rev !== lastRev) {
    lastRev = state.rev;
    refreshCurrent();
  }
}

function waText(wa) {
  if (wa.state === 'conectado') return ['✅ WhatsApp conectado', 'ok'];
  if (wa.state === 'qr') return ['📷 Leia o QR code', 'warn'];
  if (wa.state === 'conectando' || wa.state === 'iniciando') return ['⏳ Conectando…', 'warn'];
  return ['❌ WhatsApp desconectado', 'bad'];
}

function renderTop() {
  $('#version').textContent = `V${state.version}`;
  const [text, kind] = waText(state.wa);
  const pill = $('#pillWa');
  pill.textContent = text;
  pill.className = `pill ${kind}`;
  const q = state.queue;
  const qPill = $('#pillQueue');
  qPill.textContent = q.paused ? `⏸️ Fila pausada (${q.size})` : q.next ? `📋 ${q.size} na fila • próxima ${hhmm(q.next)}` : `📋 ${q.size} na fila`;
  qPill.className = `pill ${q.paused ? 'warn' : 'ok'}`;
  const badge = (id, n) => { const b = $(id); b.textContent = n; b.classList.toggle('hidden', !n); };
  badge('#badgeAprovar', state.counts.aguardando);
  badge('#badgeFila', state.counts.fila);
}

function renderHome() {
  const wa = state.wa;
  const box = $('#waBox');
  if (wa.state === 'qr' && wa.qr) {
    const typing = box.contains(document.activeElement);
    if (!typing) {
      box.innerHTML = `<div class="wa-qr">
        ${wa.lastError ? `<p class="error-text">⚠️ ${esc(wa.lastError)}</p>` : ''}
        <img src="${wa.qr}" alt="QR code do WhatsApp">
        <ol class="steps"><li>No celular da Luna, abra o WhatsApp.</li><li>Toque em <b>⋮</b> (ou Configurações) › <b>Aparelhos conectados</b> › <b>Conectar aparelho</b>.</li><li>Aponte a câmera pra este QR.</li></ol>
        <details class="pairing" ${wa.pairingCode || pairingOpen ? 'open' : ''}>
          <summary>Não conectou pelo QR? Conectar pelo número</summary>
          ${wa.pairingCode
            ? `<p>Código: <b class="pair-code">${esc(wa.pairingCode)}</b></p><ol class="steps"><li>No celular da Luna: <b>Aparelhos conectados</b> › <b>Conectar aparelho</b>.</li><li>Toque em <b>Conectar com número de telefone</b>.</li><li>Digite o código acima.</li></ol>`
            : `<p class="muted small">Digite o número da Luna com 55 e DDD (só números).</p>
               <div class="row gap"><input id="pairNumber" inputmode="numeric" placeholder="5511999999999" style="max-width:200px"><button class="btn small" id="btnPair">Gerar código</button></div>`}
        </details>
        <button class="btn small" id="btnResetWa">🔄 Gerar QR novo do zero</button>
      </div>`;
      $('.pairing', box)?.addEventListener('toggle', (e) => { pairingOpen = e.currentTarget.open; });
      on('btnPair', (b) => busy(b, async () => {
        const r = await api('/api/whatsapp/pairing-code', { method: 'POST', body: { number: $('#pairNumber').value } });
        toast(`Código: ${r.code}`);
      }));
      on('btnResetWa', (b) => busy(b, async () => {
        if (!confirm('Apagar a tentativa de conexão e gerar um QR novo?')) return;
        await api('/api/whatsapp/logout', { method: 'POST', body: {} });
        toast('Gerando QR novo...');
      }));
    }
  } else if (wa.state === 'conectado') {
    box.innerHTML = `<p>✅ Conectado como <b>+${esc(wa.me?.number || '')}</b>${wa.me?.name ? ` (${esc(wa.me.name)})` : ''}.</p>
      <p class="muted small">A Luna Ofertas só posta nos grupos marcados e só obedece no grupo de comando.</p>`;
  } else if (wa.state === 'conectando' || wa.state === 'iniciando') {
    box.innerHTML = '<p>⏳ Conectando no WhatsApp…</p>';
  } else {
    box.innerHTML = `<p>❌ ${esc(wa.lastError || 'Desconectado.')}</p><button class="btn" id="btnHomeReconnect">🔄 Reconectar</button>`;
    on('btnHomeReconnect', (b) => busy(b, () => api('/api/whatsapp/restart', { method: 'POST', body: {} })));
  }
  const q = state.queue;
  $('#btnPause').textContent = q.paused ? '▶️ Ligar filas' : '⏸️ Pausar tudo';
  const cats = q.categories.filter((c) => c.enabled || c.size);
  $('#homeQueues').innerHTML = cats.length ? cats.map((c) => {
    const status = !c.enabled ? 'categoria desligada'
      : !c.groups ? '⚠️ sem grupo — escolha em Configurações'
        : q.paused ? '⏸️ pausada'
          : c.next ? `próxima às ${hhmm(c.next)}` : c.size ? 'fora do horário' : 'fila vazia';
    return `<div class="catq ${c.enabled && c.groups ? '' : 'off'}" data-cat="${esc(c.id)}" role="button" tabindex="0">
      <div><b>${esc(catName(c.id))}</b><div class="muted small">${esc(status)}${c.groups ? ` • ${c.groups} grupo(s)` : ''}</div></div>
      <div class="n">${c.size}</div></div>`;
  }).join('') : '<p class="muted">Nenhuma categoria ligada. Ligue em Configurações › Categorias.</p>';
  $$('#homeQueues .catq').forEach((el) => el.addEventListener('click', () => { filter.fila = el.dataset.cat; openTab('fila'); }));
  $('#homePosted').textContent = state.counts.postadasHoje;
  $('#homePending').textContent = state.counts.aguardando;
  $('#homeFailed').textContent = state.counts.falhou;

  const s = state.settings;
  const working = s.categories.filter((c) => c.enabled && c.id !== 'geral');
  const steps = [
    ['Conectar o WhatsApp da Luna (QR code acima)', wa.state === 'conectado'],
    ['Escolher o grupo de comando (Configurações › Grupo de comando)', Boolean(s.groups.control)],
    ['Escolher o grupo de cada categoria ligada (Configurações › Categorias)', working.length > 0 && working.every((c) => c.groups.length)],
    ['Entrar na conta de afiliado do Mercado Livre (Configurações › Contas das lojas)', null],
    ['(Recomendado) Colocar a chave da IA no Agente RoB7', s.ai.hasKey]
  ];
  const mustDone = steps.slice(0, 3).every(([, done]) => done);
  const card = $('#setupCard');
  card.classList.toggle('hidden', mustDone);
  card.innerHTML = `<h2>🚦 Primeiros passos</h2><ol class="setup-list">${steps.map(([t, done]) => `<li class="${done ? 'done' : ''}">${done ? '✅ ' : ''}${esc(t)}</li>`).join('')}</ol>`;
}

on('btnPause', (b) => busy(b, () => api('/api/queue/pause', { method: 'POST', body: { paused: !state.queue.paused } })));
on('btnAgentRun', (b) => busy(b, async () => {
  await api('/api/agent/run', { method: 'POST', body: {} });
  toast('🤖 RoB7 procurando… leva uns minutos. O que ele achar aparece em Aprovar.');
}));

// ---------- agente RoB7 ----------
function agentLine(c) {
  if (c.lastError) return `<span class="bad-text">❌ ${esc(c.lastError)}</span>`;
  return esc(c.lastResult ? `${c.lastResult}${c.lastRunAt ? ` (${ddmmhh(c.lastRunAt)})` : ''}` : 'ainda não procurou');
}

function renderAgent() {
  const a = state.agent;
  if (!a) return;
  const mode = !a.enabled ? '⚪ Desligado' : a.autopilot ? '🚀 Piloto automático — põe direto na fila' : '🎓 Modo treino — tudo espera você aprovar';
  const lines = [`<div><b>${mode}</b></div>`];
  if (a.running) lines.push(`<div>🔎 Procurando agora${a.running !== 'todas' ? ` em ${esc(catName(a.running))}` : ''}…</div>`);
  else if (a.lastRunAt) lines.push(`<div class="muted small">Última busca ${ddmmhh(a.lastRunAt)}: ${esc(a.lastResult)}${a.enabled && a.nextRunAt ? ` • próxima lá pelas ${hhmm(a.nextRunAt)}` : ''}</div>`);
  else lines.push(`<div class="muted small">Ainda não procurou.${a.enabled ? ' Procura sozinho no horário das filas.' : ''}</div>`);
  for (const c of a.categories.filter((x) => x.enabled)) lines.push(`<div class="small">${esc(catName(c.id))}: ${agentLine(c)}</div>`);
  const ai = a.ai;
  lines.push(`<div class="muted small">${ai?.hasKey ? `🧠 IA hoje: ${usd(ai.usedUsd)} de ${usd(ai.limitUsd)}${ai.available ? '' : ' — limite batido, amanhã volta (até lá, só as regras)'}` : '🧠 Sem a chave da IA: escolhe só pelas regras.'}</div>`);
  $('#homeAgent').className = 'agent-lines';
  $('#homeAgent').innerHTML = lines.join('');
  $('#btnAgentRun').disabled = Boolean(a.running);
  $('#aiInfo').textContent = ai?.hasKey
    ? `✅ Chave salva. Gasto hoje: ${usd(ai.usedUsd)} de ${usd(ai.limitUsd)} (${ai.calls} pedido(s)). Passou do limite, a IA para até amanhã.`
    : 'Sem chave: o RoB7 escolhe só pelas regras (desconto, nota, vendas, frete). Com a IA ele confere se é mesmo da categoria e escolhe as melhores.';
  $$('[data-agentinfo]').forEach((el) => {
    const c = a.categories.find((x) => x.id === el.dataset.agentinfo);
    el.innerHTML = c ? `🤖 Última busca: ${agentLine(c)}` : '';
  });
  $$('[data-catrun]').forEach((b) => { b.disabled = Boolean(a.running); });
}
on('btnSendNext', (b) => busy(b, async () => {
  const offer = await api('/api/queue/send-next', { method: 'POST', body: {} });
  toast(offer.status === 'postada' ? `#${offer.id} postada!` : `#${offer.id}: ${offer.error || 'não foi'}`, offer.status === 'postada' ? 'ok' : 'bad');
}));

// ---------- nova oferta ----------
on('btnAdd', (b) => busy(b, async () => {
  const text = $('#newLinks').value.trim();
  if (!text) throw new Error('Cole pelo menos um link.');
  $('#addStatus').textContent = '⏳ Lendo os produtos… (pode levar alguns segundos por link)';
  $('#addResults').innerHTML = '';
  try {
    const results = await api('/api/offers', { method: 'POST', body: { text, category: $('#newCategory').value || 'auto' } });
    $('#addResults').innerHTML = results.map((r) => {
      if (r.offer) {
        const missing = r.offer.missing.length ? ` — ⚠️ falta ${r.offer.missing.join(', ')}` : '';
        const why = r.offer.missing.length && (r.offer.notes || []).length
          ? `<div class="note">${r.offer.notes.map((n) => `ℹ️ ${esc(n)}`).join('<br>')}</div>` : '';
        const tip = r.offer.missing.length ? '<div class="note">Dá pra completar na aba <b>Aprovar</b> (ou clicar em 🔄 Ler de novo).</div>' : '';
        return `<div class="result ${missing ? 'warn' : 'ok'}">✅ Oferta <b>#${r.offer.id}</b> ${esc(r.offer.title || '(sem nome)')} <span class="chip">${esc(catName(r.offer.category))}</span>${esc(missing)}${why}${tip}</div>`;
      }
      if (r.duplicateId) return `<div class="result warn">⚠️ ${esc(r.message)} <button class="btn small" data-repeat="${esc(r.duplicateId)}">Postar de novo mesmo assim</button></div>`;
      return `<div class="result bad">❌ ${esc(r.url)}<br>${esc(r.error)}</div>`;
    }).join('');
    $$('[data-repeat]', $('#addResults')).forEach((btn) => btn.addEventListener('click', () => busy(btn, async () => {
      const offer = await api(`/api/offers/${btn.dataset.repeat}/repeat`, { method: 'POST', body: {} });
      btn.parentElement.innerHTML = `✅ Montei de novo como <b>#${offer.id}</b>. Veja em Aprovar.`;
    })));
    const ok = results.filter((r) => r.offer).length;
    $('#addStatus').textContent = ok ? `${ok} oferta(s) montada(s). Veja na aba Aprovar.` : '';
    if (ok) $('#newLinks').value = '';
  } catch (error) {
    $('#addStatus').textContent = '';
    throw error;
  }
}));

// ---------- aprovar e fila: lista + editor do lado ----------
function imageTag(offer, cls = 'thumb') {
  if (!offer.imageUrl) return `<div class="${cls} empty">Sem foto</div>`;
  const v = encodeURIComponent(offer.imageUrl.slice(-24));
  return `<img class="${cls}" loading="lazy" src="/api/offers/${offer.id}/image?v=${v}" alt="" onerror="this.outerHTML='<div class=&quot;${cls} empty&quot;>Foto não carregou</div>'">`;
}

function chips(offer) {
  const [name, cls] = PLATFORM[offer.platform] || [offer.platform, ''];
  const out = [`<span class="chip ${cls}">${esc(name)}</span>`, `<span class="chip">#${esc(offer.id)}</span>`, `<span class="chip">${esc(catName(offer.category))}</span>`, `<span class="chip">via ${esc(ORIGIN[offer.origin] || offer.origin)}</span>`];
  for (const m of offer.missing || []) out.push(`<span class="chip warn">falta ${esc(m)}</span>`);
  if (offer.status === 'falhou') out.push('<span class="chip bad">falhou</span>');
  return `<div class="chips">${out.join('')}</div>`;
}

// --- Prévia da mensagem (mesma regra do programa: src/message.js) ---
function compactTitleJs(raw) {
  let title = String(raw || '').replace(/\s+/g, ' ').trim()
    .replace(/^\s*(?:até\s*)?\d{1,3}%\s*off\s*/i, '')
    .replace(/^\s*(?:oferta|promoção|promocao|lançamento|lancamento)\s*[:\-–|]?\s*/i, '')
    .replace(/\bcomissão\s*extra\b/gi, '')
    .replace(/\b(?:imperdível|imperdivel|super oferta|mais vendido|frete grátis|frete gratis)\b/gi, '')
    .replace(/\s+[|–-]\s+(?:shopee(?: brasil)?|mercado livre|tiktok shop|tiktok)\s*$/i, '')
    .replace(/\s{2,}/g, ' ').trim();
  let result = title.split(' ').filter(Boolean).slice(0, 16).join(' ');
  if (result.length > 112) result = result.slice(0, 113).replace(/\s+\S*$/, '').trim();
  return result;
}
function parsePriceJs(value) {
  let t = String(value ?? '').trim().replace(/R\$|BRL/gi, '').replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!t || !/\d/.test(t)) return NaN;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  else if (/^\d{1,3}\.\d{3}$/.test(t)) t = t.replace('.', '');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n < 1000000 ? Math.round(n * 100) / 100 : NaN;
}
const moneyMsg = (n) => money(n).replace(/ /g, ' ');
function previewCaption(f) {
  const m = state?.settings.message || {};
  const title = compactTitleJs(f.title);
  const price = parsePriceJs(f.price);
  if (!title) return { error: 'Preencha o nome pra ver a prévia.' };
  if (!Number.isFinite(price)) return { error: 'Preencha o preço pra ver a prévia.' };
  const old = parsePriceJs(f.oldPrice);
  const hasOld = Number.isFinite(old) && old > price;
  const lines = [];
  const percent = hasOld ? Math.floor((1 - price / old) * 100 + 1e-9) : 0;
  if (m.showDiscount !== false && percent >= 5) lines.push(`*🔥 ${percent}% OFF*`);
  lines.push(`🛍️ ${title}`, '');
  if (hasOld) lines.push(`❌ De: ${moneyMsg(old)}`);
  lines.push(`🔥 Por: ${moneyMsg(price)}`);
  const coupon = String(f.coupon || '').trim().replace(/\s+/g, '');
  if (m.showCoupon !== false && coupon) lines.push(`🎟️ Cupom: ${coupon}`);
  lines.push('', '🛒 Compre aqui:', f.publishUrl);
  const footer = String(m.footer ?? '').trim();
  if (footer) lines.push('', footer);
  return { text: lines.join('\n') };
}
// *negrito* do WhatsApp vira negrito na prévia; link fica azul.
function chatHtml(text) {
  return esc(text)
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<span class="chat-link">$1</span>');
}

const selected = { aprovar: '', fila: '' };
const lists = { aprovar: [], fila: [] };
const editorEl = { aprovar: () => $('#editorPending'), fila: () => $('#editorQueue') };

function editorBusy(tab) {
  const el = editorEl[tab]();
  return Boolean(el && (el.dataset.dirty === '1' || el.contains(document.activeElement)));
}

function rowHtml(o, tab, time) {
  const discount = o.discount >= 5 ? ` · <span class="off">${o.discount}% OFF</span>` : '';
  const price = o.price ? money(o.price) : '<span class="warn-text">sem preço</span>';
  const coupon = o.coupon ? ` · cupom ${esc(o.coupon)}` : '';
  const missing = (o.missing || []).length ? `<div class="sub warn-text">falta ${esc(o.missing.join(', '))}</div>` : '';
  const left = tab === 'fila'
    ? `<div class="time">${time ? hhmm(time) : '--:--'}</div>`
    : `<div class="time small-id">#${esc(o.id)}</div>`;
  const actions = tab === 'fila'
    ? (filter.fila ? `<button class="btn small" data-move="up" title="Subir" aria-label="Subir">↑</button><button class="btn small" data-move="down" title="Descer" aria-label="Descer">↓</button>` : '')
    : `<button class="btn small primary" data-q="approve" ${o.missing.length ? 'disabled' : ''}>✅ Aprovar</button><button class="btn small danger" data-q="reject" aria-label="Descartar">🗑️</button>`;
  return `<div class="qrow selectable ${selected[tab] === o.id ? 'selected' : ''}" data-id="${esc(o.id)}" tabindex="0" role="button" aria-label="Editar oferta ${esc(o.id)}">
    ${left}
    ${o.imageUrl ? `<img src="/api/offers/${o.id}/image?v=${encodeURIComponent(o.imageUrl.slice(-24))}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
    <div class="info"><div class="title">${esc(o.title || '(sem nome)')}</div><div class="sub">${filter[tab] ? '' : `${esc(catName(o.category))} · `}${esc((PLATFORM[o.platform] || [''])[0])} · ${price}${discount}${coupon}</div>${missing}</div>
    <div class="actions">${actions}</div>
  </div>`;
}

function bindRows(box, tab) {
  $$('.qrow', box).forEach((row) => {
    const id = row.dataset.id;
    row.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      selectOffer(tab, id);
    });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) selectOffer(tab, id); });
    $$('[data-move]', row).forEach((b) => b.addEventListener('click', () => busy(b, () => api(`/api/offers/${id}/move`, { method: 'POST', body: { direction: b.dataset.move } }))));
    $$('[data-q]', row).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      await api(`/api/offers/${id}/${b.dataset.q}`, { method: 'POST', body: {} });
      toast(b.dataset.q === 'approve' ? `#${id} foi pra fila.` : `#${id} descartada.`);
    })));
  });
}

function selectOffer(tab, id) {
  const el = editorEl[tab]();
  if (el?.dataset.dirty === '1' && selected[tab] !== id && !confirm('Você mudou essa oferta e não salvou. Trocar mesmo assim?')) return;
  selected[tab] = id;
  $$(`#${tab === 'fila' ? 'queueList' : 'pendingList'} .qrow`).forEach((r) => r.classList.toggle('selected', r.dataset.id === id));
  renderEditor(tab, true);
  if (window.matchMedia('(max-width: 900px)').matches) el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderEditor(tab, force = false) {
  const el = editorEl[tab]();
  if (!el) return;
  if (!force && editorBusy(tab)) return;
  const offer = lists[tab].find((o) => o.id === selected[tab]);
  if (!offer) {
    el.dataset.dirty = '';
    el.innerHTML = `<div class="editor-empty">${lists[tab].length ? 'Clique numa oferta pra editar e ver como ela chega no grupo.' : 'Nada aqui.'}</div>`;
    return;
  }
  const notes = [...(offer.notes || [])];
  if (offer.oldPriceNote) notes.unshift(`"De" ${offer.oldPriceNote}.`);
  const time = tab === 'fila' ? (state?.queue.plan || []).find((p) => p.id === offer.id)?.at : null;
  const buttons = offer.status === 'fila'
    ? `<button class="btn primary" data-ed="save">Salvar</button><button class="btn" data-ed="send-now">🚀 Postar agora</button><button class="btn" data-ed="unqueue">↩️ Tirar da fila</button>`
    : `<button class="btn primary" data-ed="save-approve">✅ Salvar e aprovar</button><button class="btn" data-ed="save">Salvar</button><button class="btn" data-ed="send-now">🚀 Postar agora</button><button class="btn" data-ed="reread">🔄 Ler de novo</button><button class="btn danger" data-ed="reject">🗑️ Descartar</button>`;
  el.dataset.dirty = '';
  el.innerHTML = `
    <div class="editor-head"><h2>Editar oferta #${esc(offer.id)}</h2>${time ? `<span class="muted small">sai às ${hhmm(time)}</span>` : ''}</div>
    ${chips(offer)}
    <label>Nome<input data-f="title" value="${esc(offer.title)}" placeholder="Nome do produto"></label>
    <label>Categoria (o grupo e a fila dela)<select data-f="category">${catList().map((c) => `<option value="${esc(c.id)}" ${c.id === offer.category ? 'selected' : ''}>${esc(catName(c.id))}${c.enabled ? '' : ' (desligada)'}</option>`).join('')}</select></label>
    <div class="fields3">
      <label>Por (R$)<input data-f="price" value="${esc(priceInput(offer.price))}" inputmode="decimal" placeholder="ex.: 49,90"></label>
      <label>De (R$)<input data-f="oldPrice" value="${esc(priceInput(offer.oldPrice))}" inputmode="decimal" placeholder="opcional"></label>
      <label>Cupom<input data-f="coupon" value="${esc(offer.coupon || '')}" placeholder="opcional" autocapitalize="characters"></label>
    </div>
    <label>Foto (link https)<input data-f="imageUrl" value="${esc(offer.imageUrl)}" placeholder="https://..."></label>
    ${notes.map((n) => `<p class="note">ℹ️ ${esc(n)}</p>`).join('')}
    ${offer.error ? `<p class="note" style="color:var(--red)">❌ ${esc(offer.error)}</p>` : ''}
    <div class="muted small mt">Assim chega no grupo</div>
    <div class="chat">
      <div class="bubble">
        ${offer.imageUrl ? `<img src="/api/offers/${offer.id}/image?v=${encodeURIComponent(offer.imageUrl.slice(-24))}" alt="Foto da oferta" onerror="this.outerHTML='<div class=&quot;bubble-noimg&quot;>Foto não carregou</div>'">` : '<div class="bubble-noimg">Sem foto</div>'}
        <div class="bubble-text" data-preview></div>
      </div>
    </div>
    <div class="actions mt">${buttons}<a class="btn small" href="${esc(offer.publishUrl)}" target="_blank" rel="noopener noreferrer">Abrir link ↗</a></div>`;

  const inputs = $$('[data-f]', el);
  const original = Object.fromEntries(inputs.map((i) => [i.dataset.f, i.value]));
  const refresh = () => {
    const values = Object.fromEntries(inputs.map((i) => [i.dataset.f, i.value]));
    const changed = inputs.some((i) => i.value !== original[i.dataset.f]);
    el.dataset.dirty = changed ? '1' : '';
    const p = previewCaption({ ...values, publishUrl: offer.publishUrl });
    $('[data-preview]', el).innerHTML = p.error ? `<span class="warn-text">⚠️ ${esc(p.error)}</span>` : chatHtml(p.text);
  };
  inputs.forEach((i) => {
    i.addEventListener('input', refresh);
    i.addEventListener('change', refresh);
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-ed="save"]', el)?.click(); } });
  });
  refresh();

  const changes = () => Object.fromEntries(inputs.filter((i) => i.value !== original[i.dataset.f]).map((i) => [i.dataset.f, i.value]));
  const save = async () => {
    const patch = changes();
    if (!Object.keys(patch).length) return offer;
    const updated = await api(`/api/offers/${offer.id}`, { method: 'PATCH', body: patch });
    el.dataset.dirty = '';
    return updated;
  };
  $$('[data-ed]', el).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const act = b.dataset.ed;
    if (act === 'save') { await save(); toast(`#${offer.id} salva.`); }
    if (act === 'save-approve') { await save(); await api(`/api/offers/${offer.id}/approve`, { method: 'POST', body: {} }); selected[tab] = ''; toast(`#${offer.id} foi pra fila.`); }
    if (act === 'send-now') {
      await save();
      const r = await api(`/api/offers/${offer.id}/send-now`, { method: 'POST', body: {} });
      selected[tab] = '';
      toast(r.status === 'postada' ? `#${offer.id} postada!` : `#${offer.id}: ${r.error || 'não foi'}`, r.status === 'postada' ? 'ok' : 'bad');
    }
    if (act === 'unqueue') { await api(`/api/offers/${offer.id}/unqueue`, { method: 'POST', body: {} }); selected[tab] = ''; toast(`#${offer.id} voltou pra Aprovar.`); }
    if (act === 'reject') { await api(`/api/offers/${offer.id}/reject`, { method: 'POST', body: {} }); selected[tab] = ''; toast(`#${offer.id} descartada.`); }
    if (act === 'reread') { await api(`/api/offers/${offer.id}/reread`, { method: 'POST', body: {} }); toast(`#${offer.id} lida de novo.`); }
    el.dataset.dirty = '';
    await (tab === 'fila' ? loadQueue() : loadPending());
    renderEditor(tab, true);
  })));
}

async function loadPending() {
  const list = await api(`/api/offers?status=aguardando${filter.aprovar ? `&category=${encodeURIComponent(filter.aprovar)}` : ''}`).catch(() => null);
  if (!list) return;
  lists.aprovar = list;
  if (!list.some((o) => o.id === selected.aprovar) && !editorBusy('aprovar')) selected.aprovar = list[0]?.id || '';
  const box = $('#pendingList');
  box.innerHTML = list.length ? list.map((o) => rowHtml(o, 'aprovar')).join('') : `<div class="empty-state">✅ Nada esperando aprovação${filter.aprovar ? ` em ${esc(catName(filter.aprovar))}` : ''}. Cole links em <b>Nova oferta</b>, mande pro grupo de comando ou clique em <b>🔎 Procurar agora</b> no Início.</div>`;
  bindRows(box, 'aprovar');
  renderEditor('aprovar');
}

on('btnApproveAll', (b) => busy(b, async () => {
  const list = await api(`/api/offers?status=aguardando${filter.aprovar ? `&category=${encodeURIComponent(filter.aprovar)}` : ''}`);
  let ok = 0;
  for (const offer of list.filter((o) => !o.missing.length)) {
    await api(`/api/offers/${offer.id}/approve`, { method: 'POST', body: {} });
    ok++;
  }
  toast(ok ? `${ok} oferta(s) foram pra fila.` : 'Nenhuma oferta completa pra aprovar.', ok ? 'ok' : 'bad');
}));

async function loadQueue() {
  const list = await api(`/api/offers?status=fila${filter.fila ? `&category=${encodeURIComponent(filter.fila)}` : ''}`).catch(() => null);
  if (!list) return;
  const plan = new Map((state?.queue.plan || []).map((p) => [p.id, p.at]));
  // "Todas": na ordem em que vão sair (cada categoria tem o seu horário).
  if (!filter.fila) list.sort((a, b) => String(plan.get(a.id) || '9').localeCompare(String(plan.get(b.id) || '9')));
  lists.fila = list;
  if (!list.some((o) => o.id === selected.fila) && !editorBusy('fila')) selected.fila = list[0]?.id || '';
  const q = state?.queue;
  const c = catList().find((x) => x.id === filter.fila);
  $('#queueInfo').textContent = c
    ? `${c.start} às ${c.end}, uma a cada ${c.intervalMin} min • ${c.groups.length} grupo(s)${c.enabled ? '' : ' • categoria desligada'}${q?.paused ? ' • ⏸️ pausada' : ''}`
    : `Cada categoria tem o seu horário. Escolha uma pra mudar a ordem.${q?.paused ? ' • ⏸️ pausada' : ''}`;
  const box = $('#queueList');
  box.innerHTML = list.length ? list.map((o) => rowHtml(o, 'fila', plan.get(o.id))).join('') : `<div class="empty-state">📋 Fila vazia${c ? ` em ${esc(catName(c.id))}` : ''}. Aprove ofertas na aba <b>Aprovar</b>.</div>`;
  bindRows(box, 'fila');
  const first = $('.qrow [data-move="up"]', box);
  if (first) first.disabled = true;
  const last = $$('.qrow [data-move="down"]', box).at(-1);
  if (last) last.disabled = true;
  renderEditor('fila');
}

// ---------- postadas ----------
async function loadPosted() {
  const list = await api('/api/offers?status=postada,falhou').catch(() => null);
  if (!list) return;
  list.sort((a, b) => String(b.postedAt || b.updatedAt).localeCompare(String(a.postedAt || a.updatedAt)));
  const box = $('#postedList');
  box.innerHTML = list.length ? list.slice(0, 150).map((o) => {
    const ok = (o.results || []).filter((r) => r.ok).length;
    const total = (o.results || []).length;
    const failed = o.status === 'falhou';
    return `<div class="qrow" data-id="${esc(o.id)}">
      <div class="time" style="color:${failed ? 'var(--red)' : 'var(--lime)'}">${ddmmhh(o.postedAt || o.updatedAt).replace(' ', '<br>')}</div>
      ${o.imageUrl ? `<img src="/api/offers/${o.id}/image?v=${encodeURIComponent(o.imageUrl.slice(-24))}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
      <div><div class="title">#${esc(o.id)} ${esc(o.title)}</div>
        <div class="sub">${failed ? `❌ ${esc(o.error || 'falhou')}` : `✅ ${ok}/${total} grupo(s)`} • ${o.price ? money(o.price) : ''}</div></div>
      <div class="actions">${failed
        ? '<button class="btn small" data-p="approve">🔁 Tentar de novo</button><button class="btn small danger" data-p="reject">🗑️</button>'
        : '<button class="btn small" data-p="repeat">🔁 Postar de novo</button>'}</div>
    </div>`;
  }).join('') : '<div class="empty-state">📤 Nada postado ainda.</div>';
  $$('.qrow', box).forEach((row) => {
    $$('[data-p]', row).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      const offer = await api(`/api/offers/${row.dataset.id}/${b.dataset.p}`, { method: 'POST', body: {} });
      toast(b.dataset.p === 'repeat' ? `Montei de novo como #${offer.id}. Veja em Aprovar.` : b.dataset.p === 'approve' ? `#${offer.id} voltou pra fila.` : `#${offer.id} descartada.`);
    })));
  });
}

// ---------- filtros por categoria (Aprovar e Fila) ----------
function renderFilter(tab) {
  const box = $(tab === 'fila' ? '#filterFila' : '#filterAprovar');
  if (!box || !state) return;
  const key = tab === 'fila' ? 'fila' : 'aguardando';
  const by = state.counts.byCategory || {};
  const count = (n) => (n ? `<b>${n}</b>` : '');
  const cats = catList().filter((c) => c.enabled || by[c.id]?.[key] || c.id === filter[tab]);
  box.innerHTML = [
    `<button data-filter="" class="${filter[tab] ? '' : 'active'}">Todas${count(state.counts[key])}</button>`,
    ...cats.map((c) => `<button data-filter="${esc(c.id)}" class="${filter[tab] === c.id ? 'active' : ''}">${esc(catName(c.id))}${count(by[c.id]?.[key])}</button>`)
  ].join('');
  $$('button', box).forEach((b) => b.addEventListener('click', () => {
    if (editorEl[tab]()?.dataset.dirty === '1' && !confirm('Você mudou uma oferta e não salvou. Trocar mesmo assim?')) return;
    filter[tab] = b.dataset.filter;
    selected[tab] = '';
    editorEl[tab]().dataset.dirty = '';
    renderFilter(tab);
    if (tab === 'fila') loadQueue(); else loadPending();
  }));
}

let categorySig = '';
function renderCategorySelect() {
  const sig = JSON.stringify([catList().map((c) => [c.id, c.name, c.enabled]), state.settings.ai.hasKey]);
  if (sig === categorySig) return;
  categorySig = sig;
  const sel = $('#newCategory');
  const keep = sel.value || 'auto';
  sel.innerHTML = `<option value="auto">🤖 Automática (${state.settings.ai.hasKey ? 'a IA escolhe' : 'pelas palavras'})</option>`
    + catList().map((c) => `<option value="${esc(c.id)}">${esc(catName(c.id))}${c.enabled ? '' : ' (desligada)'}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : 'auto';
}

// ---------- configurações ----------
function fillConfig() {
  if (!state) return;
  const s = state.settings;
  $('#msgFooter').value = s.message.footer;
  $('#msgDiscount').checked = s.message.showDiscount !== false;
  $('#msgCoupon').checked = s.message.showCoupon !== false;
  $('#repeatDays').value = s.repeatDays;
  $('#platML').checked = s.platforms.mercadolivre;
  $('#platShopee').checked = s.platforms.shopee;
  $('#platTiktok').checked = s.platforms.tiktok;
  $('#shopeeAppId').value = s.shopeeApi.appId;
  $('#shopeeSecret').value = '';
  $('#shopeeSecret').placeholder = s.shopeeApi.hasSecret ? '•••••••• (salvo)' : 'Cole o Secret';
  $('#agEnabled').checked = s.agent.enabled;
  $$('input[name="agMode"]').forEach((r) => { r.checked = r.value === (s.agent.autopilot ? 'auto' : 'treino'); });
  $('#agNotify').checked = s.agent.notifyZap;
  $('#agEvery').value = s.agent.everyMin;
  $('#agPerRun').value = s.agent.perRun;
  $('#agMaxPending').value = s.agent.maxPending;
  $('#aiKey').value = '';
  $('#aiKey').placeholder = s.ai.hasKey ? '•••••••• (salva)' : 'sk-ant-...';
  $('#aiLimit').value = s.ai.dailyLimitUsd;
  $('#aiClassify').checked = s.ai.classifyLinks !== false;
  $('#chromePath').value = s.browser.chromePath || '';
  $('#tunnelUrl').value = s.tunnel.publicUrl || '';
  $('#tunnelEnabled').checked = s.tunnel.enabled;
  $('#tunnelToken').value = '';
  $('#tunnelToken').placeholder = s.tunnel.hasToken ? '•••••••• (salvo)' : 'cole aqui (começa com eyJ...)';
  $('#aboutInfo').textContent = `Versão ${state.version} • dados guardados em ${state.dataDir}`;
  renderCategories();
  renderControlSelect();
  renderAgent();
}

async function saveSettings(patch, message = 'Salvo!') {
  await api('/api/settings', { method: 'PUT', body: patch });
  toast(message);
}

// --- grupos do WhatsApp ---
async function loadGroups(refresh) {
  if (!state || state.wa.state !== 'conectado') {
    groupsList = [];
  } else {
    groupsList = await api(`/api/groups${refresh ? '?refresh=1' : ''}`).catch((e) => { toast(e.message, 'bad'); return []; });
  }
  renderControlSelect();
  for (const c of catList()) renderCatGroups(c.id);
}

function groupNameOf(jid) {
  return groupsList.find((g) => g.jid === jid)?.name || 'grupo (abra com o WhatsApp conectado pra ver o nome)';
}

function renderControlSelect() {
  const sel = $('#controlSelect');
  const current = state.settings.groups.control;
  if (!groupsList.length) {
    sel.innerHTML = `<option value="${esc(current)}">${current ? 'Grupo salvo (conecte o WhatsApp pra ver o nome)' : state.wa.state === 'conectado' ? 'Carregando grupos…' : 'Conecte o WhatsApp primeiro'}</option>`;
    return;
  }
  const sorted = [...groupsList].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  sel.innerHTML = `<option value="">— escolha o grupo —</option>${sorted.map((g) => `<option value="${esc(g.jid)}" ${g.jid === current ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}`;
}

on('btnGroupsRefresh', (b) => busy(b, () => loadGroups(true)));
on('btnTestControl', (b) => busy(b, async () => { await api('/api/whatsapp/test', { method: 'POST', body: {} }); toast('Mandei um oi no grupo de comando.'); }));
on('btnSaveControl', (b) => busy(b, () => saveSettings({ groups: { control: $('#controlSelect').value } }, 'Grupo de comando salvo!')));

// --- categorias ---
let catGroups = {}; // rascunho dos grupos de cada categoria (só salva no botão)

function catHtml(c) {
  const general = c.id === 'geral';
  const days = DAYS.map((d, i) => `<label><input type="checkbox" value="${i}" ${c.days.includes(i) ? 'checked' : ''}> ${d}</label>`).join('');
  const search = general ? '<p class="muted small mt">Aqui caem os links que você manda e que não são de nenhuma outra categoria. O RoB7 não procura pra Geral.</p>' : `
      <h3>🔎 O que o RoB7 procura</h3>
      <label>Palavras de busca (separe por vírgula)<textarea rows="3" data-c="keywords">${esc(c.keywords.join(', '))}</textarea></label>
      <div class="form-grid">
        <label>Desconto mínimo (%)<input type="number" min="0" max="95" data-c="minDiscount" value="${esc(c.minDiscount)}"></label>
        <label>Nota mínima (0 a 5)<input type="number" min="0" max="5" step="0.1" data-c="minRating" value="${esc(c.minRating)}"></label>
        <label>Mínimo de avaliações<input type="number" min="0" data-c="minReviews" value="${esc(c.minReviews)}"></label>
        <label>Preço máximo (0 = sem limite)<input type="number" min="0" step="1" data-c="maxPrice" value="${esc(c.maxPrice)}"></label>
      </div>
      <label class="switch mt"><input type="checkbox" data-c="requireFreeShipping" ${c.requireFreeShipping ? 'checked' : ''}> Só com frete grátis ou Full (Mercado Livre)</label>`;
  return `<details class="cat" data-cat="${esc(c.id)}">
    <summary><span class="cat-name">${esc(catName(c.id))}</span><span class="chips" data-catmeta></span></summary>
    <div class="cat-body">
      <label class="switch mt"><input type="checkbox" data-c="enabled" ${c.enabled ? 'checked' : ''}> Categoria ligada</label>
      <h3>👥 Grupos onde a Luna posta</h3>
      <div class="chosen" data-chosen></div>
      <input placeholder="Procurar grupo..." data-gfilter>
      <div class="groups" data-glist></div>
      <h3>🕗 Horário da fila</h3>
      <div class="form-grid">
        <label>Começa<input type="time" data-c="start" value="${esc(c.start)}"></label>
        <label>Termina<input type="time" data-c="end" value="${esc(c.end)}"></label>
        <label>Uma oferta a cada (min)<input type="number" min="5" max="720" data-c="intervalMin" value="${esc(c.intervalMin)}"></label>
      </div>
      <div class="days" data-days>${days}</div>
      ${search}
      <div class="row gap mt">
        <button class="btn primary" data-catsave>Salvar ${esc(c.name)}</button>
        ${general ? '' : '<button class="btn" data-catrun>🔎 Procurar agora</button>'}
      </div>
      ${general ? '' : `<p class="muted small" data-agentinfo="${esc(c.id)}"></p>`}
    </div>
  </details>`;
}

function renderCategories() {
  catGroups = Object.fromEntries(catList().map((c) => [c.id, new Set(c.groups)]));
  const box = $('#catList');
  box.innerHTML = catList().map(catHtml).join('');
  $$('details.cat', box).forEach((d) => {
    const id = d.dataset.cat;
    d.addEventListener('toggle', () => renderCatGroups(id));
    $('[data-gfilter]', d).addEventListener('input', () => renderCatGroups(id));
    $('[data-catsave]', d).addEventListener('click', (e) => { e.preventDefault(); busy(e.currentTarget, () => saveCategory(id)); });
    $('[data-catrun]', d)?.addEventListener('click', (e) => {
      e.preventDefault();
      busy(e.currentTarget, async () => {
        await api('/api/agent/run', { method: 'POST', body: { category: id } });
        toast(`🤖 RoB7 procurando em ${catName(id)}… leva uns minutos.`);
      });
    });
    renderChosen(id);
  });
  renderCatMeta();
}

function renderCatMeta() {
  for (const d of $$('#catList details.cat')) {
    const c = catList().find((x) => x.id === d.dataset.cat);
    if (!c) continue;
    const size = state.queue.categories.find((x) => x.id === c.id)?.size || 0;
    $('[data-catmeta]', d).innerHTML = `<span class="chip ${c.enabled ? 'ok' : ''}">${c.enabled ? 'ligada' : 'desligada'}</span>`
      + `<span class="chip ${c.enabled && !c.groups.length ? 'warn' : ''}">${c.groups.length ? `${c.groups.length} grupo(s)` : 'sem grupo'}</span>`
      + `<span class="chip">${size} na fila</span>`;
  }
}

function renderChosen(id) {
  const d = $(`#catList details[data-cat="${id}"]`);
  if (!d) return;
  const sel = catGroups[id] || new Set();
  $('[data-chosen]', d).innerHTML = sel.size
    ? [...sel].map((jid) => `<span class="chip ok">${esc(groupNameOf(jid))}</span>`).join('')
    : '<span class="muted small">Nenhum grupo ainda. Marque abaixo.</span>';
}

function renderCatGroups(id) {
  renderChosen(id);
  const d = $(`#catList details[data-cat="${id}"]`);
  if (!d || !d.open) return;
  const box = $('[data-glist]', d);
  if (!groupsList.length) {
    box.innerHTML = `<p class="muted" style="padding:10px">${state.wa.state === 'conectado' ? 'Carregando grupos…' : 'Conecte o WhatsApp primeiro.'}</p>`;
    return;
  }
  const sel = catGroups[id];
  const owner = new Map();
  for (const [cid, set] of Object.entries(catGroups)) if (cid !== id) for (const jid of set) owner.set(jid, cid);
  const control = state.settings.groups.control;
  const wanted = $('[data-gfilter]', d).value.trim().toLowerCase();
  const list = groupsList.filter((g) => !wanted || g.name.toLowerCase().includes(wanted));
  box.innerHTML = list.length ? list.map((g) => {
    const taken = g.jid === control ? 'é o grupo de comando' : owner.has(g.jid) ? `já é de ${catName(owner.get(g.jid))}` : '';
    return `<div class="group"><div class="gname" title="${esc(g.name)}">${esc(g.name)} <span class="muted small">${g.size} pessoas</span></div>
      <label class="${taken ? 'taken' : ''}"><input type="checkbox" data-gj="${esc(g.jid)}" ${sel.has(g.jid) ? 'checked' : ''} ${taken ? 'disabled' : ''}> ${esc(taken || 'Postar aqui')}</label></div>`;
  }).join('') : '<p class="muted" style="padding:10px">Nenhum grupo encontrado.</p>';
  $$('[data-gj]', box).forEach((input) => input.addEventListener('change', () => {
    if (input.checked) sel.add(input.dataset.gj); else sel.delete(input.dataset.gj);
    renderChosen(id);
  }));
}

async function saveCategory(id) {
  const d = $(`#catList details[data-cat="${id}"]`);
  const c = catList().find((x) => x.id === id);
  const field = (k) => $(`[data-c="${k}"]`, d);
  const patch = {
    id,
    enabled: field('enabled').checked,
    groups: [...catGroups[id]],
    start: field('start').value,
    end: field('end').value,
    intervalMin: Number(field('intervalMin').value),
    days: $$('[data-days] input', d).filter((i) => i.checked).map((i) => Number(i.value))
  };
  if (id !== 'geral') {
    Object.assign(patch, {
      keywords: field('keywords').value.split(',').map((k) => k.trim()).filter(Boolean),
      minDiscount: Number(field('minDiscount').value),
      minRating: Number(field('minRating').value),
      minReviews: Number(field('minReviews').value),
      maxPrice: Number(field('maxPrice').value),
      requireFreeShipping: field('requireFreeShipping').checked
    });
  }
  const added = patch.groups.filter((jid) => !c.groups.includes(jid));
  if (added.length && !confirm(`A Luna vai postar as ofertas de ${c.name} nestes grupos:\n${added.map((jid) => `• ${groupNameOf(jid)}`).join('\n')}\n\nConfirma?`)) return;
  await saveSettings({ categories: [patch] }, `${c.name} salva!`);
  if (patch.enabled && !patch.groups.length) toast(`${c.name} está ligada mas sem grupo: as ofertas ficam esperando até você escolher.`, 'bad');
}

// --- agente RoB7 e IA ---
on('btnSaveAgent', (b) => busy(b, async () => {
  const autopilot = $('input[name="agMode"]:checked')?.value === 'auto';
  if (autopilot && !state.settings.agent.autopilot && !confirm('Piloto automático: o RoB7 vai pôr as ofertas direto na fila, sem perguntar. Confirma?')) return;
  const patch = { agent: { enabled: $('#agEnabled').checked, autopilot, notifyZap: $('#agNotify').checked }, ai: { dailyLimitUsd: Number($('#aiLimit').value) } };
  if ($('#aiKey').value.trim()) patch.ai.apiKey = $('#aiKey').value.trim();
  await saveSettings(patch, 'RoB7 salvo!');
  $('#aiKey').value = '';
}));
on('btnSaveAgentAdv', (b) => busy(b, () => saveSettings({
  agent: { everyMin: Number($('#agEvery').value), perRun: Number($('#agPerRun').value), maxPending: Number($('#agMaxPending').value) },
  ai: { classifyLinks: $('#aiClassify').checked }
}, 'Ritmo do RoB7 salvo!')));
on('btnTestAi', (b) => busy(b, async () => {
  $('#aiTestResult').textContent = 'Testando…';
  try {
    await api('/api/ai/test', { method: 'POST', body: {} });
    $('#aiTestResult').textContent = '✅ A IA respondeu! Está funcionando.';
  } catch (error) {
    $('#aiTestResult').textContent = `❌ ${error.message}`;
    throw error;
  }
}));
on('btnClearAi', (b) => busy(b, async () => {
  if (!confirm('Apagar a chave da IA? O RoB7 continua, só que escolhendo pelas regras.')) return;
  await saveSettings({ ai: { clear: true } }, 'Chave da IA apagada.');
}));

// --- avançado ---
on('btnSaveMessage', (b) => busy(b, () => saveSettings({ message: { footer: $('#msgFooter').value, showDiscount: $('#msgDiscount').checked, showCoupon: $('#msgCoupon').checked }, repeatDays: Number($('#repeatDays').value) })));
on('btnSavePlatforms', (b) => busy(b, () => saveSettings({ platforms: { mercadolivre: $('#platML').checked, shopee: $('#platShopee').checked, tiktok: $('#platTiktok').checked } }, 'Lojas salvas!')));
on('btnSaveShopee', (b) => busy(b, async () => {
  await saveSettings({ shopeeApi: { appId: $('#shopeeAppId').value, secret: $('#shopeeSecret').value } }, 'API da Shopee salva!');
  $('#shopeeSecret').value = '';
}));
on('btnClearShopee', (b) => busy(b, async () => {
  if (!confirm('Apagar o App ID e o Secret da Shopee?')) return;
  await saveSettings({ shopeeApi: { clear: true } }, 'API da Shopee apagada.');
  fillConfig();
}));
on('btnTestShopee', (b) => busy(b, async () => {
  $('#shopeeTestResult').textContent = 'Testando…';
  try {
    const r = await api('/api/shopee/test', { method: 'POST', body: {} });
    $('#shopeeTestResult').textContent = `✅ Funcionou! Exemplo: ${r.sample.join(' | ') || '(sem produtos)'}`;
  } catch (error) {
    $('#shopeeTestResult').textContent = `❌ ${error.message}`;
    throw error;
  }
}));

function renderBrowserInfo() {
  const b = state.browser;
  $('#browserInfo').innerHTML = b.chromeFound ? `✅ Chrome encontrado: <span class="muted">${esc(b.chromePath)}</span>${b.mode === 'janela' ? '<br>🪟 Janela de login aberta — feche quando terminar.' : ''}${b.lastError ? `<br><span style="color:var(--yellow)">Último aviso: ${esc(b.lastError)}</span>` : ''}` : '❌ Chrome não encontrado. Instale o Google Chrome ou informe o caminho abaixo.';
}

on('btnBrowserLogin', (b) => busy(b, async () => { await api('/api/browser/login', { method: 'POST', body: {} }); toast('Abri a janela. Entre nas contas e feche a janela quando terminar.'); }));
on('btnSaveChrome', (b) => busy(b, () => saveSettings({ browser: { chromePath: $('#chromePath').value } })));

function renderWaConfig() {
  const wa = state.wa;
  $('#waConfig').innerHTML = wa.state === 'conectado'
    ? `<p>✅ Conectado como <b>+${esc(wa.me?.number || '')}</b>.</p>`
    : `<p>${esc(waText(wa)[0])}${wa.lastError ? ` — ${esc(wa.lastError)}` : ''}</p><p class="muted small">O QR code aparece na aba Início.</p>`;
}
on('btnWaRestart', (b) => busy(b, async () => { await api('/api/whatsapp/restart', { method: 'POST', body: {} }); toast('Reconectando…'); }));
on('btnWaLogout', (b) => busy(b, async () => {
  if (!confirm('Desconectar este aparelho do WhatsApp? Depois vai precisar ler o QR de novo.')) return;
  await api('/api/whatsapp/logout', { method: 'POST', body: {} });
  toast('Desconectado. Leia o QR novo na aba Início.');
}));

on('btnChangePw', (b) => busy(b, async () => {
  await api('/api/auth/password', { method: 'POST', body: { current: $('#pwCurrent').value, next: $('#pwNext').value } });
  $('#pwCurrent').value = '';
  $('#pwNext').value = '';
  toast('Senha trocada! Os outros aparelhos vão pedir a senha nova.');
}));
on('btnLogout', (b) => busy(b, async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); checkAuth(); }));

// ---------- celular (túnel) ----------
let tunnelQrFor = null;
function renderTunnel() {
  const t = state.tunnel || {};
  const cfg = state.settings.tunnel || {};
  const url = cfg.publicUrl;
  let text;
  if (!t.installed) text = t.installing ? '⏳ Instalando o cloudflared…' : '⚪ O cloudflared ainda não está instalado neste PC.';
  else if (t.state === 'ligado') text = `✅ Ligado! ${url ? `Abra no celular: <b>${esc(url)}</b>` : 'Coloque o endereço abaixo pra eu mostrar o QR.'}`;
  else if (t.state === 'ligando') text = '⏳ Ligando o túnel…';
  else if (t.state === 'erro') text = `❌ ${esc(t.lastError)}`;
  else text = cfg.enabled ? '⏳ Esperando…' : '⚪ Desligado.';
  $('#tunnelInfo').innerHTML = text;
  $('#btnInstallTunnel').classList.toggle('hidden', Boolean(t.installed));
  $('#btnRestartTunnel').classList.toggle('hidden', !cfg.enabled);
  const want = t.state === 'ligado' && url ? url : '';
  if (want !== tunnelQrFor) {
    tunnelQrFor = want;
    if (!want) { $('#tunnelQr').innerHTML = ''; return; }
    api('/api/tunnel/qr').then((r) => {
      if (tunnelQrFor !== want || !r.qr) return;
      $('#tunnelQr').innerHTML = `<img src="${r.qr}" alt="QR code do endereço do painel"><p class="muted small">Aponte a câmera do iPhone, abra, entre com a senha e toque em <b>Compartilhar › Adicionar à Tela de Início</b>.</p>`;
    }).catch(() => {});
  }
}

on('btnSaveTunnel', (b) => busy(b, async () => {
  const patch = { tunnel: { publicUrl: $('#tunnelUrl').value, enabled: $('#tunnelEnabled').checked } };
  if ($('#tunnelToken').value.trim()) patch.tunnel.token = $('#tunnelToken').value;
  await saveSettings(patch, 'Celular salvo!');
  $('#tunnelToken').value = '';
}));
on('btnInstallTunnel', (b) => busy(b, async () => {
  toast('Instalando o cloudflared… pode levar 1 ou 2 minutos.');
  await api('/api/tunnel/install', { method: 'POST', body: {} });
  toast('cloudflared instalado!');
}));
on('btnRestartTunnel', (b) => busy(b, async () => { await api('/api/tunnel/restart', { method: 'POST', body: {} }); toast('Reiniciando o túnel…'); }));

// ---------- registro ----------
const logBuffer = [];
function addLog(entry) {
  logBuffer.push(entry);
  if (logBuffer.length > 300) logBuffer.shift();
  if (currentTab === 'config') renderLogs();
}
function renderLogs() {
  $('#logList').innerHTML = logBuffer.slice().reverse().map((e) => `<div class="${esc(e.level)}">${ddmmhh(e.at)} [${esc(e.area)}] ${esc(e.message)}${e.extra ? ` — ${esc(typeof e.extra === 'string' ? e.extra : JSON.stringify(e.extra))}` : ''}</div>`).join('');
}
async function loadLogs() {
  const list = await api('/api/logs').catch(() => []);
  logBuffer.splice(0, logBuffer.length, ...list);
  renderLogs();
}

checkAuth();
