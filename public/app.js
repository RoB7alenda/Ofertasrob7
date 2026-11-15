// Painel do Ofertas RoB7 V3 (sem framework, só JavaScript).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const priceInput = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toFixed(2).replace('.', ','));
const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const ddmmhh = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const PLATFORM = { mercadolivre: ['Mercado Livre', 'ml'], shopee: ['Shopee', 'shopee'], tiktok: ['TikTok Shop', 'tiktok'] };
const ORIGIN = { painel: 'painel', lista: 'lista', zap: 'zap', radar: 'radar' };
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

let state = null;
let currentTab = 'inicio';
let lastRev = -1;
let groupsList = [];
let events = null;
let configFilled = false;
let pairingOpen = false;

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
  renderRadarStatus();
  renderWaConfig();
  renderBrowserInfo();
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
  $('#homeQueue').textContent = q.size;
  $('#homeNext').textContent = q.paused ? 'Fila pausada.' : q.next ? `Próxima postagem às ${hhmm(q.next)}.` : (q.size ? 'Fora do horário — volta no próximo horário.' : 'Fila vazia.');
  $('#btnPause').textContent = q.paused ? '▶️ Ligar fila' : '⏸️ Pausar';
  $('#homePosted').textContent = state.counts.postadasHoje;
  $('#homePending').textContent = state.counts.aguardando;
  $('#homeFailed').textContent = state.counts.falhou;
  $('#homeRadar').innerHTML = state.radar.map((r) => `<div>${r.enabled ? '🟢' : '⚪'} <b>${esc(r.name)}</b> — ${r.running ? 'rodando agora…' : r.lastRunAt ? `última ${ddmmhh(r.lastRunAt)}: ${esc(r.lastError || r.lastResult || '')}` : (r.enabled ? 'ainda não rodou' : 'desligado')}</div>`).join('');

  const s = state.settings;
  const steps = [
    ['Conectar o WhatsApp da Luna (QR code acima)', wa.state === 'conectado'],
    ['Escolher o grupo de comando (Configurações › Grupos)', Boolean(s.groups.control)],
    ['Marcar os grupos onde as ofertas vão ser postadas', s.groups.offers.length > 0],
    ['Entrar nas contas da Shopee e do Mercado Livre (Configurações › Contas no navegador)', null],
    ['(Opcional, recomendado) Colocar a API da Shopee', s.shopeeApi.hasSecret]
  ];
  const mustDone = steps.slice(0, 3).every(([, done]) => done);
  const card = $('#setupCard');
  card.classList.toggle('hidden', mustDone);
  card.innerHTML = `<h2>🚦 Primeiros passos</h2><ol class="setup-list">${steps.map(([t, done]) => `<li class="${done ? 'done' : ''}">${done ? '✅ ' : ''}${esc(t)}</li>`).join('')}</ol>`;
}

