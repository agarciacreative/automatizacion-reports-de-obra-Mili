// Verifica dos causas reales de "no lee todos los días del parte":
// 1) un día con descripción muy breve (ej. "Festivo") ya no se descarta.
// 2) si la respuesta de Claude llega cortada (JSON incompleto por max_tokens),
//    el reintento de corrección recupera los datos en vez de perderlos.
// La API de Anthropic se mockea por completo: no hace falta ANTHROPIC_API_KEY
// ni gastar tokens reales.
// Ejecutar: node tests/ocr-partes-multiday.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sdkPath = require.resolve('@anthropic-ai/sdk');
let scriptedResponses = [];
let callIndex = 0;

class FakeAnthropic {
  constructor() {}
  get messages() {
    return { create: async () => scriptedResponses[callIndex++] };
  }
}

require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: FakeAnthropic };

const { extraerPartes } = require('../services/ocr');

async function main() {
  const tmpImg = path.join(os.tmpdir(), 'fake-parte.jpg');
  fs.writeFileSync(tmpImg, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  // Caso 1: día con descripción breve no debe descartarse
  scriptedResponses = [{
    content: [{ text: JSON.stringify({
      semana: '', obra: '',
      trabajos: [
        { fecha: '10 jun', operarios: [{ nombre: 'Domingo', rol: 'encargado', horas: 8 }], descripcion: 'Hormigonado de losa planta baja', confianza: 'alta' },
        { fecha: '11 jun', operarios: [{ nombre: 'Domingo', rol: 'encargado', horas: 8 }], descripcion: 'Festivo', confianza: 'alta' },
      ],
    }) }],
  }];
  callIndex = 0;
  const r1 = await extraerPartes([tmpImg]);
  assert.strictEqual(r1.trabajos.length, 2, 'debe conservar el día breve "Festivo"');

  // Caso 2: primera respuesta llega cortada (simula truncado por max_tokens) -> reintento la recupera
  const truncado = '{"semana":"","obra":"","trabajos":[{"fecha":"10 jun","operarios":[],"descripcion":"Excavación zanjas cimentación","confi';
  const corregido = JSON.stringify({
    semana: '', obra: '',
    trabajos: [{ fecha: '10 jun', operarios: [], descripcion: 'Excavación zanjas cimentación', confianza: 'media' }],
  });
  scriptedResponses = [
    { content: [{ text: truncado }] },
    { content: [{ text: corregido }] },
  ];
  callIndex = 0;
  const r2 = await extraerPartes([tmpImg]);
  assert.strictEqual(r2.trabajos.length, 1, 'debe recuperar el día tras reintento de JSON cortado');
  assert.strictEqual(r2.confianza, 'media');

  fs.unlinkSync(tmpImg);
  console.log('PASS');
}

main();
