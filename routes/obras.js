const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const OBRAS_FILE = path.join(__dirname, '..', 'obras.json');

router.get('/', (req, res) => {
  const obras = JSON.parse(fs.readFileSync(OBRAS_FILE, 'utf8'));
  res.json(obras);
});

router.post('/', (req, res) => {
  const obras = JSON.parse(fs.readFileSync(OBRAS_FILE, 'utf8'));
  const nueva = { id: req.body.nombre.toLowerCase().replace(/\s+/g, '-'), ...req.body, activa: true, creada: new Date().toISOString().split('T')[0] };
  obras.push(nueva);
  fs.writeFileSync(OBRAS_FILE, JSON.stringify(obras, null, 2));
  res.json(nueva);
});

module.exports = router;
