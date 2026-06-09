const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();

const SYSTEM_PROMPT = `Eres un asistente especializado en extraer datos de partes de obra en español. Las imágenes pueden ser de dos tipos:

TIPO A — PARTE ESCRITO A MANO: hoja física con texto manuscrito, tablas o cuadrículas.
TIPO B — CAPTURA DE MENSAJE DE TEXTO: pantalla de WhatsApp, Telegram, SMS u otra app de mensajería.

Devuelve ÚNICAMENTE un JSON válido, sin texto adicional, sin explicaciones, sin bloques de código markdown.

REGLAS COMUNES (aplican a ambos tipos):
- NUNCA inventes datos. Si algo no se lee o no se menciona, usa "" o 0.
- Si el documento contiene varios días, crea UNA entrada por día en el array "trabajos".
- "confianza": "alta" si lees bien el texto, "media" si hay dudas en alguna parte, "baja" si apenas se entiende.

REGLAS TIPO A (parte manuscrito):
- "fecha": exactamente el día y mes escritos, formato "DD MMM" (ej: "12 may", "3 jun"). "" si no hay fecha.
- "descripcion": texto literal de los trabajos de ese día. Cópialo tal cual, sin resumir ni añadir.
- "operarios": personas mencionadas en el parte. El primero siempre es el encargado.

REGLAS TIPO B (captura de mensaje de texto):
- "fecha": extráela del timestamp visible en la captura o del texto del mensaje, en formato "DD MMM". "" si no se ve.
- "descripcion": transcribe el texto del mensaje que describe los trabajos, tal cual aunque sea informal.
- "operarios": si el remitente es identificable (nombre en el chat, firma en el mensaje), úsalo como primer operario con rol "encargado". Si el mensaje menciona a otras personas por nombre, inclúyelas. Si dice "yo" o "nosotros" sin más contexto, deja el array vacío.
- La confianza será como mínimo "media" para capturas de mensajes.

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
  let semanaOcr = '';  // semana extraída del primer parte que la mencione

  for (const ruta of rutasImagenes) {
    const imageBuffer = fs.readFileSync(ruta);
    const base64      = imageBuffer.toString('base64');
    const mediaType   = getMediaType(ruta);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
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
              text: 'Extrae los datos de este documento (parte manuscrito o captura de mensaje). Devuelve solo el JSON, sin nada más.',
            },
          ],
        },
      ],
    });

    const raw = response.content?.[0]?.text;
    if (!raw) { console.error('[OCR] Respuesta vacía de la API'); confianzaGlobal = 'baja'; continue; }
    if (process.env.NODE_ENV !== 'production') console.log('[OCR raw response]:', raw.slice(0, 300));

    try {
      const jsonStr = cleanJson(raw);
      const data = JSON.parse(jsonStr);

      // Recoger semana del primer parte que la mencione
      if (!semanaOcr && data.semana && data.semana.trim()) {
        semanaOcr = data.semana.trim();
      }

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

  return { trabajos: sorted, confianza: confianzaGlobal, semana: semanaOcr };
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

// ── ACTA OCR ──

const SYSTEM_PROMPT_ACTA = `Eres un transcriptor técnico de actas de obra. Tu única tarea es leer apuntes (manuscritos o capturas de mensajes de texto) y volcarlos en JSON estructurado. NO redactes, NO resumas, NO interpretes — TRANSCRIBE.

Devuelve ÚNICAMENTE un JSON válido, sin texto adicional, sin bloques de código markdown.

EXTRACCIÓN DE CABECERA:
- "fecha" / "fecha_display": fecha del encabezado. Formato fecha: "DD/MM/YYYY". Formato fecha_display: "DD de mes de YYYY" en español.
- "obra_nombre": nombre de la obra exactamente como aparece escrito. Cadena vacía si no consta.
- "ubicacion": dirección completa si aparece. Cadena vacía si no.
- "promotor": nombre del promotor si aparece. Cadena vacía si no.
- "proxima_reunion": fecha de la próxima reunión en formato "DD de mes de YYYY". Cadena vacía si no consta.

ASISTENTES — detecta todos los nombres presentes y asigna roles:
- Milagros / Mili → Gerente
- Domingo → Jefe de Obra
- Bernat / Bernat Parera → Arquitecto
- Cualquier otro nombre → usa el rol mencionado en el apunte, o "Técnico" si no se especifica.

CLASIFICACIÓN DE PUNTOS (PT.1, PT.2, etc.):
- "decision": aquello que SE DECIDE, SE APRUEBA o SE DEFINE en la reunión. Especificaciones técnicas acordadas, soluciones constructivas aprobadas, criterios fijados.
- "pendiente": aquello que FALTA ejecutar, que alguien SE COMPROMETE A ENTREGAR, que queda PENDIENTE de confirmar o tiene una fecha límite.
- IMPORTANTE: un mismo PT. puede generar DOS entradas con el mismo número pero distinto tipo ("decision" + "pendiente"). Úsalo cuando el punto incluye tanto una decisión como un compromiso.

