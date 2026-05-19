const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

const SYSTEM_PROMPT = `Eres un redactor técnico especializado en obras de construcción.
A partir de los trabajos semanales que te proporciono, redacta un resumen ejecutivo profesional de 4-5 líneas para enviar al promotor.
Tono: formal, conciso, orientado al avance de obra.
Escribe en tercera persona. Solo un párrafo continuo, sin listas ni subtítulos.
Menciona los hitos más importantes de la semana y el estado general de avance.`;

async function generarResumen(trabajos, obraName, semana) {
  if (!trabajos || trabajos.length === 0) {
    return 'No se han podido extraer trabajos de los partes proporcionados para esta semana.';
  }

  const trabajosTexto = trabajos
    .map(t => {
      const ops = t.operarios && t.operarios.length > 0
        ? t.operarios.map(o => o.nombre || 'Operario').join(', ')
        : 'equipo';
      return `- ${t.fecha || ''}: ${t.descripcion || 'Trabajos realizados'} (${ops})`;
    })
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
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

  const text = response.content?.[0]?.text;
  if (!text) throw new Error('La API no devolvió contenido de texto en el resumen');
  return text.trim();
}

module.exports = { generarResumen };
