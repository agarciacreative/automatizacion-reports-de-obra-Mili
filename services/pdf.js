const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

async function generarPDF(datos, tipoDoc = 'report') {
  const templateFile = tipoDoc === 'acta'
    ? 'template_acta_tecnica.html'
    : 'template_report_semanal.html';
  const templatePath = path.join(__dirname, '..', 'templates', templateFile);
  let html = fs.readFileSync(templatePath, 'utf8');

  const today = new Date();
  const fechaReport    = today.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  const fechaGeneracion = today.toLocaleDateString('es-ES');
  const numSemana = getWeekNumber(today);

  if (tipoDoc === 'report') {
    html = buildReport(html, datos, fechaReport, fechaGeneracion, numSemana);
  } else {
    html = buildActa(html, datos, fechaReport, fechaGeneracion);
  }

  const outputDir = path.join(__dirname, '..', 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const slug = slugify(datos.obra || 'obra');
  const fecha = today.toISOString().split('T')[0].replace(/-/g, '');
  const filename = tipoDoc === 'acta'
    ? `acta_reunion_tecnica_${slug}_${fecha}.pdf`
    : `report_${slug}_${fecha}.pdf`;
  const outputPath = path.join(outputDir, filename);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await browser.close();
  }

  return { filename, path: outputPath };
}

function buildReport(html, datos, fechaReport, fechaGeneracion, numSemana) {
  // Filas de la tabla de trabajos
  const filas = (datos.trabajos || []).map((t, i) => {
    const ops = t.operarios || [];
    const encargado = ops[0]?.nombre || datos.encargado || 'Domingo';
    const otrosOps = ops.slice(1)
      .map(o => `<span class="op-badge">${escHtml(o.nombre || '')}</span>`)
      .join('');
    const numOp = ops.length || 1;
    const horas = ops.reduce((s, o) => s + (Number(o.horas) || 0), 0);
    const horasStr = horas > 0 ? ` · ${horas}h` : '';
    return `<tr>
      <td class="td-num">${i + 1}</td>
      <td class="td-fecha">${escHtml(t.fecha || '—')}</td>
      <td class="td-descripcion">${escHtml(t.descripcion || '—')}</td>
      <td class="td-operarios">
        <span class="op-badge enc">${escHtml(encargado)}</span>${otrosOps}
        <span class="op-sub">${numOp} op.${horasStr}</span>
      </td>
    </tr>`;
  }).join('');

  // Grid de fotos (base64 embebido)
  const fotosHtml = (datos.fotos || [])
    .filter(p => fs.existsSync(p))
    .map(p => {
      const ext  = path.extname(p).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const b64  = fs.readFileSync(p).toString('base64');
      return `<div class="foto-item"><img src="data:${mime};base64,${b64}" alt="Obra"></div>`;
    }).join('');

  // Reemplazar tbody completo con filas reales
  html = html.replace(/<tbody>[\s\S]*?<\/tbody>/, `<tbody>${filas}</tbody>`);

  return html
    .replace(/{{OBRA_NOMBRE}}/g,      escHtml(datos.obra    || '—'))
    .replace(/{{FECHA_REPORT}}/g,     fechaReport)
    .replace(/{{SEMANA_RANGO}}/g,     escHtml(datos.semana  || '—'))
    .replace(/{{ENCARGADO}}/g,        escHtml(datos.encargado || 'Domingo'))
    .replace(/{{ESTADO_TEXTO}}/g,     escHtml(datos.estado  || 'Obra en ejecución.'))
    .replace(/{{RESUMEN_EJECUTIVO}}/g,datos.resumen || '—')
    .replace(/{{FOTOS_GRID}}/g,       fotosHtml)
    .replace(/{{FECHA_GENERACION}}/g, fechaGeneracion)
    .replace(/{{NUM_SEMANA}}/g,       String(numSemana));
}

function buildActa(html, datos, fechaReport, fechaGeneracion) {
  const asistentes = [
    { nombre: 'Mili',         rol: 'Gerente',      principal: true  },
    { nombre: 'Domingo',      rol: 'Jefe de obra',  principal: true  },
    { nombre: 'Bernat Parera',rol: 'Arquitecto',    principal: false },
  ];
  const asistentesHtml = asistentes.map(a =>
    `<div class="asistente-badge${a.principal ? ' principal' : ''}">
       <span class="asistente-nombre">${escHtml(a.nombre)}</span>
       <span class="asistente-role">${escHtml(a.rol)}</span>
     </div>`
  ).join('');

  const decisionesHtml = (datos.decisiones || [])
    .map(d => `<div class="decision-item"><div class="decision-text">${escHtml(d)}</div></div>`)
    .join('') || '<div class="decision-item"><div class="decision-text" style="color:#aaa">Sin decisiones registradas.</div></div>';

  const pendientesHtml = (datos.pendientes || [])
    .map(p => `<div class="pendiente-item"><div class="pendiente-text">${escHtml(p)}</div></div>`)
    .join('') || '<div class="pendiente-item"><div class="pendiente-text" style="color:#aaa">Sin puntos pendientes.</div></div>';

  return html
    .replace(/{{OBRA_NOMBRE}}/g,       escHtml(datos.obra    || '—'))
    .replace(/{{FECHA_ACTA}}/g,        fechaReport)
    .replace(/{{TIPO_REUNION}}/g,      'Reunión técnica de seguimiento')
    .replace(/{{FECHA_FORMATTED}}/g,   fechaReport)
    .replace(/{{OBJETO_REUNION}}/g,    escHtml(datos.objeto || 'Reunión de seguimiento técnico de obra.'))
    .replace(/{{ASISTENTES_HTML}}/g,   asistentesHtml)
    .replace(/{{DECISIONES_HTML}}/g,   decisionesHtml)
    .replace(/{{PENDIENTES_HTML}}/g,   pendientesHtml)
    .replace(/{{FECHA_GENERACION}}/g,  fechaGeneracion);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 40);
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - y) / 86400000) + 1) / 7);
}

module.exports = { generarPDF };
