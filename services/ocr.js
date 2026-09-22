const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();

// Modelo más capaz para lectura de manuscritos. Razona (adaptive thinking, activo
// por defecto) antes de transcribir, lo que reduce mucho los días u operarios omitidos.
const MODEL = 'claude-opus-5';

// Margen holgado: un parte de una semana rara vez supera 3-4k tokens de JSON, pero
// con 4096 se cortaban respuestas largas y el reintento descartaba el último día.
const MAX_OCR_TOKENS = 16000;

// La API reduce cualquier imagen con lado mayor > 1568 px; enviarla ya a ese tamaño
// evita superar el límite de 5 MB por imagen sin perder resolución útil.
const MAX_LADO_PX = 1568;

const SYSTEM_PROMPT = `Eres un asistente especializado en extraer datos de partes de obra en español. Las imágenes pueden ser de dos tipos:

TIPO A — PARTE ESCRITO A MANO: hoja física con texto manuscrito, tablas o cuadrículas.
TIPO B — CAPTURA DE MENSAJE DE TEXTO: pantalla de WhatsApp, Telegram, SMS u otra app de mensajería.

Devuelve ÚNICAMENTE el JSON del formato indicado.

REGLAS COMUNES (aplican a ambos tipos):
- NUNCA inventes datos. Si algo no se lee o no se menciona, usa "" o 0.
- Antes de responder, recorre el documento COMPLETO de arriba a abajo (y si es una tabla, todas las filas y columnas) y cuenta cuántos días distintos aparecen. El array "trabajos" debe tener exactamente una entrada por cada uno de esos días.
- Si el documento contiene varios días, crea UNA entrada por día en el array "trabajos".
- INCLUYE TODOS LOS DÍAS que aparezcan escritos en el documento, sin excepción y sin omitir ninguno, aunque la anotación de ese día sea muy breve (ej: "Festivo", "Lluvia, no se trabajó", "Sin actividad"). Un día con poco texto sigue siendo un día — nunca lo descartes por brevedad.
- Si un día tiene fecha pero su descripción no se puede leer, INCLUYE igualmente la entrada con "descripcion": "" y explícalo en "avisos". Nunca elimines un día porque no lo entiendas.
- "confianza": "alta" si lees bien el texto, "media" si hay dudas en alguna parte, "baja" si apenas se entiende.
- "avisos": lista de frases cortas en español con todo lo que NO hayas podido leer con seguridad o que hayas tenido que interpretar (ej: "Miércoles 14: nombre del tercer operario ilegible", "Fecha del último día borrosa, podría ser 18 o 19"). Si has leído todo con claridad, devuelve un array vacío. Sé honesto: es mejor avisar de más que de menos.

REGLAS TIPO A (parte manuscrito):
- "fecha": exactamente el día y mes escritos, formato "DD MMM" (ej: "12 may", "3 jun"). "" si no hay fecha.
- "descripcion": texto literal de los trabajos de ese día. Cópialo tal cual, completo, sin resumir ni añadir. Si el día tiene varias líneas o varios trabajos, inclúyelos todos separados por punto y coma.
- "operarios": personas mencionadas en el parte. El primero siempre es el encargado.

REGLAS TIPO B (captura de mensaje de texto):
- "fecha": extráela del timestamp visible en la captura o del texto del mensaje, en formato "DD MMM". "" si no se ve.
- "descripcion": transcribe el texto del mensaje que describe los trabajos, tal cual aunque sea informal.
- "operarios": si el remitente es identificable (nombre en el chat, firma en el mensaje), úsalo como primer operario con rol "encargado". Si el mensaje menciona a otras personas por nombre, inclúyelas. Si dice "yo" o "nosotros" sin más contexto, deja el array vacío.
- La confianza será como mínimo "media" para capturas de mensajes.

FORMATO JSON:
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
  ],
  "avisos": ["frase corta sobre algo que no se ha podido leer bien"]
}`;

// JSON schema que la API impone a la respuesta (salida estructurada): garantiza JSON
// válido y completo, sin necesidad de limpiar bloques markdown ni reparar texto cortado.
const SCHEMA_PARTES = {
  type: 'object',
  additionalProperties: false,
  required: ['semana', 'obra', 'trabajos', 'avisos'],
  properties: {
    semana: { type: 'string' },
    obra:   { type: 'string' },
    trabajos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fecha', 'operarios', 'descripcion', 'confianza'],
        properties: {
          fecha: { type: 'string' },
          operarios: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['nombre', 'rol', 'horas'],
              properties: {
                nombre: { type: 'string' },
                rol:    { type: 'string' },
                horas:  { type: 'number' },
              },
            },
          },
          descripcion: { type: 'string' },
          confianza:   { type: 'string', enum: ['alta', 'media', 'baja'] },
        },
      },
    },
    avisos: { type: 'array', items: { type: 'string' } },
  },
};

const EXTS_API = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

function getMediaType(filePath) {
  return EXTS_API[path.extname(filePath).toLowerCase()] || 'image/jpeg';
}