on('btnPause', (b) => busy(b, () => api('/api/queue/pause', { method: 'POST', body: { paused: !state.queue.paused } })));
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
    const results = await api('/api/offers', { method: 'POST', body: { text } });
    $('#addResults').innerHTML = results.map((r) => {
      if (r.offer) {
        const missing = r.offer.missing.length ? ` — ⚠️ falta ${r.offer.missing.join(', ')}` : '';
        return `<div class="result ${missing ? 'warn' : 'ok'}">✅ Oferta <b>#${r.offer.id}</b> ${esc(r.offer.title || '(sem nome)')}${esc(missing)}</div>`;
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
  const out = [`<span class="chip ${cls}">${esc(name)}</span>`, `<span class="chip">#${esc(offer.id)}</span>`, `<span class="chip">via ${esc(ORIGIN[offer.origin] || offer.origin)}</span>`];
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
    ? `<button class="btn small" data-move="up" title="Subir" aria-label="Subir">↑</button><button class="btn small" data-move="down" title="Descer" aria-label="Descer">↓</button>`
    : `<button class="btn small primary" data-q="approve" ${o.missing.length ? 'disabled' : ''}>✅ Aprovar</button><button class="btn small danger" data-q="reject" aria-label="Descartar">🗑️</button>`;
  return `<div class="qrow selectable ${selected[tab] === o.id ? 'selected' : ''}" data-id="${esc(o.id)}" tabindex="0" role="button" aria-label="Editar oferta ${esc(o.id)}">
    ${left}
    ${o.imageUrl ? `<img src="/api/offers/${o.id}/image?v=${encodeURIComponent(o.imageUrl.slice(-24))}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
    <div class="info"><div class="title">${esc(o.title || '(sem nome)')}</div><div class="sub">${esc((PLATFORM[o.platform] || [''])[0])} · ${price}${discount}${coupon}</div>${missing}</div>
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

  const inputs = $$('input[data-f]', el);
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
  const list = await api('/api/offers?status=aguardando').catch(() => null);
  if (!list) return;
  lists.aprovar = list;
  if (!list.some((o) => o.id === selected.aprovar) && !editorBusy('aprovar')) selected.aprovar = list[0]?.id || '';
  const box = $('#pendingList');
  box.innerHTML = list.length ? list.map((o) => rowHtml(o, 'aprovar')).join('') : '<div class="empty-state">✅ Nada esperando aprovação. Cole links em <b>Nova oferta</b> ou mande pro grupo de comando.</div>';
  bindRows(box, 'aprovar');
  renderEditor('aprovar');
}

on('btnApproveAll', (b) => busy(b, async () => {
  const list = await api('/api/offers?status=aguardando');
  let ok = 0;
  for (const offer of list.filter((o) => !o.missing.length)) {
    await api(`/api/offers/${offer.id}/approve`, { method: 'POST', body: {} });
    ok++;
  }
  toast(ok ? `${ok} oferta(s) foram pra fila.` : 'Nenhuma oferta completa pra aprovar.', ok ? 'ok' : 'bad');
}));

async function loadQueue() {
  const list = await api('/api/offers?status=fila').catch(() => null);
  if (!list) return;
  lists.fila = list;
  if (!list.some((o) => o.id === selected.fila) && !editorBusy('fila')) selected.fila = list[0]?.id || '';
  const plan = new Map((state?.queue.plan || []).map((p) => [p.id, p.at]));
  const q = state?.queue;
  const s = state?.settings.queue;
  $('#queueInfo').textContent = s ? `${s.start} às ${s.end}, uma a cada ${s.intervalMin} min${q?.paused ? ' • ⏸️ pausada' : ''}` : '';
  const box = $('#queueList');
  box.innerHTML = list.length ? list.map((o) => rowHtml(o, 'fila', plan.get(o.id))).join('') : '<div class="empty-state">📋 Fila vazia. Aprove ofertas na aba <b>Aprovar</b>.</div>';
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

// ---------- configurações ----------
function fillConfig() {
  if (!state) return;
  const s = state.settings;
  $('#qStart').value = s.queue.start;
  $('#qEnd').value = s.queue.end;
  $('#qInterval').value = s.queue.intervalMin;
  $('#qDays').innerHTML = DAYS.map((d, i) => `<label><input type="checkbox" value="${i}" ${s.queue.days.includes(i) ? 'checked' : ''}> ${d}</label>`).join('');
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
  $('#radarNotify').checked = s.radar.notifyZap;
  const rs = s.radar.shopee;
  $('#rsEnabled').checked = rs.enabled;
  $('#rsEvery').value = rs.everyMin;
  $('#rsPerRun').value = rs.perRun;
  $('#rsDiscount').value = rs.minDiscount;
  $('#rsSales').value = rs.minSales;
  $('#rsRating').value = rs.minRating;
  $('#rsMaxPrice').value = rs.maxPrice;
  $('#rsKeywords').value = (rs.keywords || []).join(', ');
  const rm = s.radar.mercadolivre;
  $('#rmEnabled').checked = rm.enabled;
  $('#rmEvery').value = rm.everyMin;
  $('#rmPerRun').value = rm.perRun;
  $('#chromePath').value = s.browser.chromePath || '';
  $('#aboutInfo').textContent = `Versão ${state.version} • dados guardados em ${state.dataDir}`;
  configFilled = true;
}

async function saveSettings(patch, message = 'Salvo!') {
  await api('/api/settings', { method: 'PUT', body: patch });
  toast(message);
}

let groupSel = { offers: new Set(), control: '' };

async function loadGroups(refresh) {
  const box = $('#groupsList');
  if (!state || state.wa.state !== 'conectado') {
    box.innerHTML = '<p class="muted" style="padding:10px">Conecte o WhatsApp primeiro.</p>';
    return;
  }
  box.innerHTML = '<p class="muted" style="padding:10px">Carregando grupos…</p>';
  groupsList = await api(`/api/groups${refresh ? '?refresh=1' : ''}`).catch((e) => { toast(e.message, 'bad'); return []; });
  groupSel = { offers: new Set(state.settings.groups.offers), control: state.settings.groups.control };
  renderGroups();
}

function renderGroups() {
  const filter = $('#groupFilter').value.trim().toLowerCase();
  const list = groupsList.filter((g) => !filter || g.name.toLowerCase().includes(filter));
  $('#groupsList').innerHTML = list.length ? list.map((g) => `<div class="group">
      <div class="gname" title="${esc(g.name)}">${esc(g.name)} <span class="muted small">${g.size} pessoas</span></div>
      <label><input type="checkbox" data-offer="${esc(g.jid)}" ${groupSel.offers.has(g.jid) ? 'checked' : ''}> Postar aqui</label>
      <label><input type="radio" name="controlGroup" data-control="${esc(g.jid)}" ${groupSel.control === g.jid ? 'checked' : ''}> Comando</label>
    </div>`).join('') : '<p class="muted" style="padding:10px">Nenhum grupo encontrado.</p>';
  $$('[data-offer]').forEach((input) => input.addEventListener('change', () => {
    if (input.checked) groupSel.offers.add(input.dataset.offer); else groupSel.offers.delete(input.dataset.offer);
  }));
  $$('[data-control]').forEach((input) => input.addEventListener('change', () => { if (input.checked) groupSel.control = input.dataset.control; }));
}

$('#groupFilter').addEventListener('input', renderGroups);
on('btnGroupsRefresh', (b) => busy(b, () => loadGroups(true)));
on('btnTestControl', (b) => busy(b, async () => { await api('/api/whatsapp/test', { method: 'POST', body: {} }); toast('Mandei um oi no grupo de comando.'); }));
on('btnSaveGroups', (b) => busy(b, async () => {
  const offersJids = [...groupSel.offers];
  const names = groupsList.filter((g) => groupSel.offers.has(g.jid)).map((g) => `• ${g.name}`).join('\n');
  if (offersJids.length && !confirm(`A Luna vai postar ofertas nestes grupos:\n${names}\n\nConfirma?`)) return;
  await saveSettings({ groups: { offers: offersJids, control: groupSel.control } }, 'Grupos salvos!');
}));

on('btnSaveQueue', (b) => busy(b, () => saveSettings({
  queue: {
    start: $('#qStart').value,
    end: $('#qEnd').value,
    intervalMin: Number($('#qInterval').value),
    days: $$('#qDays input').filter((i) => i.checked).map((i) => Number(i.value))
  }
}, 'Horário salvo!')));

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

on('btnSaveRadar', (b) => busy(b, () => saveSettings({
  radar: {
    notifyZap: $('#radarNotify').checked,
    shopee: {
      enabled: $('#rsEnabled').checked,
      everyMin: Number($('#rsEvery').value),
      perRun: Number($('#rsPerRun').value),
      minDiscount: Number($('#rsDiscount').value),
      minSales: Number($('#rsSales').value),
      minRating: Number($('#rsRating').value),
      maxPrice: Number($('#rsMaxPrice').value),
      keywords: $('#rsKeywords').value.split(',').map((k) => k.trim()).filter(Boolean)
    },
    mercadolivre: { enabled: $('#rmEnabled').checked, everyMin: Number($('#rmEvery').value), perRun: Number($('#rmPerRun').value) }
  }
}, 'Radar salvo!')));
const runRadar = (platform) => (b) => busy(b, async () => {
  toast('Radar rodando… pode levar alguns minutos.');
  const r = await api(`/api/radar/${platform}/run`, { method: 'POST', body: {} });
  toast(r.added ? `Radar achou ${r.added} oferta(s). Veja em Aprovar.` : 'Radar não achou nada novo dessa vez.');
});
on('btnRunShopee', runRadar('shopee'));
on('btnRunML', runRadar('mercadolivre'));

function renderRadarStatus() {
  $('#radarStatus').innerHTML = state.radar.map((r) => `${esc(r.name)}: ${r.running ? 'rodando…' : r.lastRunAt ? `última ${ddmmhh(r.lastRunAt)} — ${esc(r.lastError ? `❌ ${r.lastError}` : r.lastResult || '')}` : 'nunca rodou'}`).join('<br>');
}

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