REGLAS ESTRICTAS PARA CADA PUNTO — LEE CON ATENCIÓN:
1. "titulo": 4-7 palabras. Describe el tema del punto, no lo que se decide.
2. "descripcion": En la mayoría de los puntos debe ser cadena vacía "". Úsala SOLO para contexto que no es ni una medida, ni un material, ni una acción, ni una especificación técnica — es decir, solo para información de fondo que no encaja en ningún bullet. NUNCA repitas en descripcion información que ya aparece en los bullets. Si tienes dudas, deja la descripcion vacía.
3. "bullets": AQUÍ VA EL DETALLE REAL. Reglas:
   - Crea UN bullet por cada dato, medida, material, acción o especificación mencionada.
   - NUNCA juntes dos informaciones en un mismo bullet.
   - Para medidas: "Concepto: valor con unidades" → ejemplo: "Luz libre zona piscina: 7,85 m"
   - Para materiales: "Material: especificación completa" → ejemplo: "Piedra de revestimiento: caliza gris 3 cm espesor"
   - Para acciones: verbo en infinitivo + detalle completo → ejemplo: "Revisar encuentro muro-forjado en zona norte"
   - Si hay una lista de ítems en el apunte, cada ítem es un bullet separado.
   - NUNCA omitas una medida numérica, cantidad o referencia técnica. Si está escrita, va en un bullet.
   - Prefiere 8 bullets cortos sobre 2 bullets largos.
4. "responsable": nombre completo de quien ejecuta o entrega. Cadena vacía si no se menciona.
5. "fecha_limite": "DD/MM/YYYY". Cadena vacía si no hay fecha explícita.

PRINCIPIO FUNDAMENTAL: si dudas entre incluir un detalle o no, INCLÚYELO SIEMPRE. La información que falta no se puede recuperar; la información de sobra se puede ignorar.

FORMATO JSON — devuelve exactamente esto, sin nada más:
{
  "fecha": "DD/MM/YYYY",
  "fecha_display": "DD de mes de YYYY",
  "obra_nombre": "",
  "ubicacion": "",
  "promotor": "",
  "proxima_reunion": "",
  "asistentes": [
    { "nombre": "Nombre Apellido", "rol": "Cargo" }
  ],
  "puntos": [
    {
      "numero": 1,
      "tipo": "decision",
      "titulo": "Título del punto",
      "descripcion": "Contexto breve si aplica, o cadena vacía.",
      "bullets": ["Dato específico 1", "Medida exacta: valor con unidades", "Acción concreta a realizar"],
      "responsable": "",
      "fecha_limite": ""
    }
  ]
}`;

async function extraerActa(rutasImagenes) {
  if (!rutasImagenes || rutasImagenes.length === 0) {
    return {
      fecha: '', fecha_display: '',
      obra_nombre: '', ubicacion: '', promotor: '', proxima_reunion: '',
      asistentes: [], puntos: [],
    };
  }

  // Construir content con todas las imágenes de apuntes
  const imageContent = rutasImagenes.map(ruta => {
    const base64    = fs.readFileSync(ruta).toString('base64');
    const mediaType = getMediaType(ruta);
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
  });

  imageContent.push({
    type: 'text',
    text: 'Transcribe todos los datos de estos apuntes de visita de obra al JSON indicado. Sé exhaustivo: cada medida, material, acción y detalle debe aparecer como bullet separado. No resumas, no parafrasees, no omitas información. Devuelve solo el JSON, sin nada más.',
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: [{ type: 'text', text: SYSTEM_PROMPT_ACTA, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: imageContent }],
  });

  const raw = response.content?.[0]?.text;
  if (!raw) throw new Error('La API no devolvió contenido al leer el acta');

  if (process.env.NODE_ENV !== 'production') {
    console.log('[OCR-ACTA raw completo]:\n', raw);
  }

  // Primer intento: parsear directamente
  try {
    const jsonStr = cleanJson(raw);
    return JSON.parse(jsonStr);
  } catch (parseErr) {
    console.error('[OCR-ACTA] Fallo en primer parse:', parseErr.message);
    console.error('[OCR-ACTA] Raw que falló:\n', raw);
  }

  // Segundo intento: pedirle a Claude que devuelva solo el JSON limpio
  console.log('[OCR-ACTA] Reintentando con corrección de JSON…');
  const retry = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `El siguiente texto debería ser un JSON válido pero tiene errores de formato. Devuélveme ÚNICAMENTE el JSON corregido y válido, sin ningún texto adicional, sin bloques de código markdown:\n\n${raw}`,
    }],
  });

  const raw2 = retry.content?.[0]?.text;
  if (!raw2) throw new Error('La API no pudo corregir el JSON del acta');

  try {
    return JSON.parse(cleanJson(raw2));
  } catch (err2) {
    console.error('[OCR-ACTA] Fallo también en reintento:', err2.message, '\nRaw2:', raw2);
    throw new Error(`No se pudo interpretar la respuesta de la IA. Raw: ${raw.slice(0, 200)}`);
  }
}

module.exports = { extraerPartes, extraerActa };