// Normaliza la foto antes de enviarla a la API:
//  - aplica la rotación EXIF (los móviles guardan la foto girada + una etiqueta de
//    orientación; sin esto el manuscrito llega tumbado y la lectura empeora)
//  - reduce al tamaño máximo útil para la API (evita el límite de 5 MB)
//  - convierte HEIC/TIFF/BMP a JPEG, formatos que la API no acepta
async function prepararImagen(ruta) {
  try {
    const buffer = await sharp(ruta)
      .rotate()
      .resize({ width: MAX_LADO_PX, height: MAX_LADO_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buffer.toString('base64') } };
  } catch (err) {
    const ext = path.extname(ruta).toLowerCase();
    if (!EXTS_API[ext]) {
      throw new Error(`No se pudo procesar la imagen "${path.basename(ruta)}" (formato ${ext || 'desconocido'}). Envíala en JPG o PNG.`);
    }
    // Formato que la API acepta tal cual: enviar el archivo original sin tocar
    console.warn(`[OCR] sharp no pudo procesar ${path.basename(ruta)} (${err.message}); se envía el original`);
    const buffer = fs.readFileSync(ruta);
    return { type: 'image', source: { type: 'base64', media_type: getMediaType(ruta), data: buffer.toString('base64') } };
  }
}

