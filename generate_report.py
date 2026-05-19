"""
generate_report.py
==================
Genera un report semanal de obra en PDF para Mili Construcciones.

Uso:
    python generate_report.py \
        --obra "Rancho Manolo" \
        --semana "4 – 10 mayo 2026" \
        --encargado "Domingo" \
        --fecha-report "11 mayo 2026" \
        --fotos fotos/foto1.jpg fotos/foto2.jpg ... \
        --output output/report_semana19.pdf

El script espera que el contenido del report (resumen + tabla de trabajos)
se pase como JSON via --data o que Claude API lo genere a partir de los partes.

Dependencias:
    pip install playwright
    playwright install chromium
"""

import argparse
import base64
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# ─── PLANTILLA HTML ────────────────────────────────────────────────────────────

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Report Semanal — {obra}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: "DM Sans", sans-serif; background: #f5f3ef; color: #1a1a18; padding: 2rem; max-width: 860px; margin: 0 auto; }}
  .header {{ display: grid; grid-template-columns: 1fr auto; align-items: start; border-bottom: 2px solid #1a1a18; padding-bottom: 1.5rem; margin-bottom: 2rem; }}
  .brand-name {{ font-family: "DM Serif Display", serif; font-size: 2rem; letter-spacing: -0.02em; line-height: 1; }}
  .brand-sub {{ font-size: 0.7rem; font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase; color: #7a7a72; margin-top: 0.2rem; }}
  .report-label {{ font-size: 0.65rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #7a7a72; margin-bottom: 0.3rem; text-align: right; }}
  .report-date {{ font-family: "DM Serif Display", serif; font-size: 1.1rem; text-align: right; }}
  .obra-info {{ display: grid; grid-template-columns: 1fr 1fr 1fr; border: 1.5px solid #1a1a18; margin-bottom: 2rem; }}
  .obra-field {{ padding: 0.9rem 1.2rem; border-right: 1.5px solid #1a1a18; }}
  .obra-field:last-child {{ border-right: none; }}
  .obra-field-label {{ font-size: 0.6rem; font-weight: 600; letter-spacing: 0.15em; text-transform: uppercase; color: #7a7a72; margin-bottom: 0.3rem; }}
  .obra-field-value {{ font-size: 0.9rem; font-weight: 500; }}
  .estado-section {{ background: #1a1a18; color: #f5f3ef; padding: 1.2rem 1.5rem; margin-bottom: 2rem; display: flex; align-items: center; gap: 1.5rem; }}
  .estado-label {{ font-size: 0.6rem; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: #9a9a8a; white-space: nowrap; }}
  .estado-text {{ font-family: "DM Serif Display", serif; font-size: 1rem; font-style: italic; color: #f5f3ef; line-height: 1.4; }}
  .section {{ margin-bottom: 2.5rem; }}
  .section-header {{ display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; padding-bottom: 0.6rem; border-bottom: 1px solid #d0cdc7; }}
  .section-number {{ font-size: 0.65rem; font-weight: 600; letter-spacing: 0.1em; color: #aaa; }}
  .section-title {{ font-size: 0.65rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #1a1a18; }}
  .resumen-text {{ font-size: 0.95rem; line-height: 1.75; color: #3a3a35; font-weight: 300; max-width: 680px; }}
  .trabajos-table {{ width: 100%; border-collapse: collapse; }}
  .trabajos-table thead tr {{ border-bottom: 1.5px solid #1a1a18; }}
  .trabajos-table th {{ font-size: 0.6rem; font-weight: 600; letter-spacing: 0.15em; text-transform: uppercase; color: #7a7a72; padding: 0.5rem 0.8rem 0.7rem; text-align: left; }}
  .trabajos-table td {{ padding: 1rem 0.8rem; font-size: 0.85rem; vertical-align: top; border-bottom: 1px solid #e0ddd7; line-height: 1.55; color: #2a2a25; }}
  .trabajos-table tr:last-child td {{ border-bottom: none; }}
  .td-num {{ font-family: "DM Serif Display", serif; font-size: 1.3rem; color: #d0cdc7; width: 40px; padding-top: 0.9rem; }}
  .td-fecha {{ width: 90px; font-size: 0.8rem; color: #7a7a72; font-weight: 500; }}
  .td-descripcion {{ font-weight: 300; }}
  .td-operarios {{ width: 150px; font-size: 0.78rem; color: #5a5a52; }}
  .op-badge {{ display: inline-block; background: #e8e5df; border-radius: 2px; padding: 0.15rem 0.5rem; font-size: 0.72rem; font-weight: 500; margin: 0.1rem 0.1rem 0.1rem 0; white-space: nowrap; }}
  .op-badge.enc {{ background: #1a1a18; color: #f5f3ef; }}
  .op-sub {{ font-size: 0.7rem; color: #9a9a8a; margin-top: 0.3rem; display: block; }}
  .fotos-grid {{ display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.6rem; }}
  .foto-item {{ aspect-ratio: 4/3; overflow: hidden; background: #e8e5df; border: 1px solid #d0cdc7; }}
  .foto-item img {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
  .footer {{ margin-top: 3rem; padding-top: 1.5rem; border-top: 2px solid #1a1a18; display: grid; grid-template-columns: 1fr 1fr; align-items: end; }}
  .footer-firma {{ font-family: "DM Serif Display", serif; font-size: 1.4rem; font-style: italic; color: #1a1a18; margin-bottom: 0.2rem; }}
  .footer-cargo {{ font-size: 0.65rem; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: #7a7a72; }}
  .footer-info {{ font-size: 0.72rem; color: #aaa; line-height: 1.7; text-align: right; }}
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="brand-name">Mili Construcciones</div>
    <div class="brand-sub">Dirección y ejecución de obras</div>
  </div>
  <div>
    <div class="report-label">Report semanal</div>
    <div class="report-date">{fecha_report}</div>
  </div>
</div>

<div class="obra-info">
  <div class="obra-field"><div class="obra-field-label">Obra</div><div class="obra-field-value">{obra}</div></div>
  <div class="obra-field"><div class="obra-field-label">Semana</div><div class="obra-field-value">{semana}</div></div>
  <div class="obra-field"><div class="obra-field-label">Encargado</div><div class="obra-field-value">{encargado}</div></div>
</div>

<div class="estado-section">
  <div class="estado-label">Estado</div>
  <div class="estado-text">{estado}</div>
</div>

<div class="section">
  <div class="section-header"><span class="section-number">01</span><span class="section-title">Resumen ejecutivo</span></div>
  <p class="resumen-text">{resumen}</p>
</div>

<div class="section">
  <div class="section-header"><span class="section-number">02</span><span class="section-title">Trabajos realizados</span></div>
  <table class="trabajos-table">
    <thead><tr><th></th><th>Fecha</th><th>Descripción</th><th>Operarios</th></tr></thead>
    <tbody>{filas_trabajos}</tbody>
  </table>
</div>

<div class="section">
  <div class="section-header"><span class="section-number">03</span><span class="section-title">Fotografías del proceso</span></div>
  <div class="fotos-grid">{fotos_html}</div>
</div>

<div class="footer">
  <div>
    <div class="footer-firma">Mili —</div>
    <div class="footer-cargo">Jefa de obra · Autónoma</div>
  </div>
  <div class="footer-info">
    Report generado el {fecha_generacion}<br>
    Obra: {obra} · Semana {num_semana}
  </div>
</div>

</body>
</html>"""

# ─── HELPERS ──────────────────────────────────────────────────────────────────

def encode_image(path: str) -> str:
    """Convierte una imagen a base64."""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def build_fotos_html(foto_paths: list) -> str:
    """Genera el HTML del grid de fotos con imágenes en base64."""
    items = []
    for path in foto_paths:
        if not os.path.exists(path):
            print(f"  ⚠ Foto no encontrada: {path}")
            continue
        b64 = encode_image(path)
        ext = Path(path).suffix.lower().replace(".", "")
        mime = "jpeg" if ext in ("jpg", "jpeg") else ext
        items.append(
            f'<div class="foto-item">'
            f'<img src="data:image/{mime};base64,{b64}" alt="Obra">'
            f'</div>'
        )
    return "\n    ".join(items)


def build_fila_trabajo(n: int, fecha: str, descripcion: str, operarios: list, horas: str) -> str:
    """Genera una fila de la tabla de trabajos."""
    enc = operarios[0] if operarios else "—"
    resto = operarios[1:] if len(operarios) > 1 else []
    badges = f'<span class="op-badge enc">{enc}</span>'
    for op in resto:
        badges += f'<span class="op-badge">{op}</span>'
    badges += f'<span class="op-sub">{len(operarios)} op. · {horas}</span>'
    return f"""
      <tr>
        <td class="td-num">{n}</td>
        <td class="td-fecha">{fecha}</td>
        <td class="td-descripcion">{descripcion}</td>
        <td class="td-operarios">{badges}</td>
      </tr>"""


def html_to_pdf(html_content: str, output_path: str) -> None:
    """Convierte HTML a PDF usando Playwright."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: playwright no instalado. Ejecuta: pip install playwright && playwright install chromium")
        sys.exit(1)

    tmp_html = output_path.replace(".pdf", "_tmp.html")
    with open(tmp_html, "w", encoding="utf-8") as f:
        f.write(html_content)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(f"file://{os.path.abspath(tmp_html)}")
        page.wait_for_load_state("networkidle")
        page.pdf(
            path=output_path,
            format="A4",
            margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
            print_background=True,
        )
        browser.close()

    os.remove(tmp_html)
    print(f"✓ PDF generado: {output_path} ({os.path.getsize(output_path) // 1024} KB)")


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Genera report semanal de obra en PDF")
    parser.add_argument("--obra", required=True, help="Nombre de la obra")
    parser.add_argument("--semana", required=True, help="Rango de semana (ej: '4 – 10 mayo 2026')")
    parser.add_argument("--encargado", default="Domingo", help="Nombre del encargado")
    parser.add_argument("--fecha-report", default=None, help="Fecha del report (por defecto: hoy)")
    parser.add_argument("--num-semana", default="—", help="Número de semana del año")
    parser.add_argument("--fotos", nargs="*", default=[], help="Rutas a las fotos de obra")
    parser.add_argument("--data", required=True, help="JSON con estado, resumen y trabajos")
    parser.add_argument("--output", required=True, help="Ruta del PDF de salida")
    args = parser.parse_args()

    # Fecha por defecto
    fecha_report = args.fecha_report or datetime.now().strftime("%-d %B %Y")
    fecha_generacion = datetime.now().strftime("%d/%m/%Y")

    # Cargar datos del report
    if os.path.exists(args.data):
        with open(args.data, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.loads(args.data)

    # Construir filas de trabajos
    filas = ""
    for i, t in enumerate(data.get("trabajos", []), 1):
        filas += build_fila_trabajo(
            n=i,
            fecha=t.get("fecha", "—"),
            descripcion=t.get("descripcion", ""),
            operarios=t.get("operarios", []),
            horas=t.get("horas", "—"),
        )

    # Construir grid de fotos
    fotos_html = build_fotos_html(args.fotos)

    # Renderizar HTML
    html = HTML_TEMPLATE.format(
        obra=args.obra,
        semana=args.semana,
        encargado=args.encargado,
        fecha_report=fecha_report,
        fecha_generacion=fecha_generacion,
        num_semana=args.num_semana,
        estado=data.get("estado", ""),
        resumen=data.get("resumen", ""),
        filas_trabajos=filas,
        fotos_html=fotos_html,
    )

    # Crear directorio de salida si no existe
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    # Generar PDF
    html_to_pdf(html, args.output)


if __name__ == "__main__":
    main()


# ─── EJEMPLO DE USO ───────────────────────────────────────────────────────────
#
# Archivo data.json:
# {
#   "estado": "Derribos completados. Drenaje y pilares metálicos en ejecución.",
#   "resumen": "Durante la semana del 4 al 10 de mayo...",
#   "trabajos": [
#     {
#       "fecha": "4 may",
#       "descripcion": "Corte y retirada de vigas en dormitorios.",
#       "operarios": ["Domingo", "David", "Brahim", "Morad"],
#       "horas": "8h"
#     }
#   ]
# }
#
# Comando:
# python generate_report.py \
#   --obra "Rancho Manolo" \
#   --semana "4 – 10 mayo 2026" \
#   --encargado "Domingo" \
#   --fecha-report "11 mayo 2026" \
#   --num-semana "19" \
#   --fotos fotos/foto1.jpg fotos/foto2.jpg fotos/foto3.jpg \
#   --data data.json \
#   --output output/report_rancho_manolo_semana19.pdf
