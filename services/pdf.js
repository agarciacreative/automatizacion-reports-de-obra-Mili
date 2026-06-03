const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Singleton: reutilizar el browser entre requests para ahorrar memoria y tiempo
let browserInstance = null;
async function getBrowser() {
  if (browserInstance) {
    try {
      // Verificar que el proceso sigue vivo antes de reutilizarlo
      await browserInstance.version();
    } catch {
      browserInstance = null;
    }
  }
  if (!browserInstance) browserInstance = await chromium.launch();
  return browserInstance;
}

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

  // Convertir PDFs adjuntos como planos a imágenes PNG antes de incrustar
  let datosConvertidos = datos;
  const tmpConvertidos = [];
  if (tipoDoc === 'acta' && (datos.fotosPlanos || []).some(p => path.extname(p).toLowerCase() === '.pdf')) {
    const browser = await getBrowser();
    const planosFinal = [];
    for (const p of datos.fotosPlanos) {
      if (path.extname(p).toLowerCase() === '.pdf') {
        const imgs = await pdfToImages(p, browser);
        imgs.forEach(imgPath => { planosFinal.push(imgPath); tmpConvertidos.push(imgPath); });
      } else {
        planosFinal.push(p);
      }
    }
    datosConvertidos = { ...datos, fotosPlanos: planosFinal };
  }

  if (tipoDoc === 'report') {
    html = buildReport(html, datosConvertidos, fechaReport, fechaGeneracion, numSemana);
  } else {
    html = buildActa(html, datosConvertidos, fechaReport, fechaGeneracion);
  }

  const outputDir = path.join(__dirname, '..', 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const slug = slugify(datos.obra || 'obra');
  const fecha = today.toISOString().split('T')[0].replace(/-/g, '');
  const filename = tipoDoc === 'acta'
    ? `acta_reunion_tecnica_${slug}_${fecha}.pdf`
    : `report_${slug}_${fecha}.pdf`;
  const outputPath = path.join(outputDir, filename);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Esperar a que TODAS las imágenes (incluidas base64) estén pintadas
    await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return Promise.all(imgs.map(img =>
        img.complete
          ? Promise.resolve()
          : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })
      ));
    });

    // Pequeña pausa adicional para que el layout se estabilice tras las imágenes
    await page.waitForTimeout(300);

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '36px', left: '0' },
    });
  } finally {
    await page.close();
    // Limpiar PNGs temporales generados desde PDFs
    tmpConvertidos.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  }

  return { filename, path: outputPath };
}

