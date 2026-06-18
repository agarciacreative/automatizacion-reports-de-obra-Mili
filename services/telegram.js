'use strict';
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const { extraerPartes, extraerActa } = require('./ocr');
const { generarResumen } = require('./summary');
const { generarPDF }     = require('./pdf');

const OBRAS_FILE      = path.join(__dirname, '..', 'obras.json');
const TMP_DIR         = path.join(__dirname, '..', 'tmp', 'telegram');
const CONFIRM_TIMEOUT = 2500; // ms sin foto nueva → mostrar botones

// ── ESTADOS ──
const S = {
  IDLE:       'IDLE',
  TIPO:       'TIPO',       // eligiendo report o acta
  OBRA:       'OBRA',       // teclado de obras
  FOTOS_OBRA: 'FOTOS_OBRA', // acumulando fotos de obra (report)
  PARTES:     'PARTES',     // acumulando partes (report)
  APUNTES:    'APUNTES',    // acumulando apuntes manuscritos (acta)
  FOTOS_ACTA: 'FOTOS_ACTA', // fotos de obra opcionales (acta)
  PLANOS:     'PLANOS',     // planos opcionales (acta)
  PROCESSING: 'PROCESSING',
};

// ── SESIONES ──
const sessions = new Map();

function newSession() {
  return {
    state: S.IDLE, tipo: null, obra: null,
    fotosObra: [], partes: [],
    apuntes: [], fotosActaObra: [], planos: [],
    timer: null, promptMsgId: null,
  };
}

function getSession(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, newSession());
  return sessions.get(chatId);
}

function resetSession(chatId) {
  const s = sessions.get(chatId);
  if (s?.timer) clearTimeout(s.timer);
  [
    ...(s?.fotosObra || []), ...(s?.partes || []),
    ...(s?.apuntes || []), ...(s?.fotosActaObra || []), ...(s?.planos || []),
  ].forEach(p => { try { fs.unlinkSync(p); } catch {} });
  sessions.set(chatId, newSession());
}

// ── API TELEGRAM ──
let BASE;

function api(method, data = {}) {
  return axios.post(`${BASE}/${method}`, data, { timeout: 35000 }).then(r => r.data.result);
}

function sendMsg(chatId, text, extra = {}) {
  return api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

function editMsg(chatId, msgId, text, keyboard = null) {
  const body = { chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: keyboard } : { inline_keyboard: [] } };
  return api('editMessageText', body).catch(() => {});
}

function answerCb(cbId, text = '') {
  return api('answerCallbackQuery', { callback_query_id: cbId, text }).catch(() => {});
}

async function sendDoc(chatId, filePath, caption) {
  const buffer   = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const form     = new FormData();
  form.append('chat_id',    String(chatId));
  form.append('caption',    caption || '');
  form.append('parse_mode', 'HTML');
  form.append('document',   new Blob([buffer]), filename);
  const res = await fetch(`${BASE}/sendDocument`, { method: 'POST', body: form });
  return (await res.json()).result;
}

// ── HELPERS ──
function readObrasActivas() {
  try {
    const data = JSON.parse(fs.readFileSync(OBRAS_FILE, 'utf8'));
    const list = Array.isArray(data) ? data : (data.obras || []);
    return list.filter(o => o.activa !== false);
  } catch { return []; }
}

