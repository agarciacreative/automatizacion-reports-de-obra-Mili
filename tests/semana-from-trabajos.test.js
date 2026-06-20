// Verifica que la semana del banner se derive de las fechas reales de los
// trabajos extraídos por OCR, en vez de quedarse con el valor por defecto del
// date-picker (que llevó a mostrar "8–14 junio" con partes de "25-29 may").
// Ejecutar: node tests/semana-from-trabajos.test.js
const assert = require('assert');
const { semanaFromTrabajos } = require('../services/ocr');

function run() {
  // Caso real reportado: partes del 25 al 29 de mayo
  const trabajos = [
    { fecha: '25 may' }, { fecha: '26 may' }, { fecha: '27 may' },
    { fecha: '28 may' }, { fecha: '29 may' },
  ];
  assert.strictEqual(semanaFromTrabajos(trabajos, 2026), '25–29 mayo 2026');

  // Mismo mes, orden desordenado en el array de entrada
  const desordenado = [{ fecha: '27 may' }, { fecha: '25 may' }, { fecha: '29 may' }];
  assert.strictEqual(semanaFromTrabajos(desordenado, 2026), '25–29 mayo 2026');

  // Semana que cruza dos meses
  const cruzaMes = [{ fecha: '30 may' }, { fecha: '1 jun' }, { fecha: '2 jun' }];
  assert.strictEqual(semanaFromTrabajos(cruzaMes, 2026), '30 mayo – 2 junio 2026');

  // Sin trabajos o sin fechas válidas -> cadena vacía, para que el caller use su fallback
  assert.strictEqual(semanaFromTrabajos([], 2026), '');
  assert.strictEqual(semanaFromTrabajos([{ fecha: '' }], 2026), '');

  console.log('PASS');
}

run();
