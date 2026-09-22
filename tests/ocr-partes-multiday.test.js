// Verifica las causas reales de "faltaba información en el report":
// 1) un día con descripción muy breve (ej. "Festivo") no se descarta.
// 2) si una respuesta llega sin JSON válido (cortada, vacía…), se repite la lectura
//    completa y se recuperan los datos en vez de perderlos.
// 3) un día con fecha pero descripción ilegible se conserva y genera un aviso.
// 4) los avisos de la IA llegan al resultado y bajan la confianza a "media".
// 5) con varios partes se conserva el orden y se prefijan los avisos.
// 6) el texto se toma del bloque "text" aunque haya un bloque "thinking" delante.
// 7) una negativa de la IA (stop_reason "refusal") lanza un error claro.
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
let lastParams = null;

class FakeAnthropic {
  constructor() {}
  get messages() {
    return {
      create: async (params) => {
        lastParams = params;
        return scriptedResponses[callIndex++];
      },
    };
  }
}

require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: FakeAnthropic };

const { extraerPartes } = require('../services/ocr');

const json = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn', usage: { output_tokens: 10 } });

async function main() {
  const tmpImg = path.join(os.tmpdir(), 'fake-parte.jpg');
  fs.writeFileSync(tmpImg, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const tmpImg2 = path.join(os.tmpdir(), 'fake-parte-2.jpg');
  fs.writeFileSync(tmpImg2, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  // Caso 1: día con descripción breve no debe descartarse
  scriptedResponses = [json({
    semana: '', obra: '', avisos: [],
    trabajos: [
      { fecha: '10 jun', operarios: [{ nombre: 'Domingo', rol: 'encargado', horas: 8 }], descripcion: 'Hormigonado de losa planta baja', confianza: 'alta' },
      { fecha: '11 jun', operarios: [{ nombre: 'Domingo', rol: 'encargado', horas: 8 }], descripcion: 'Festivo', confianza: 'alta' },
    ],
  })];
  callIndex = 0;
  const r1 = await extraerPartes([tmpImg]);
  assert.strictEqual(r1.trabajos.length, 2, 'debe conservar el día breve "Festivo"');
  assert.strictEqual(r1.confianza, 'alta');
  assert.deepStrictEqual(r1.avisos, []);
  // La petición pide salida estructurada con schema y modelo capaz
  assert.strictEqual(lastParams.output_config.format.type, 'json_schema');
  assert.strictEqual(lastParams.model, 'claude-opus-5');
  assert.ok(lastParams.max_tokens >= 16000, 'max_tokens holgado para no cortar partes largos');

  // Caso 2: primera respuesta cortada (JSON inválido) -> se repite la lectura completa
  const truncado = '{"semana":"","obra":"","trabajos":[{"fecha":"10 jun","operarios":[],"descripcion":"Excavación zanjas cimentación","confi';
  scriptedResponses = [
    { content: [{ type: 'text', text: truncado }], stop_reason: 'max_tokens' },
    json({ semana: '', obra: '', avisos: [], trabajos: [{ fecha: '10 jun', operarios: [], descripcion: 'Excavación zanjas cimentación', confianza: 'media' }] }),
  ];
  callIndex = 0;
  const r2 = await extraerPartes([tmpImg]);
  assert.strictEqual(r2.trabajos.length, 1, 'debe recuperar el día tras repetir la lectura');
  assert.strictEqual(r2.confianza, 'media');
  assert.strictEqual(callIndex, 2, 'debe haber hecho exactamente dos llamadas');

  // Caso 3: día con fecha pero sin descripción legible -> se conserva con aviso
  scriptedResponses = [json({
    semana: '', obra: '', avisos: [],
    trabajos: [
      { fecha: '12 jun', operarios: [], descripcion: 'Encofrado pilares', confianza: 'alta' },
      { fecha: '13 jun', operarios: [], descripcion: '', confianza: 'baja' },
      { fecha: '', operarios: [], descripcion: '', confianza: 'alta' }, // ruido: se descarta
    ],
  })];
  callIndex = 0;
  const r3 = await extraerPartes([tmpImg]);
  assert.strictEqual(r3.trabajos.length, 2, 'el día ilegible se conserva, la entrada vacía se descarta');
  assert.strictEqual(r3.trabajos[1].fecha, '13 jun');
  assert.strictEqual(r3.confianza, 'baja');
  assert.ok(r3.avisos.some(a => a.includes('13 jun')), 'debe avisar del día sin descripción');

  // Caso 4: avisos de la IA llegan al resultado y bajan la confianza
  scriptedResponses = [json({
    semana: 'del 15 al 19 de junio', obra: '', avisos: ['Nombre del segundo operario del martes ilegible'],
    trabajos: [{ fecha: '15 jun', operarios: [{ nombre: 'Domingo', rol: 'encargado', horas: 8 }], descripcion: 'Solera', confianza: 'alta' }],
  })];
  callIndex = 0;
  const r4 = await extraerPartes([tmpImg]);
  assert.deepStrictEqual(r4.avisos, ['Nombre del segundo operario del martes ilegible']);
  assert.strictEqual(r4.confianza, 'media', 'con avisos la confianza no puede ser alta');
  assert.strictEqual(r4.semana, 'del 15 al 19 de junio');

  // Caso 5: varios partes -> orden cronológico y avisos prefijados con el número de parte
  scriptedResponses = [
    json({ semana: '', obra: '', avisos: ['Fecha borrosa'], trabajos: [{ fecha: '18 jun', operarios: [], descripcion: 'Cubierta', confianza: 'alta' }] }),
    json({ semana: '', obra: '', avisos: [], trabajos: [{ fecha: '16 jun', operarios: [], descripcion: 'Muros', confianza: 'alta' }] }),
  ];
  callIndex = 0;
  const r5 = await extraerPartes([tmpImg, tmpImg2]);
  assert.deepStrictEqual(r5.trabajos.map(t => t.fecha), ['16 jun', '18 jun']);
  assert.deepStrictEqual(r5.avisos, ['Parte 1: Fecha borrosa']);

  // Caso 6: bloque thinking antes del texto
  scriptedResponses = [{
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: JSON.stringify({ semana: '', obra: '', avisos: [], trabajos: [{ fecha: '20 jun', operarios: [], descripcion: 'Limpieza', confianza: 'alta' }] }) },
    ],
    stop_reason: 'end_turn',
  }];
  callIndex = 0;
  const r6 = await extraerPartes([tmpImg]);
  assert.strictEqual(r6.trabajos.length, 1, 'debe leer el bloque de texto aunque haya thinking delante');

  // Caso 7: negativa de la IA -> error claro, nunca un report vacío en silencio
  scriptedResponses = [{ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null } }];
  callIndex = 0;
  await assert.rejects(() => extraerPartes([tmpImg]), /negado/);

  fs.unlinkSync(tmpImg);
  fs.unlinkSync(tmpImg2);
  console.log('PASS');
}

main().catch(err => { console.error('FAIL', err); process.exit(1); });
