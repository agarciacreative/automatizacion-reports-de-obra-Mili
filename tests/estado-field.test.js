// Verifica que el campo "Estado actual de la obra" (pantalla 1) se incluye
// en el FormData enviado a /api/generate, para que llegue al PDF final.
// Ejecutar: node tests/estado-field.test.js
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const filePath = path.join(__dirname, '..', 'index.html');
  await page.goto(`file://${filePath}`);

  // El campo debe vivir en pantalla 1, no en pantalla 3
  const inScreen1 = await page.evaluate(() =>
    !!document.querySelector('#screen-1 #estado-input')
  );
  const inScreen3 = await page.evaluate(() =>
    !!document.querySelector('#screen-3 #estado-input')
  );

  // Interceptar fetch para capturar el FormData sin necesitar un servidor real
  const capturedEstado = await page.evaluate(async () => {
    document.getElementById('estado-input').value = 'Cimentación terminada, iniciando estructura';

    let captured = null;
    window.fetch = async (url, opts) => {
      if (url === '/api/generate') captured = opts.body.get('estado');
      // Cortar la ejecución antes de tocar EventSource/red real
      throw new Error('stop-after-capture');
    };

    try { await runProcessing(); } catch {}
    return captured;
  });

  await browser.close();

  const expected = 'Cimentación terminada, iniciando estructura';
  const ok = inScreen1 && !inScreen3 && capturedEstado === expected;
  console.log('en pantalla 1:', inScreen1, '| en pantalla 3:', inScreen3);
  console.log('estado capturado:', capturedEstado);
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}

main();
