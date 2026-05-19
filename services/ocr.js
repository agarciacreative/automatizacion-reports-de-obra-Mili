const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();

const SYSTEM_PROMPT = `Eres un asistente especializado en obras de construcción en Mallorca.
Analiza este parte de obra escrito a mano y devuelve SOLO un JSON válido, sin texto adicional, con esta estructura exacta:
{
  "semana": "del X al X de mes año",
  "obra": "nombre de la obra o cadena vacía si no se lee",
  "trabajos": [
    {
      "fecha": "DD/MM",
      "operarios": [{"nombre": "string", "rol": "string", "horas": 0}],
      "descripcion": "descripción de los trabajos del día",
      "confianza": "alta|media|baja"
    }
  ]
}
Reglas:
- Si un campo no se lee claramente, usa cadena vacía o 0
- confianza: "alta" si se lee bien, "media" si hay dudas, "baja" si no se entiende
- Si hay varios días en el mismo parte, crea una entrada por día
- operarios: el primero es siempre el encargado`;

function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function extraerPartes(rutasImagenes) {
  const trabajosTodos = [];
  let confianzaGlobal = 'alta';

  for (const ruta of rutasImagenes) {
    const imageBuffer = fs.readFileSync(ruta);
    const base64 = imageBuffer.toString('base64');
    const mediaType = getMediaType(ruta);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: 'Extrae los datos de este parte de obra en formato JSON.',
            },
          ],
        },
      ],
    });

    try {
      const text = response.content[0].text.trim();
      const jsonStr = text.startsWith('```') ? text.replace(/```json?\n?/g, '').replace(/```/g, '').trim() : text;
      const data = JSON.parse(jsonStr);

      if (data.trabajos && Array.isArray(data.trabajos)) {
        trabajosTodos.push(...data.trabajos);
        const confianzas = data.trabajos.map(t => t.confianza).filter(Boolean);
        if (confianzas.includes('baja')) confianzaGlobal = 'baja';
        else if (confianzas.includes('media') && confianzaGlobal !== 'baja') confianzaGlobal = 'media';
      }
    } catch {
      confianzaGlobal = 'baja';
    }
  }

  return { trabajos: trabajosTodos, confianza: confianzaGlobal };
}

module.exports = { extraerPartes };
