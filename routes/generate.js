const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

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

// POST /api/generate
router.post('/generate', upload.fields([{ name: 'partes' }, { name: 'fotos' }]), async (req, res) => {
  try {
    const { obra, fechaInicio, fechaFin, encargado, tipoDoc, estado } = req.body;
    const partes = (req.files?.partes || []).map(f => f.path);
    const fotos  = (req.files?.fotos  || []).map(f => f.path);

    // TODO Fase 3: OCR con Claude Vision
    // TODO Fase 3: generación de resumen ejecutivo
    // TODO Fase 4: generación de PDF con Playwright

    res.json({ ok: true, mensaje: 'Recibido — pipeline en construcción', partes: partes.length, fotos: fotos.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
