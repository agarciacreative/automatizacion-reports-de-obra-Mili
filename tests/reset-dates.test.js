// Verifica que resetApp() recalcula fecha-inicio/fecha-fin a la semana actual
// en vez de arrastrar las fechas del report anterior.
// Ejecutar: node tests/reset-dates.test.js
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const filePath = path.join(__dirname, '..', 'index.html');
  await page.goto(`file://${filePath}`);

  const expected = await page.evaluate(() => {
    const today = new Date();
    const lastSun = new Date(today);
    lastSun.setDate(today.getDate() - today.getDay());
    const lastMon = new Date(lastSun);
    lastMon.setDate(lastSun.getDate() - 6);
    return {
      inicio: lastMon.toISOString().split('T')[0],
      fin: lastSun.toISOString().split('T')[0],
    };
  });

  // Simular que quedaron cargadas las fechas de un report viejo (semana de hace un mes)
  await page.evaluate(() => {
    document.getElementById('fecha-inicio').value = '2024-01-01';
    document.getElementById('fecha-fin').value = '2024-01-07';
  });

  // Disparar el reset que ocurre al volver a pantalla 1 tras generar un report
  await page.evaluate(() => resetApp());

  const actual = await page.evaluate(() => ({
    inicio: document.getElementById('fecha-inicio').value,
    fin: document.getElementById('fecha-fin').value,
  }));

  await browser.close();

  const ok = actual.inicio === expected.inicio && actual.fin === expected.fin;
  console.log('esperado:', expected);
  console.log('obtenido:', actual);
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}

main();