// Renderiza cada página de un PDF como PNG usando Playwright (sin deps externas)
async function pdfToImages(pdfPath, browser) {
  const results = [];
  const page = await browser.newPage();
  try {
    // Viewport A4 a 120 dpi: 794×1123 px
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.goto(`file://${path.resolve(pdfPath)}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200); // tiempo para que el visor PDF renderice

    // Obtener alto total del documento (puede abarcar varias páginas)
    const totalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const pageHeight = 1123;
    const numPages = Math.max(1, Math.ceil(totalHeight / pageHeight));

    for (let i = 0; i < numPages; i++) {
      await page.evaluate(y => window.scrollTo(0, y), i * pageHeight);
      await page.waitForTimeout(200);
      const buffer = await page.screenshot({ type: 'png', clip: { x: 0, y: i * pageHeight, width: 794, height: Math.min(pageHeight, totalHeight - i * pageHeight) } });
      const tmpPath = `${pdfPath}.page${i + 1}.png`;
      fs.writeFileSync(tmpPath, buffer);
      results.push(tmpPath);
    }
  } finally {
    await page.close();
  }
  return results;
}

function buildReport(html, datos, fechaReport, fechaGeneracion, numSemana) {
  // Filas de la tabla de trabajos
  const filas = (datos.trabajos || []).map((t, i) => {
    const ops = (t.operarios || []).filter(o => o.nombre && o.nombre.trim());
    // Si no hay nombres, usar el encargado del formulario como referencia
    const encargado = ops[0]?.nombre || datos.encargado || 'Domingo';
    const otrosOps = ops.slice(1)
      .map(o => `<span class="op-badge">${escHtml(o.nombre || '')}</span>`)
      .join('');
    // Intentar extraer número de operarios de la descripción si operarios está vacío
    let numOp = ops.length;
    if (numOp === 0) {
      const match = t.descripcion?.match(/(\d+)\s*(?:OP|OPERARIO)/i);
      numOp = match ? parseInt(match[1], 10) : 1;
    }
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
    .replace(/{{RESUMEN_EJECUTIVO}}/g,escHtml(datos.resumen || '—'))
    .replace(/{{FOTOS_GRID}}/g,       fotosHtml)
    .replace(/{{FECHA_GENERACION}}/g, fechaGeneracion)
    .replace(/{{NUM_SEMANA}}/g,       String(numSemana));
}

function buildActa(html, datos, fechaReport, fechaGeneracion) {
  const ad = datos.actaData || {};

  // Asistentes
  const asistentesHtml = (ad.asistentes || []).map(a =>
    `<span class="asist-pill">${escHtml(a.nombre)} <span class="role">· ${escHtml(a.rol)}</span></span>`
  ).join('') || '<span class="asist-pill">Mili <span class="role">· Gerente</span></span>';

  // Clasificar puntos
  const decisiones = (ad.puntos || []).filter(p => p.tipo === 'decision');
  const pendientes = (ad.puntos || []).filter(p => p.tipo === 'pendiente');

  // Decisiones HTML
  const decisionesHtml = decisiones.map(d => {
    const bulletsHtml = (d.bullets || []).length > 0
      ? `<ul>${d.bullets.map(b => `<li>${escHtml(b)}</li>`).join('')}</ul>`
      : '';
    return `<div class="item">
      <div class="item-stripe stripe-black"></div>
      <div class="item-content content-black">
        <div class="item-meta"><span class="item-num-badge">PT. ${d.numero}</span></div>
        <div class="item-title">${escHtml(d.titulo || '')}</div>
        <div class="item-body">${escHtml(d.descripcion || '')}${bulletsHtml}</div>
      </div>
    </div>`;
  }).join('') || `<div class="item"><div class="item-stripe stripe-black"></div>
    <div class="item-content content-black">
      <div class="item-body" style="color:#aaa">Sin decisiones registradas.</div>
    </div></div>`;

  // Pendientes HTML
  const pendientesHtml = pendientes.map(p => {
    const bulletsHtml = (p.bullets || []).length > 0
      ? `<ul>${p.bullets.map(b => `<li>${escHtml(b)}</li>`).join('')}</ul>`
      : '';
    const tagsHtml = (p.fecha_limite || p.responsable) ? `<div class="tags">
      ${p.fecha_limite ? `<span class="tag-fecha">${escHtml(p.fecha_limite.replace(/\//g, ' / '))}</span>` : ''}
      ${p.responsable  ? `<span class="tag-resp">${escHtml(p.responsable)}</span>` : ''}
    </div>` : '';
    return `<div class="item">
      <div class="item-stripe stripe-amber"></div>
      <div class="item-content content-amber">
        <div class="item-meta"><span class="item-num-badge">PT. ${p.numero}</span></div>
        <div class="item-title">${escHtml(p.titulo || '')}</div>
        <div class="item-body">${escHtml(p.descripcion || '')}${bulletsHtml}</div>
        ${tagsHtml}
      </div>
    </div>`;
  }).join('') || `<div class="item"><div class="item-stripe stripe-amber"></div>
    <div class="item-content content-amber">
      <div class="item-body" style="color:#aaa">Sin puntos pendientes.</div>
    </div></div>`;

  // Fotos de obra
  const fotosObra   = (datos.fotosObra   || []).filter(p => fs.existsSync(p));
  const fotosPlanos = (datos.fotosPlanos || []).filter(p => fs.existsSync(p));

  const fechaActa = ad.fecha || fechaGeneracion;
  const fotosObraHtml   = buildFotosHtml(fotosObra,   'obra',  fechaActa);
  const fotosPlanoHtml  = buildFotosHtml(fotosPlanos, 'plano', fechaActa);

  return html
    .replace(/{{FECHA_DISPLAY}}/g,        ad.fecha_display || fechaReport)
    .replace(/{{OBRA_NOMBRE}}/g,          escHtml(ad.obra_nombre || datos.obra || '—'))
    .replace(/{{UBICACION}}/g,            escHtml(ad.ubicacion   || '—'))
    .replace(/{{PROMOTOR}}/g,             escHtml(ad.promotor    || '—'))
    .replace(/{{PROXIMA_REUNION}}/g,      escHtml(ad.proxima_reunion || '—'))
    .replace(/{{FECHA_FOOTER}}/g,         ad.fecha || fechaGeneracion)
    .replace(/{{ASISTENTES_HTML}}/g,      asistentesHtml)
    .replace(/{{DECISIONES_HTML}}/g,      decisionesHtml)
    .replace(/{{PENDIENTES_HTML}}/g,      pendientesHtml)
    .replace(/{{COUNT_DECISIONES}}/g,     `${decisiones.length} punto${decisiones.length !== 1 ? 's' : ''}`)
    .replace(/{{COUNT_PENDIENTES}}/g,     `${pendientes.length} punto${pendientes.length !== 1 ? 's' : ''}`)
    .replace(/{{FOTOS_OBRA_HTML}}/g,      fotosObraHtml)
    .replace(/{{FOTOS_PLANOS_HTML}}/g,    fotosPlanoHtml)
    .replace(/{{GRID_OBRA}}/g,            getGridClass(fotosObra.length))
    .replace(/{{GRID_PLANOS}}/g,          getGridClass(fotosPlanos.length))
    .replace(/{{SECTION_OBRA_STYLE}}/g,   fotosObra.length   === 0 ? 'display:none;' : '')
    .replace(/{{SECTION_PLANOS_STYLE}}/g, fotosPlanos.length === 0 ? 'display:none;' : '')
    .replace(/{{SECTION_FOTOS_STYLE}}/g,  (fotosObra.length + fotosPlanos.length) === 0 ? 'display:none;' : '')
    .replace(/{{AÑO}}/g,                  String(new Date().getFullYear()));
}

function buildFotosHtml(rutas, tipo, fecha) {
  return rutas.map((p, i) => {
    const ext  = path.extname(p).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const b64  = fs.readFileSync(p).toString('base64');

    // Caption: obra → fecha genérica, plano → nombre limpio del archivo
    let caption;
    if (tipo === 'obra') {
      caption = `Vista obra · ${fecha || ''}`;
    } else {
      const basename = path.basename(p, ext);
      // Eliminar prefijo timestamp (ej: "1716389820000-") y limpiar separadores
      caption = basename.replace(/^\d{10,}-/, '').replace(/[-_]/g, ' ').trim() || `Plano ${i + 1}`;
    }

    // Solo las fotos de obra llevan caption; los planos no
    const captionHtml = tipo === 'obra'
      ? `<div class="photo-caption">${escHtml(caption.toUpperCase())}</div>`
      : '';

    return `<div class="photo-card ${tipo}">
      <img src="data:${mime};base64,${b64}" alt="${escHtml(caption)}">
      ${captionHtml}
    </div>`;
  }).join('');
}

function getGridClass(count) {
  if (count <= 1) return 'photos-cols-1';
  if (count === 2 || count === 4) return 'photos-cols-2'; // 2×1 y 2×2: grid perfecto
  return 'photos-cols-3'; // 3, 5, 6, 7, 8, 9... — CSS maneja última fila incompleta
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
