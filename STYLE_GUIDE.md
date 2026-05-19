# STYLE GUIDE — Mili Construcciones Reports

> Referencia completa de diseño. Úsalo para replicar o modificar la plantilla.

---

## Colores

| Token | Valor | Uso |
|-------|-------|-----|
| `--bg` | `#f5f3ef` | Fondo general (crema cálido) |
| `--text-primary` | `#1a1a18` | Texto principal, bordes, banda de estado |
| `--text-secondary` | `#7a7a72` | Labels, fechas, texto secundario |
| `--text-tertiary` | `#aaa` | Footer info, placeholders |
| `--border-main` | `#d0cdc7` | Bordes de tabla y elementos |
| `--border-light` | `#e0ddd7` | Separadores de filas |
| `--surface-white` | `#ffffff` | Cards de decisiones |
| `--surface-warm` | `#e8e5df` | Badges de operarios, placeholders foto |
| `--estado-bg` | `#1a1a18` | Banda de estado (negro) |
| `--estado-text` | `#f5f3ef` | Texto en banda de estado |
| `--estado-label` | `#9a9a8a` | Label "ESTADO" dentro de banda |
| `--decision-border` | `#1a1a18` | Borde izquierdo de decisiones tomadas |
| `--pendiente-border` | `#c0a060` | Borde izquierdo de pendientes (ámbar) |
| `--pendiente-bg` | `#faf8f4` | Fondo de pendientes |
| `--pendiente-label` | `#9a7a40` | Label de pendientes |

---

## Tipografía

| Uso | Fuente | Peso | Tamaño |
|-----|--------|------|--------|
| Nombre empresa (header) | DM Serif Display | Regular | `2rem` |
| Fecha del report | DM Serif Display | Regular | `1.1rem` |
| Número de sección decorativo | DM Serif Display | Regular | `1.3rem` |
| Firma footer | DM Serif Display Italic | — | `1.4rem` |
| Banda de estado | DM Serif Display Italic | — | `1rem` |
| Body / párrafos | DM Sans | 300 (Light) | `0.95rem` |
| Texto de tabla | DM Sans | 300 | `0.85rem` |
| Labels en mayúsculas | DM Sans | 600 | `0.6–0.65rem` + `letter-spacing: 0.15em` |
| Badges operarios | DM Sans | 500 | `0.72rem` |
| Sub-info (horas) | DM Sans | 400 | `0.7rem` |

**Google Fonts import:**
```html
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
```

---

## Layout

- **Ancho máximo:** `860px`, centrado con `margin: 0 auto`
- **Padding body:** `2rem`
- **Gap entre secciones:** `margin-bottom: 2.5rem`

### Header
Grid 2 columnas (`1fr auto`). Izquierda: marca. Derecha: tipo de documento + fecha.
Separado del contenido por `border-bottom: 2px solid #1a1a18`.

### Datos de obra
Grid 3 columnas iguales con `border: 1.5px solid #1a1a18` y `border-right` entre columnas.
Padding interno: `0.9rem 1.2rem`.

### Banda de estado
Fondo `#1a1a18`, flex con `gap: 1.5rem`. Label fijo a la izquierda en caps, texto en DM Serif Italic a la derecha.

### Section header
Flex con número de sección (color `#aaa`) + título en caps. `border-bottom: 1px solid #d0cdc7`.

### Tabla de trabajos
`border-collapse: collapse`. Header con `border-bottom: 1.5px`. Filas con `border-bottom: 1px solid #e0ddd7`.
Columnas: número decorativo (40px) · fecha (90px) · descripción (flex) · operarios (150px).

### Grid de fotos
`grid-template-columns: repeat(3, 1fr)` con `gap: 0.6rem`.
Cada item: `aspect-ratio: 4/3`, `object-fit: cover`.

### Grid de croquis (acta técnica)
`grid-template-columns: repeat(3, 1fr)` con `gap: 0.8rem`.
Cada item: aspect-ratio `3/4`, con overlay de cuadrícula (`background-image: linear-gradient`) y marco interior (`::after`).
Label debajo con punto negro decorativo y texto en caps.

### Badges de operarios
`background: #e8e5df`, `border-radius: 2px`, padding `0.15rem 0.5rem`.
Encargado: `background: #1a1a18; color: #f5f3ef` (invertido).

### Footer
Grid 2 columnas, `border-top: 2px solid #1a1a18`, `margin-top: 3rem`.
Izquierda: firma en DM Serif Italic + cargo en caps.
Derecha: info del report alineada a la derecha.

---

## Decisiones y pendientes (acta técnica)

### Decisión tomada
```css
border-left: 3px solid #1a1a18;
background: #ffffff;
border: 1px solid #d0cdc7;
border-radius: 4px;
padding: 0.9rem 1.1rem;
```
Tag + texto en DM Sans 300. Tag: `min-width: 80px`, caps, color `#7a7a72`.

### Pendiente
```css
border-left: 3px solid #c0a060;
background: #faf8f4;
```
Tag color `#9a7a40`.

---

## Convenciones de nomenclatura de archivos PDF

| Tipo | Formato |
|------|---------|
| Report semanal | `report_{obra}_{dd}_{dd}{mes}{yyyy}.pdf` |
| Acta técnica | `acta_reunion_tecnica_{obra}_{dd}{mes}{yyyy}.pdf` |

**Ejemplo:** `report_rancho_manolo_27_30abril2026.pdf`

---

## Print / PDF

```css
@media print {
  body { padding: 1rem; }
  .footer { margin-top: 2rem; }
}
```
Generación con Playwright: `format: A4`, `margin: 0`, `print_background: true`.
