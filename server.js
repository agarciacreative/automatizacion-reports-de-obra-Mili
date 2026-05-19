require('dotenv').config();
const express = require('express');
const path = require('path');

const obrasRouter = require('./routes/obras');
const generateRouter = require('./routes/generate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use('/api/obras', obrasRouter);
app.use('/api', generateRouter);

app.listen(PORT, () => {
  console.log(`Mili Reports corriendo en http://localhost:${PORT}`);
});
