// Verifica que el bot de Telegram acepta imagenes enviadas "como archivo"
// (msg.document), no solo como msg.photo comprimido. Antes del fix, una foto
// de un parte enviada sin comprimir se ignoraba en silencio.
// Ejecutar: node tests/telegram-document.test.js
const assert = require('assert');
const { isImageDocument, extFromMime } = require('../services/telegram');

function run() {
  assert.strictEqual(isImageDocument({ mime_type: 'image/jpeg' }), true, 'jpeg debe detectarse como imagen');
  assert.strictEqual(isImageDocument({ mime_type: 'image/png' }), true, 'png debe detectarse como imagen');
  assert.strictEqual(isImageDocument({ mime_type: 'application/pdf' }), false, 'pdf no es imagen');
  assert.strictEqual(isImageDocument(undefined), false, 'sin documento no es imagen');

  assert.strictEqual(extFromMime('image/png'), 'png');
  assert.strictEqual(extFromMime('image/gif'), 'gif');
  assert.strictEqual(extFromMime('image/webp'), 'webp');
  assert.strictEqual(extFromMime('image/jpeg'), 'jpg');

  console.log('PASS');
}

run();