async function downloadPhoto(fileId, dest) {
  const info = await api('getFile', { file_id: fileId });
  const url  = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${info.file_path}`;
  const res  = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, res.data);
}

function getSemanaActual() {
  const today   = new Date();
  const lastSun = new Date(today);
  lastSun.setDate(today.getDate() - today.getDay());
  const lastMon = new Date(lastSun);
  lastMon.setDate(lastSun.getDate() - 6);
  const M = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  if (lastMon.getMonth() === lastSun.getMonth()) {
    return `${lastMon.getDate()}–${lastSun.getDate()} ${M[lastSun.getMonth()]} ${lastSun.getFullYear()}`;
  }
  return `${lastMon.getDate()} ${M[lastMon.getMonth()]} – ${lastSun.getDate()} ${M[lastSun.getMonth()]} ${lastSun.getFullYear()}`;
}

function plural(n, sin, plu) { return `${n} ${n === 1 ? sin : plu}`; }

// ── PIPELINE REPORT ──
async function runPipelineReport(chatId, session) {
  session.state = S.PROCESSING;
  try {
    await sendMsg(chatId, '⏳ <b>Generando el report…</b>\n\nEsto puede tardar un minuto.');

    await sendMsg(chatId, '🔍 Leyendo los partes…');
    const { trabajos, confianza, semana: semanaOcr } = await extraerPartes(session.partes);

    // Usar la semana que dice el parte escrito; si no se lee, calcular desde hoy
    const semana = semanaOcr || getSemanaActual();
    await sendMsg(chatId, '✍️ Redactando el resumen ejecutivo…');
    const resumen = await generarResumen(trabajos, session.obra, semana);

    await sendMsg(chatId, '📄 Componiendo el PDF…');
    const pdf = await generarPDF({
      obra: session.obra, semana, encargado: 'Domingo',
      estado: 'Obra en ejecución.', resumen, trabajos,
      fotos: session.fotosObra,
    }, 'report');

    const confTag = confianza === 'alta'
      ? '✅ Confianza alta'
      : `⚠️ Confianza ${confianza} — revisa el report antes de enviarlo`;

    await sendDoc(chatId, pdf.path,
      `📋 <b>Report semanal · ${session.obra}</b>\n${semana}\n\n${confTag}`);

    [...session.partes, ...session.fotosObra].forEach(p => { try { fs.unlinkSync(p); } catch {} });
    resetSession(chatId);
    await sendMsg(chatId, '✅ ¡Listo! Escribe cualquier cosa para generar otro documento.');
  } catch (err) {
    console.error('[Bot] Error en pipeline report:', err.message);
    await sendMsg(chatId,
      `❌ Error generando el report:\n<code>${err.message}</code>\n\nEscribe /cancelar para empezar de nuevo.`);
    resetSession(chatId);
  }
}

// ── PIPELINE ACTA ──
async function runPipelineActa(chatId, session) {
  session.state = S.PROCESSING;
  try {
    await sendMsg(chatId, '⏳ <b>Generando el acta…</b>\n\nEsto puede tardar un minuto.');

    await sendMsg(chatId, '🔍 Leyendo los apuntes…');
    let actaData = await extraerActa(session.apuntes);

    // Completar campos desde obras.json si la IA no los extrajo
    if (!actaData.ubicacion || !actaData.promotor) {
      try {
        const obrasCfg = JSON.parse(fs.readFileSync(OBRAS_FILE, 'utf8'));
        const rec = (obrasCfg.obras || []).find(o => o.nombre === session.obra);
        if (rec) {
          if (!actaData.ubicacion && rec.direccion) actaData.ubicacion = rec.direccion;
          if (!actaData.promotor  && rec.promotor)  actaData.promotor  = rec.promotor;
        }
      } catch {}
    }
    if (!actaData.obra_nombre) actaData.obra_nombre = session.obra;

    await sendMsg(chatId, '📄 Componiendo el PDF…');
    const pdf = await generarPDF({
      obra:        session.obra,
      actaData,
      fotosObra:   session.fotosActaObra,
      fotosPlanos: session.planos,
    }, 'acta');

    const extras = [
      session.fotosActaObra.length > 0 ? `${session.fotosActaObra.length} foto${session.fotosActaObra.length !== 1 ? 's' : ''} de obra` : null,
      session.planos.length > 0        ? `${session.planos.length} plano${session.planos.length !== 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(' · ') || 'sin fotos adjuntas';

    await sendDoc(chatId, pdf.path,
      `📝 <b>Acta de visita · ${session.obra}</b>\n${actaData.fecha_display || ''}\n\n${extras}`);

    [...session.apuntes, ...session.fotosActaObra, ...session.planos].forEach(p => { try { fs.unlinkSync(p); } catch {} });
    resetSession(chatId);
    await sendMsg(chatId, '✅ ¡Listo! Escribe cualquier cosa para generar otro documento.');
  } catch (err) {
    console.error('[Bot] Error en pipeline acta:', err.message);
    await sendMsg(chatId,
      `❌ Error generando el acta:\n<code>${err.message}</code>\n\nEscribe /cancelar para empezar de nuevo.`);
    resetSession(chatId);
  }
}

