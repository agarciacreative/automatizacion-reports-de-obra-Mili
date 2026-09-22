const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

const MODEL = 'claude-opus-5';

const SYSTEM_PROMPT = `Eres un redactor técnico especializado en obras de construcción.
A partir de los trabajos semanales que te proporciono, redacta un resumen ejecutivo profesional de 4-5 líneas para enviar al promotor.
Tono: formal, conciso, orientado al avance de obra.
Escribe en tercera persona. Solo un párrafo continuo, sin listas ni subtítulos.
Menciona los hitos más importantes de la semana y el estado general de avance.
Básate únicamente en los trabajos indicados: no añadas trabajos, materiales ni avances que no aparezcan en la lista.`;

async function generarResumen(trabajos, obraName, semana) {
  // Solo cuentan para el resumen los días con descripción legible
  const conTexto = (trabajos || []).filter(t => t.descripcion && t.descripcion.trim());
  if (conTexto.length === 0) {
    return 'No se han podido extraer trabajos de los partes. Comprueba que las imágenes subidas a la sección "Partes de obra" sean fotos claras de los partes escritos (no fotos de la obra).';
  }

  const trabajosTexto = conTexto
    .map(t => {
      const ops = t.operarios && t.operarios.length > 0
        ? t.operarios.map(o => o.nombre || 'Operario').join(', ')
        : 'equipo';
      return `- ${t.fecha || ''}: ${t.descripcion} (${ops})`;
    })
    .join('\n');

  const response = await client.messages.create({
    model: MODEL,
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
        content: `Obra: ${obraName || 'Obra'}\nSemana: ${semana || '—'}\n\nTrabajos realizados:\n${trabajosTexto}\n\nRedacta el resumen ejecutivo:`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('La IA no ha podido redactar el resumen ejecutivo');
  }
  // Con thinking activo el primer bloque puede no ser de texto
  const text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!text) throw new Error('La API no devolvió contenido de texto en el resumen');
  return text;
}

module.exports = { generarResumen };
