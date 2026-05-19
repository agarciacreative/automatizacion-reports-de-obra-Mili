const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();

const SYSTEM_PROMPT = `Eres un asistente especializado en leer partes de obra escritos a mano en español.

Tu tarea es extraer los datos de la imagen y devolver ÚNICAMENTE un JSON válido, sin texto adicional, sin explicaciones, sin bloques de código markdown.

REGLAS ESTRICTAS:
- NUNCA inventes datos. Si algo no se lee, usa cadena vacía "" o 0.
- El campo "fecha" debe ser EXACTAMENTE el día y mes que aparece escrito, en formato "DD MMM" (ejemplo: "12 may", "3 jun"). Si no hay fecha clara, usa "".
- Si el parte contiene varios días, crea UNA entrada por día.
- El campo "descripcion" es el texto literal de los trabajos de ese día. Cópialo tal cual, sin resumir ni añadir.
- "confianza": "alta" si lees bien el texto, "media" si hay dudas en alguna parte, "baja" si apenas se entiende.
- Los operarios son las personas mencionadas. El primero siempre es el encargado.

FORMATO JSON (devuelve exactamente esto, sin nada más):
{
  "semana": "texto de la semana si aparece, o cadena vacía",
  "obra": "nombre de la obra si aparece, o cadena vacía",
  "trabajos": [
    {
      "fecha": "DD MMM",
      "operarios": [
        {"nombre": "Nombre", "rol": "encargado|oficial|ayudante", "horas": 8}
      ],
      "descripcion": "texto de los trabajos del día",
      "confianza": "alta|media|baja"
    }
  ]
}`;

function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png')  return 'image/png';
  if (ext === '.gif')  return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function cleanJson(text) {
  // Eliminar bloques de código markdown si Claude los añade
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  // A veces Claude añade texto antes del JSON — buscar el primer {
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return s;
}

async function extraerPartes(rutasImagenes) {
  const trabajosTodos = [];
  let confianzaGlobal = 'alta';

  for (const ruta of rutasImagenes) {
    const imageBuffer = fs.readFileSync(ruta);
    const base64      = imageBuffer.toString('base64');
    const mediaType   = getMediaType(ruta);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
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
              text: 'Extrae los datos de este parte de obra. Devuelve solo el JSON, sin nada más.',
            },
          ],
        },
      ],
    });

    const raw = response.content[0].text;
    console.log('[OCR raw response]:', raw.slice(0, 300));

    try {
      const jsonStr = cleanJson(raw);
      const data = JSON.parse(jsonStr);

      if (data.trabajos && Array.isArray(data.trabajos)) {
        // Filtrar trabajos sin descripción (Claude a veces devuelve entradas vacías)
        const validos = data.trabajos.filter(t => t.descripcion && t.descripcion.trim().length > 3);
        trabajosTodos.push(...validos);

        const confianzas = validos.map(t => t.confianza).filter(Boolean);
        if (confianzas.includes('baja'))                      confianzaGlobal = 'baja';
        else if (confianzas.includes('media') && confianzaGlobal !== 'baja') confianzaGlobal = 'media';
      }
    } catch (e) {
      console.error('[OCR] Error parseando JSON:', e.message, '\nRaw:', raw.slice(0, 500));
      confianzaGlobal = 'baja';
    }
  }

  // Ordenar trabajos por fecha cronológicamente
  const sorted = sortTrabajoPorFecha(trabajosTodos);

  return { trabajos: sorted, confianza: confianzaGlobal };
}

const MES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, oct:10, nov:11, dic:12 };

function parseFecha(str) {
  if (!str) return 999;
  const parts = str.trim().toLowerCase().split(/\s+/);
  const dia = parseInt(parts[0], 10) || 0;
  const mes = MES[parts[1]?.slice(0, 3)] || 0;
  return mes * 100 + dia;
}

function sortTrabajoPorFecha(trabajos) {
  return [...trabajos].sort((a, b) => parseFecha(a.fecha) - parseFecha(b.fecha));
}

module.exports = { extraerPartes };