// Con thinking activo el primer bloque puede ser "thinking": hay que buscar el de texto
function textoDe(response) {
  return (response.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
}

function comprobarParada(response, contexto) {
  if (response.stop_reason === 'refusal') {
    throw new Error(`La IA se ha negado a procesar ${contexto}. Revisa que la imagen sea un parte de obra.`);
  }
  if (response.stop_reason === 'max_tokens') {
    console.warn(`[OCR] Respuesta cortada por max_tokens al leer ${contexto}`);
  }
}

// Llama a la API pidiendo JSON con el schema dado; si el JSON no se puede parsear
// (respuesta cortada, vacía…) repite la lectura completa una vez más en vez de
// intentar "reparar" el texto, que es como se perdían días.
async function pedirJson({ system, content, schema, maxTokens, contexto }) {
  let ultimoError = null;
  for (let intento = 1; intento <= 2; intento++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    });

    comprobarParada(response, contexto);
    const raw = textoDe(response);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[OCR ${contexto}] stop=${response.stop_reason} tokens_out=${response.usage?.output_tokens} raw:`, raw.slice(0, 300));
    }

    try {
      if (!raw) throw new Error('respuesta sin texto');
      return JSON.parse(raw);
    } catch (e) {
      ultimoError = e;
      console.error(`[OCR] Intento ${intento} al leer ${contexto} no devolvió JSON válido:`, e.message);
    }
  }
  throw new Error(`No se pudo leer ${contexto} (${ultimoError?.message || 'respuesta inválida'}). Prueba con una foto más nítida.`);
}

async function extraerParte(ruta, indice, total) {
  const contexto = total > 1 ? `el parte ${indice + 1} de ${total}` : 'el parte';
  const imagen = await prepararImagen(ruta);
  const data = await pedirJson({
    system: SYSTEM_PROMPT,
    schema: SCHEMA_PARTES,
    maxTokens: MAX_OCR_TOKENS,
    contexto,
    content: [
      imagen,
      {
        type: 'text',
        text: 'Extrae los datos de este documento (parte manuscrito o captura de mensaje). Incluye TODOS los días que aparezcan, incluso los más breves, y anota en "avisos" cualquier cosa que no hayas podido leer bien. Devuelve solo el JSON.',
      },
    ],
  });

  const avisos = Array.isArray(data.avisos) ? data.avisos.filter(a => typeof a === 'string' && a.trim()) : [];
  const trabajos = [];
  for (const t of (Array.isArray(data.trabajos) ? data.trabajos : [])) {
    const fecha = (t.fecha || '').trim();
    const descripcion = (t.descripcion || '').trim();
    // Entrada totalmente vacía: ruido del modelo, se descarta
    if (!fecha && !descripcion) continue;
    // Día con fecha pero sin texto legible: se conserva y se avisa, nunca se pierde
    if (fecha && !descripcion) avisos.push(`Día ${fecha}: no se ha podido leer la descripción de los trabajos`);
    trabajos.push({
      fecha,
      descripcion,
      operarios: Array.isArray(t.operarios) ? t.operarios : [],
      confianza: t.confianza || 'media',
    });
  }

  const prefijo = total > 1 ? `Parte ${indice + 1}: ` : '';
  return {
    semana: (data.semana || '').trim(),
    trabajos,
    avisos: avisos.map(a => prefijo + a),
  };
}

async function extraerPartes(rutasImagenes) {
  // Cada foto se lee en paralelo (una foto ilegible no bloquea a las demás y Mili
  // espera menos); el orden de salida se conserva
  const resultados = await Promise.all(
    rutasImagenes.map((ruta, i) => extraerParte(ruta, i, rutasImagenes.length))
  );

  const trabajosTodos = [];
  const avisos = [];
  let semanaOcr = '';
  let confianzaGlobal = 'alta';

  for (const r of resultados) {
    if (!semanaOcr && r.semana) semanaOcr = r.semana;
    trabajosTodos.push(...r.trabajos);
    avisos.push(...r.avisos);
    const confianzas = r.trabajos.map(t => t.confianza);
    if (confianzas.includes('baja')) confianzaGlobal = 'baja';
    else if (confianzas.includes('media') && confianzaGlobal !== 'baja') confianzaGlobal = 'media';
  }

  if (trabajosTodos.length === 0 && rutasImagenes.length > 0) {
    confianzaGlobal = 'baja';
    avisos.push('No se ha encontrado ningún día de trabajo en los partes enviados. Comprueba que las fotos sean de los partes escritos y se lean bien.');
  } else if (avisos.length > 0 && confianzaGlobal === 'alta') {
    // Hay cosas que no se han leído bien: que el aviso sea visible en el badge
    confianzaGlobal = 'media';
  }

  return { trabajos: sortTrabajoPorFecha(trabajosTodos), confianza: confianzaGlobal, semana: semanaOcr, avisos };
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

const MESES_FULL = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function parseFechaCorta(str) {
  if (!str) return null;
  const parts = str.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;
  const dia = parseInt(parts[0], 10);
  const mes = MES[parts[1].slice(0, 3)];
  if (!dia || !mes) return null;
  return { dia, mes };
}

// Los partes manuscritos rara vez dicen explícitamente "semana del X al Y",
// pero cada trabajo trae su propia fecha — derivamos el rango real a partir
// de esas fechas en vez de depender de un valor calculado o elegido a mano.
function semanaFromTrabajos(trabajos, year) {
  const fechas = (trabajos || [])
    .map(t => parseFechaCorta(t.fecha))
    .filter(Boolean)
    .sort((a, b) => (a.mes * 100 + a.dia) - (b.mes * 100 + b.dia));

  if (fechas.length === 0) return '';

  const first = fechas[0];
  const last  = fechas[fechas.length - 1];
  if (first.mes === last.mes) {
    return `${first.dia}–${last.dia} ${MESES_FULL[last.mes - 1]} ${year}`;
  }
  return `${first.dia} ${MESES_FULL[first.mes - 1]} – ${last.dia} ${MESES_FULL[last.mes - 1]} ${year}`;
}

// ── ACTA OCR ──

const SYSTEM_PROMPT_ACTA = `Eres un transcriptor técnico de actas de obra. Tu única tarea es leer apuntes (manuscritos o capturas de mensajes de texto) y volcarlos en JSON estructurado. NO redactes, NO resumas, NO interpretes — TRANSCRIBE.

Devuelve ÚNICAMENTE el JSON del formato indicado.

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

FORMATO JSON:
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

const SCHEMA_ACTA = {
  type: 'object',
  additionalProperties: false,
  required: ['fecha', 'fecha_display', 'obra_nombre', 'ubicacion', 'promotor', 'proxima_reunion', 'asistentes', 'puntos'],
  properties: {
    fecha:           { type: 'string' },
    fecha_display:   { type: 'string' },
    obra_nombre:     { type: 'string' },
    ubicacion:       { type: 'string' },
    promotor:        { type: 'string' },
    proxima_reunion: { type: 'string' },
    asistentes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nombre', 'rol'],
        properties: { nombre: { type: 'string' }, rol: { type: 'string' } },
      },
    },
    puntos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['numero', 'tipo', 'titulo', 'descripcion', 'bullets', 'responsable', 'fecha_limite'],
        properties: {
          numero:       { type: 'integer' },
          tipo:         { type: 'string', enum: ['decision', 'pendiente'] },
          titulo:       { type: 'string' },
          descripcion:  { type: 'string' },
          bullets:      { type: 'array', items: { type: 'string' } },
          responsable:  { type: 'string' },
          fecha_limite: { type: 'string' },
        },
      },
    },
  },
};

async function extraerActa(rutasImagenes) {
  if (!rutasImagenes || rutasImagenes.length === 0) {
    return {
      fecha: '', fecha_display: '',
      obra_nombre: '', ubicacion: '', promotor: '', proxima_reunion: '',
      asistentes: [], puntos: [],
    };
  }

  // Todas las imágenes de apuntes en una sola petición (comparten contexto)
  const imageContent = await Promise.all(rutasImagenes.map(prepararImagen));
  imageContent.push({
    type: 'text',
    text: 'Transcribe todos los datos de estos apuntes de visita de obra al JSON indicado. Sé exhaustivo: cada medida, material, acción y detalle debe aparecer como bullet separado. No resumas, no parafrasees, no omitas información. Devuelve solo el JSON.',
  });

  const data = await pedirJson({
    system: SYSTEM_PROMPT_ACTA,
    schema: SCHEMA_ACTA,
    maxTokens: MAX_OCR_TOKENS,
    contexto: 'los apuntes del acta',
    content: imageContent,
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log('[OCR-ACTA]:\n', JSON.stringify(data, null, 2));
  }
  return data;
}

module.exports = { extraerPartes, extraerActa, semanaFromTrabajos };