// ── HANDLERS ──
async function showTipoKeyboard(chatId) {
  const session = getSession(chatId);
  session.state = S.TIPO;
  await sendMsg(chatId, '👋 ¡Hola Mili!\n\n¿Qué quieres generar?', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Report semanal', callback_data: 'tipo:report' }],
        [{ text: '📝 Acta de visita',  callback_data: 'tipo:acta'   }],
      ],
    },
  });
}

async function showObrasKeyboard(chatId) {
  const obras = readObrasActivas();
  if (obras.length === 0) {
    await sendMsg(chatId, '⚠️ No hay obras activas configuradas en el sistema.');
    return;
  }
  const session = getSession(chatId);
  session.state = S.OBRA;
  const keyboard = obras.map(o => [{ text: o.nombre, callback_data: `obra:${o.nombre}` }]);
  await sendMsg(chatId, '¿Para qué obra?', { reply_markup: { inline_keyboard: keyboard } });
}

// Muestra mensaje con botón "Saltar" para secciones opcionales del acta
async function showOptionalPrompt(chatId, session, text) {
  const keyboard = [[{ text: '↩ Saltar sección', callback_data: 'skip_optional' }]];
  const sent = await sendMsg(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  session.promptMsgId = sent?.message_id || null;
}

function extFromMime(mime) {
  if (mime === 'image/png')  return 'png';
  if (mime === 'image/gif')  return 'gif';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

function isImageDocument(doc) {
  return !!doc && typeof doc.mime_type === 'string' && doc.mime_type.startsWith('image/');
}

async function handlePhoto(chatId, msg, session) {
  const validStates = [S.FOTOS_OBRA, S.PARTES, S.APUNTES, S.FOTOS_ACTA, S.PLANOS];
  if (!validStates.includes(session.state)) {
    await sendMsg(chatId, '⚠️ No esperaba fotos ahora. Escribe algo para empezar de nuevo.');
    return;
  }

  // Telegram envía la imagen como msg.photo si va comprimida, o como
  // msg.document (sin comprimir, "enviar como archivo") — ambas son válidas.
  const isDoc  = !msg.photo && isImageDocument(msg.document);
  const fileId = isDoc ? msg.document.file_id : msg.photo[msg.photo.length - 1].file_id;
  const ext    = isDoc ? extFromMime(msg.document.mime_type) : 'jpg';
  const dest   = path.join(TMP_DIR, String(chatId), `${Date.now()}.${ext}`);

  try {
    await downloadPhoto(fileId, dest);
  } catch (err) {
    console.error('[Bot] Error descargando foto:', err.message);
    await sendMsg(chatId, '⚠️ No pude descargar la foto. Inténtalo de nuevo.');
    return;
  }

  switch (session.state) {
    case S.FOTOS_OBRA:  session.fotosObra.push(dest);    break;
    case S.PARTES:      session.partes.push(dest);        break;
    case S.APUNTES:     session.apuntes.push(dest);       break;
    case S.FOTOS_ACTA:  session.fotosActaObra.push(dest); break;
    case S.PLANOS:      session.planos.push(dest);        break;
  }

  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => showConfirmButtons(chatId, session), CONFIRM_TIMEOUT);

  const countText = getCountText(session);
  if (session.promptMsgId) {
    await editMsg(chatId, session.promptMsgId, countText);
  } else {
    const sent = await sendMsg(chatId, countText);
    session.promptMsgId = sent?.message_id || null;
  }
}

function getCountText(session) {
  switch (session.state) {
    case S.FOTOS_OBRA:  return `📷 ${plural(session.fotosObra.length,    'foto de obra recibida',  'fotos de obra recibidas')}…`;
    case S.PARTES:      return `📋 ${plural(session.partes.length,        'parte recibido',         'partes recibidos')}…`;
    case S.APUNTES:     return `📝 ${plural(session.apuntes.length,       'apunte recibido',        'apuntes recibidos')}…`;
    case S.FOTOS_ACTA:  return `📷 ${plural(session.fotosActaObra.length, 'foto de obra recibida',  'fotos de obra recibidas')}…`;
    case S.PLANOS:      return `📐 ${plural(session.planos.length,        'plano recibido',         'planos recibidos')}…`;
    default: return '…';
  }
}

async function showConfirmButtons(chatId, session) {
  session.timer = null;

  const CFG = {
    [S.FOTOS_OBRA]:  { count: session.fotosObra.length,    sin: 'foto de obra',  plu: 'fotos de obra',  ok: 'fotos_obra_ok',  mas: 'fotos_obra_mas',  g: 'f' },
    [S.PARTES]:      { count: session.partes.length,        sin: 'parte',         plu: 'partes',         ok: 'partes_ok',      mas: 'partes_mas',       g: 'm' },
    [S.APUNTES]:     { count: session.apuntes.length,       sin: 'apunte',        plu: 'apuntes',        ok: 'apuntes_ok',     mas: 'apuntes_mas',      g: 'm' },
    [S.FOTOS_ACTA]:  { count: session.fotosActaObra.length, sin: 'foto de obra',  plu: 'fotos de obra',  ok: 'fotos_acta_ok',  mas: 'fotos_acta_mas',   g: 'f', optional: true },
    [S.PLANOS]:      { count: session.planos.length,        sin: 'plano',         plu: 'planos',         ok: 'planos_ok',      mas: 'planos_mas',       g: 'm', optional: true },
  };

  const c = CFG[session.state];
  if (!c) return;

  const suffix = c.g === 'f' ? (c.count === 1 ? 'a' : 'as') : (c.count === 1 ? 'o' : 'os');
  const text   = `${plural(c.count, c.sin, c.plu)} recibid${suffix}. ¿Hay más?`;

  const keyboard = [[
    { text: '✅ Ya están todas', callback_data: c.ok  },
    { text: '📸 Envío más',      callback_data: c.mas },
  ]];
  if (c.optional) {
    keyboard.push([{ text: '↩ Saltar sección', callback_data: 'skip_optional' }]);
  }

  if (session.promptMsgId) {
    await editMsg(chatId, session.promptMsgId, text, keyboard);
  } else {
    const sent = await sendMsg(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    session.promptMsgId = sent?.message_id || null;
  }
}

function clearTimer(session) {
  if (session.timer) { clearTimeout(session.timer); session.timer = null; }
}

async function confirmAndClear(chatId, session, text) {
  clearTimer(session);
  if (session.promptMsgId) {
    await editMsg(chatId, session.promptMsgId, text);
    session.promptMsgId = null;
  }
}

async function sendMoreAndClear(chatId, session, text) {
  clearTimer(session);
  if (session.promptMsgId) {
    await editMsg(chatId, session.promptMsgId, text);
    session.promptMsgId = null;
  }
}

async function handleCallback(chatId, cb) {
  const session = getSession(chatId);
  const data    = cb.data;

  // ── Selección de tipo de documento ──
  if (data.startsWith('tipo:')) {
    await answerCb(cb.id);
    session.tipo = data.slice(5);
    await showObrasKeyboard(chatId);
    return;
  }

  // ── Selección de obra ──
  if (data.startsWith('obra:')) {
    const obraName  = data.slice(5);
    const validObra = readObrasActivas().find(o => o.nombre === obraName);
    if (!validObra) { await answerCb(cb.id, 'Obra no válida'); return; }
    await answerCb(cb.id);
    session.obra = validObra.nombre;

    if (session.tipo === 'acta') {
      session.state = S.APUNTES;
      await sendMsg(chatId,
        `✅ <b>${session.obra}</b> · Acta de visita\n\nEnvíame las <b>fotos de los apuntes manuscritos</b> 📝\nPuedes enviar todos los que quieras.`);
    } else {
      session.state = S.FOTOS_OBRA;
      await sendMsg(chatId,
        `✅ <b>${session.obra}</b> · Report semanal\n\nAhora envíame las <b>fotos de obra</b> 📸\nPuedes enviar todas las que quieras.`);
    }
    return;
  }

  // ── REPORT: fotos de obra ──
  if (data === 'fotos_obra_ok') {
    await answerCb(cb.id, '¡Perfecto!');
    await confirmAndClear(chatId, session,
      `✅ ${plural(session.fotosObra.length, 'foto de obra confirmada', 'fotos de obra confirmadas')}.`);
    session.state = S.PARTES;
    await sendMsg(chatId, '📋 Ahora envíame las <b>fotos de los partes escritos</b>.\nPuedes enviar todos los que quieras.');
    return;
  }
  if (data === 'fotos_obra_mas') {
    await answerCb(cb.id, 'De acuerdo, sigue enviando');
    await sendMoreAndClear(chatId, session,
      `📷 ${plural(session.fotosObra.length, 'foto de obra recibida', 'fotos de obra recibidas')}. Sigue enviando…`);
    return;
  }

  // ── REPORT: partes ──
  if (data === 'partes_ok') {
    await answerCb(cb.id, '¡Perfecto!');
    await confirmAndClear(chatId, session,
      `✅ ${plural(session.partes.length, 'parte confirmado', 'partes confirmados')}.`);
    runPipelineReport(chatId, session);
    return;
  }
  if (data === 'partes_mas') {
    await answerCb(cb.id, 'De acuerdo, sigue enviando');
    await sendMoreAndClear(chatId, session,
      `📋 ${plural(session.partes.length, 'parte recibido', 'partes recibidos')}. Sigue enviando…`);
    return;
  }

  // ── ACTA: apuntes ──
  if (data === 'apuntes_ok') {
    await answerCb(cb.id, '¡Perfecto!');
    await confirmAndClear(chatId, session,
      `✅ ${plural(session.apuntes.length, 'apunte confirmado', 'apuntes confirmados')}.`);
    session.state = S.FOTOS_ACTA;
    await showOptionalPrompt(chatId, session,
      '📸 ¿Quieres añadir <b>fotos de obra</b>? (opcional)\n\nEnvía las fotos directamente o salta la sección.');
    return;
  }
  if (data === 'apuntes_mas') {
    await answerCb(cb.id, 'De acuerdo, sigue enviando');
    await sendMoreAndClear(chatId, session,
      `📝 ${plural(session.apuntes.length, 'apunte recibido', 'apuntes recibidos')}. Sigue enviando…`);
    return;
  }

  // ── ACTA: fotos de obra (opcional) ──
  if (data === 'fotos_acta_ok') {
    await answerCb(cb.id, '¡Perfecto!');
    await confirmAndClear(chatId, session,
      `✅ ${plural(session.fotosActaObra.length, 'foto de obra confirmada', 'fotos de obra confirmadas')}.`);
    session.state = S.PLANOS;
    await showOptionalPrompt(chatId, session,
      '📐 ¿Quieres añadir <b>fotos de planos</b>? (opcional)\n\nEnvía las fotos directamente o salta la sección.');
    return;
  }
  if (data === 'fotos_acta_mas') {
    await answerCb(cb.id, 'De acuerdo, sigue enviando');
    await sendMoreAndClear(chatId, session,
      `📷 ${plural(session.fotosActaObra.length, 'foto de obra recibida', 'fotos de obra recibidas')}. Sigue enviando…`);
    return;
  }

  // ── ACTA: planos (opcional) ──
  if (data === 'planos_ok') {
    await answerCb(cb.id, '¡Perfecto!');
    await confirmAndClear(chatId, session,
      `✅ ${plural(session.planos.length, 'plano confirmado', 'planos confirmados')}.`);
    runPipelineActa(chatId, session);
    return;
  }
  if (data === 'planos_mas') {
    await answerCb(cb.id, 'De acuerdo, sigue enviando');
    await sendMoreAndClear(chatId, session,
      `📐 ${plural(session.planos.length, 'plano recibido', 'planos recibidos')}. Sigue enviando…`);
    return;
  }

  // ── Saltar sección opcional ──
  if (data === 'skip_optional') {
    await answerCb(cb.id, 'Sección saltada');
    clearTimer(session);

    if (session.state === S.FOTOS_ACTA) {
      if (session.promptMsgId) {
        await editMsg(chatId, session.promptMsgId, '↩ Fotos de obra omitidas.');
        session.promptMsgId = null;
      }
      session.state = S.PLANOS;
      await showOptionalPrompt(chatId, session,
        '📐 ¿Quieres añadir <b>fotos de planos</b>? (opcional)\n\nEnvía las fotos directamente o salta la sección.');
    } else if (session.state === S.PLANOS) {
      if (session.promptMsgId) {
        await editMsg(chatId, session.promptMsgId, '↩ Planos omitidos.');
        session.promptMsgId = null;
      }
      runPipelineActa(chatId, session);
    }
    return;
  }
}

async function handleUpdate(update) {
  const allowedChat = process.env.TELEGRAM_CHAT_ID_MILI;

  if (update.callback_query) {
    const cb     = update.callback_query;
    const chatId = cb.message.chat.id;
    if (String(chatId) !== String(allowedChat)) {
      await answerCb(cb.id, 'No autorizado');
      return;
    }
    await handleCallback(chatId, cb);
    return;
  }

  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  if (String(chatId) !== String(allowedChat)) return;

  if (msg.text === '/start') {
    resetSession(chatId);
    await showTipoKeyboard(chatId);
    return;
  }
  if (msg.text === '/cancelar') {
    resetSession(chatId);
    await sendMsg(chatId, '❌ Cancelado. Escribe cualquier cosa para empezar de nuevo.');
    return;
  }

  const session = getSession(chatId);

  if (session.state === S.PROCESSING) {
    await sendMsg(chatId, '⏳ Estoy generando el documento, espera un momento…');
    return;
  }

  if (msg.photo || isImageDocument(msg.document)) {
    await handlePhoto(chatId, msg, session);
    return;
  }

  // Documento que no es imagen (PDF, etc.) — avisar en vez de ignorarlo en silencio
  if (msg.document) {
    await sendMsg(chatId, '⚠️ Ese archivo no es una imagen. Envíame fotos de los partes/apuntes.');
    return;
  }

  if (session.state === S.IDLE) {
    await showTipoKeyboard(chatId);
    return;
  }

  const photoStates = [S.FOTOS_OBRA, S.PARTES, S.APUNTES, S.FOTOS_ACTA, S.PLANOS];
  if (photoStates.includes(session.state)) {
    await sendMsg(chatId, 'Envíame las fotos directamente 📸');
  }
}

// ── POLLING ──
let offset = 0;

async function poll() {
  try {
    const updates = await api('getUpdates', {
      offset,
      timeout: 30,
      allowed_updates: ['message', 'callback_query'],
    });
    for (const u of updates) {
      offset = u.update_id + 1;
      handleUpdate(u).catch(err => console.error('[Bot] Error en update:', err.message));
    }
  } catch (err) {
    if (!['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT'].includes(err.code)) {
      console.error('[Bot] Error de polling:', err.message);
    }
  }
  setTimeout(poll, 500);
}

// ── INICIO ──
function start() {
  const token       = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChat = process.env.TELEGRAM_CHAT_ID_MILI;

  if (!token) {
    console.log('[Telegram] TELEGRAM_BOT_TOKEN no configurado — bot desactivado');
    return;
  }
  if (!allowedChat) {
    console.error('[Telegram] TELEGRAM_CHAT_ID_MILI no configurado — bot desactivado por seguridad');
    return;
  }

  BASE = `https://api.telegram.org/bot${token}`;
  console.log('[Telegram] Bot iniciado — long polling activo');
  poll();
}

module.exports = { start, isImageDocument, extFromMime };
