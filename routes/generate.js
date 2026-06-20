const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { extraerPartes, extraerActa, semanaFromTrabajos } = require('../services/ocr');
const { generarResumen } = require('../services/summary');
const { generarPDF }     = require('../services/pdf');

const router = express.Router();

const jobs = new Map();
const JOB_TTL_MS = 10 * 60 * 1000; // 10 minutos
let lastDebug = null;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subdirs = { partes: 'partes', fotos: 'fotos', fotos_planos: 'planos' };
    const dir = path.join(__dirname, '..', 'tmp', subdirs[file.fieldname] || 'fotos');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.tiff', '.bmp']);
const ALLOWED_PLANOS_EXTS = new Set([...ALLOWED_EXTS, '.pdf']);

function imageFilter(req, file, cb) {
  const ext     = path.extname(file.originalname).toLowerCase();
  const mimeOk  = file.mimetype.startsWith('image/');
  const pdfOk   = file.fieldname === 'fotos_planos' && file.mimetype === 'application/pdf' && ext === '.pdf';
  // application/octet-stream ocurre en móviles (iOS HEIC, etc.) — aceptar si la extensión es válida
  const allowed  = file.fieldname === 'fotos_planos' ? ALLOWED_PLANOS_EXTS : ALLOWED_EXTS;
  const octetOk  = file.mimetype === 'application/octet-stream' && allowed.has(ext);
  if (!mimeOk && !pdfOk && !octetOk) {
    return cb(new Error(`Tipo de archivo no permitido: ${file.mimetype} (${ext || 'sin extensión'})`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB máximo por imagen
});

// POST /api/generate — inicia el job y devuelve jobId
router.post('/generate', upload.fields([{ name: 'partes' }, { name: 'fotos' }, { name: 'fotos_planos' }]), (req, res) => {
  const jobId = crypto.randomUUID();
  const { obra, fechaInicio, fechaFin, encargado, tipoDoc, estado } = req.body;
  const partesPaths      = (req.files?.partes       || []).map(f => f.path);
  const fotosPaths       = (req.files?.fotos        || []).map(f => f.path);
  const fotosPlanosPaths = (req.files?.fotos_planos || []).map(f => f.path);

  console.log(`[generate] tipo=${tipoDoc} partes=${partesPaths.length} fotos=${fotosPaths.length} planos=${fotosPlanosPaths.length}`);

  jobs.set(jobId, { step: 0, done: false, error: null, result: null });
  res.json({ jobId });

  const ttl = setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);

  processJob(jobId, { obra, fechaInicio, fechaFin, encargado, tipoDoc, estado, partesPaths, fotosPaths, fotosPlanosPaths })
    .finally(() => clearTimeout(ttl));
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
  const allTmp = [...data.partesPaths, ...data.fotosPaths, ...data.fotosPlanosPaths];
  try {
    if (data.tipoDoc === 'acta') {
      await processActa(jobId, data);
    } else {
      await processReport(jobId, data);
    }
  } catch (err) {
    console.error('[generate] Error en job', jobId, err.message);
    jobs.set(jobId, { step: 0, done: true, error: err.message, result: null });
    allTmp.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  }
}

async function processReport(jobId, data) {
  const semanaForm = formatSemana(data.fechaInicio, data.fechaFin);

  // Paso 1: OCR de partes
  setStep(jobId, 1);
  let trabajos = [], confianza = 'alta', semanaOcr = '';
  if (data.partesPaths.length > 0) {
    const ocr = await extraerPartes(data.partesPaths);
    trabajos  = ocr.trabajos;
    confianza = ocr.confianza;
    semanaOcr = ocr.semana;
    lastDebug = { timestamp: new Date().toISOString(), obra: data.obra, semanaForm, ocr };
    if (process.env.NODE_ENV !== 'production') console.log('\n[OCR] Resultado crudo:\n', JSON.stringify(ocr, null, 2));
  }

  // Priorizar la semana que dice el propio parte escrito; si no la menciona
  // explícitamente, derivarla de las fechas reales de los trabajos extraídos;
  // el date-picker es solo el último recurso (puede no coincidir con partes antiguos)
  const semana = semanaOcr || semanaFromTrabajos(trabajos, new Date().getFullYear()) || semanaForm;

  // Paso 2: extracción completada
  setStep(jobId, 2);
  await delay(200);

  // Paso 3: resumen ejecutivo
  setStep(jobId, 3);
  const resumen = await generarResumen(trabajos, data.obra, semana);

  // Paso 4: composición con fotos
  setStep(jobId, 4);
  await delay(300);

  // Paso 5: PDF
  setStep(jobId, 5);
  const pdf = await generarPDF({
    obra: data.obra, semana, encargado: data.encargado,
    estado: data.estado || '', resumen, trabajos, fotos: data.fotosPaths,
  }, 'report');

  jobs.set(jobId, {
    step: 5, done: true, error: null,
    result: {
      obra: data.obra, semana, encargado: data.encargado, tipoDoc: 'report',
      estado: data.estado || '', trabajos, resumen, confianza,
      numPartes: data.partesPaths.length, numFotos: data.fotosPaths.length,
      filename: pdf.filename,
    },
  });

  [...data.partesPaths, ...data.fotosPaths].forEach(p => { try { fs.unlinkSync(p); } catch {} });
}

async function processActa(jobId, data) {
  // Paso 1: OCR de apuntes manuscritos
  setStep(jobId, 1);
  let actaData = await extraerActa(data.partesPaths);
  lastDebug = { timestamp: new Date().toISOString(), tipo: 'acta', obra: data.obra, actaData };
  if (process.env.NODE_ENV !== 'production') console.log('\n[OCR-ACTA]:\n', JSON.stringify(actaData, null, 2));

  // Paso 2: completar campos desde obras.json si el acta no los incluye
  setStep(jobId, 2);
  if (!actaData.ubicacion || !actaData.promotor) {
    try {
      const obrasCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'obras.json'), 'utf8'));
      const rec = (obrasCfg.obras || []).find(o => o.nombre === data.obra);
      if (rec) {
        if (!actaData.ubicacion && rec.direccion) actaData.ubicacion = rec.direccion;
        if (!actaData.promotor  && rec.promotor)  actaData.promotor  = rec.promotor;
      }
    } catch {}
  }
  // Usar la obra del formulario si el acta no la menciona
  if (!actaData.obra_nombre) actaData.obra_nombre = data.obra;

  // Pasos 3-4: composición (fusionados)
  setStep(jobId, 3);
  await delay(300);

  // Paso 4: PDF
  setStep(jobId, 4);
  const pdf = await generarPDF({
    obra:        data.obra,
    actaData,
    fotosObra:   data.fotosPaths,
    fotosPlanos: data.fotosPlanosPaths,
  }, 'acta');

  jobs.set(jobId, {
    step: 4, done: true, error: null,
    result: {
      obra: data.obra, tipoDoc: 'acta',
      actaData,
      numApuntes: data.partesPaths.length,
      numFotos:   data.fotosPaths.length,
      numPlanos:  data.fotosPlanosPaths.length,
      filename:   pdf.filename,
    },
  });

  [...data.partesPaths, ...data.fotosPaths, ...data.fotosPlanosPaths].forEach(p => { try { fs.unlinkSync(p); } catch {} });
}

// GET /api/debug — solo disponible en desarrollo
router.get('/debug', (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' });
  res.json(lastDebug || { mensaje: 'Aún no se ha procesado ningún parte' });
});

// GET /api/download/:filename — sirve el PDF generado
router.get('/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // evitar path traversal
  const filePath = path.join(__dirname, '..', 'output', filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

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
