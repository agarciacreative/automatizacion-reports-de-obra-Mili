const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { extraerPartes } = require('../services/ocr');
const { generarResumen } = require('../services/summary');

const router = express.Router();

// In-memory job store (suficiente para uso single-user)
const jobs = new Map();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = file.fieldname === 'partes'
      ? path.join(__dirname, '..', 'tmp', 'partes')
      : path.join(__dirname, '..', 'tmp', 'fotos');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

// POST /api/generate — inicia el job y devuelve jobId
router.post('/generate', upload.fields([{ name: 'partes' }, { name: 'fotos' }]), (req, res) => {
  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const { obra, fechaInicio, fechaFin, encargado, tipoDoc, estado } = req.body;
  const partesPaths = (req.files?.partes || []).map(f => f.path);
  const fotosPaths  = (req.files?.fotos  || []).map(f => f.path);

  jobs.set(jobId, { step: 0, done: false, error: null, result: null });
  res.json({ jobId });

  processJob(jobId, { obra, fechaInicio, fechaFin, encargado, tipoDoc, estado, partesPaths, fotosPaths });
});

// GET /api/progress/:jobId — SSE: emite eventos de progreso
router.get('/progress/:jobId', (req, res) => {
  const { jobId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const poll = setInterval(() => {
    const job = jobs.get(jobId);
    if (!job) {
      send({ error: 'Job no encontrado' });
      clearInterval(poll);
      res.end();
      return;
    }
    send({ step: job.step, done: job.done, error: job.error, result: job.done ? job.result : null });
    if (job.done) {
      clearInterval(poll);
      setTimeout(() => res.end(), 200);
      jobs.delete(jobId);
    }
  }, 400);

  req.on('close', () => clearInterval(poll));
});

// ── PIPELINE ──
async function processJob(jobId, data) {
  try {
    const semana = formatSemana(data.fechaInicio, data.fechaFin);

    // Paso 1: OCR de partes
    setStep(jobId, 1);
    let trabajos = [];
    let confianza = 'alta';

    if (data.partesPaths.length > 0) {
      const ocr = await extraerPartes(data.partesPaths);
      trabajos = ocr.trabajos;
      confianza = ocr.confianza;
    }

    // Paso 2: extracción completada
    setStep(jobId, 2);
    await delay(200);

    // Paso 3: resumen ejecutivo
    setStep(jobId, 3);
    const resumen = await generarResumen(trabajos, data.obra, semana);

    // Paso 4: composición con fotos
    setStep(jobId, 4);
    await delay(300);

    // Paso 5: PDF (implementar en Fase 4)
    setStep(jobId, 5);
    await delay(400);

    jobs.set(jobId, {
      step: 5,
      done: true,
      error: null,
      result: {
        obra: data.obra,
        semana,
        encargado: data.encargado,
        tipoDoc: data.tipoDoc,
        estado: data.estado || '',
        trabajos,
        resumen,
        confianza,
        numPartes: data.partesPaths.length,
        numFotos: data.fotosPaths.length,
      },
    });

    // Limpiar temporales de partes (fotos se necesitan en Fase 4 para el PDF)
    data.partesPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });

  } catch (err) {
    console.error('[generate] Error en job', jobId, err.message);
    jobs.set(jobId, { step: 0, done: true, error: err.message, result: null });
  }
}

function setStep(jobId, step) {
  const job = jobs.get(jobId);
  if (job) jobs.set(jobId, { ...job, step });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatSemana(inicio, fin) {
  if (!inicio || !fin) return '—';
  const fi = new Date(inicio + 'T12:00:00');
  const ff = new Date(fin + 'T12:00:00');
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  if (fi.getMonth() === ff.getMonth()) {
    return `${fi.getDate()}–${ff.getDate()} ${months[ff.getMonth()]} ${ff.getFullYear()}`;
  }
  return `${fi.getDate()} ${months[fi.getMonth()]} – ${ff.getDate()} ${months[ff.getMonth()]} ${ff.getFullYear()}`;
}

module.exports = router;
