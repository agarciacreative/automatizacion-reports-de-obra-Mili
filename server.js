require('dotenv').config();
const express = require('express');
const path = require('path');

const obrasRouter   = require('./routes/obras');
const generateRouter = require('./routes/generate');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Headers de seguridad básicos (sin dependencia externa)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Servir solo los archivos públicos explícitos — nunca el directorio raíz completo
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/output', express.static(path.join(__dirname, 'output')));

app.use('/api/obras', obrasRouter);
app.use('/api', generateRouter);

app.listen(PORT, () => {
  console.log(`Mili Reports corriendo en http://localhost:${PORT}`);
});
