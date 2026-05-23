const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const OBRAS_FILE = path.join(__dirname, '..', 'obras.json');

function readObras() {
  try {
    const data = JSON.parse(fs.readFileSync(OBRAS_FILE, 'utf8'));
    return Array.isArray(data) ? data : (data.obras || []);
  } catch {
    return [];
  }
}

function writeObras(list) {
  const tmp = OBRAS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ obras: list }, null, 2));
  fs.renameSync(tmp, OBRAS_FILE);
}

router.get('/', (req, res) => {
  try {
    res.json({ obras: readObras() });
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo obras' });
  }
});

router.post('/', (req, res) => {
  const nombre = req.body && typeof req.body.nombre === 'string' ? req.body.nombre.trim() : '';
  if (!nombre) return res.status(400).json({ error: 'El campo nombre es obligatorio' });

  try {
    const obras = readObras();
    const nueva = {
      id: nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      ...req.body,
      nombre,
      activa: true,
      creada: new Date().toISOString().split('T')[0],
    };
    obras.push(nueva);
    writeObras(obras);
    res.json(nueva);
  } catch (err) {
    console.error('[obras] Error guardando obra:', err.message);
    res.status(500).json({ error: 'Error guardando obra' });
  }
});

module.exports = router;
