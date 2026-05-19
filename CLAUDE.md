# CLAUDE.md — Mili Construcciones · Generador de Reports

> Instrucciones para Claude Code al trabajar en este proyecto.

---

## Contexto del proyecto

Aplicación web para generar reports semanales de obra y actas de reunión técnica para **Mili Construcciones**, una autónoma de construcción en Mallorca. El sistema automatiza el proceso de tomar los partes escritos a mano de Domingo (jefe de obra) y las fotos de obra, y generar un PDF profesional listo para enviar al cliente.

---

## Estado actual

El proyecto está en **fase de frontend**. Existe un prototipo funcional en `mili_report_generator.html` que incluye:

- **Pantalla 1:** formulario de datos de obra + drag & drop de partes y fotos
- **Pantalla 2:** simulación del procesado con pasos animados
- **Pantalla 3:** preview del report + panel de acciones (descargar, OneDrive, WhatsApp)
- **Modal:** creación de obra nueva

El backend **no está implementado aún**. La fase actual es pulir el frontend antes de conectar la API.

---

## Roles fijos (usar siempre en documentos)

| Persona | Rol |
|---------|-----|
| Mili | Gerente |
| Domingo | Jefe de obra |
| Bernat Parera | Arquitecto |

---

## Obras activas

- **Rancho Manolo** — obra principal en curso
- **Molino 2** — C/ Industria Nº13, Palma. Promotor: UNDERHIP

---

## Diseño y estilo

El sistema de diseño está definido en `STYLE_GUIDE.md`. Resumen:

### Colores
```css
--cream:   #f5f3ef   /* fondo principal */
--cream2:  #edeae4
--cream3:  #e4e0d8
--navy:    #1a1a18   /* texto principal, bordes, banda estado */
--mid:     #6b6860   /* texto secundario */
--light:   #a09d98   /* texto terciario, placeholders */
--border:  #d0cdc7
--white:   #ffffff
--green:   #3B6D11   /* estados OK */
--amber:   #854F0B   /* pendientes */
--red:     #791F1F   /* errores */
```

### Tipografía
- **Display / títulos:** `DM Serif Display` (serif, italic para acentos)
- **Body / UI:** `DM Sans` (weights: 300, 400, 500, 600)

### Reglas de diseño
- Sin bordes blancos en header ni footer — el contenido arranca desde el borde
- Banda de estado siempre en `#1a1a18` (negro) con texto en italic serif
- Secciones numeradas: `01`, `02`, `03`
- Badges de operarios: fondo `#e8e5df`, encargado invertido (`#1a1a18` / crema)
- Grid de fotos: `3 columnas`, `aspect-ratio: 4/3`, sin pies de foto
- Footer: separado por `border-top: 2px solid #1a1a18`, firma en DM Serif italic

---

## Estructura del report semanal

```
Cabecera (marca + fecha)
↓
Datos de obra (3 columnas: obra · semana · jefe de obra)
↓
Banda de estado (negro · texto italic)
↓
01 Resumen ejecutivo (generado por IA)
↓
02 Trabajos realizados (tabla: nº · fecha · descripción · operarios)
↓
03 Fotografías del proceso (grid 3×N · solo fotos de obra, nunca partes)
↓
Footer (firma Mili · info report)
```

## Estructura del acta de reunión técnica

```
Cabecera (marca + fecha)
↓
Datos (3 columnas: obra · tipo · fecha)
↓
Banda de objeto (negro · texto italic)
↓
01 Asistentes (badges con roles)
↓
02 Decisiones tomadas (borde izq negro)
↓
03 Puntos pendientes (borde izq ámbar)
↓
Footer
```

---

## Archivos del proyecto

| Archivo | Descripción |
|---------|-------------|
| `mili_report_generator.html` | Frontend principal — app de una sola página |
| `CONTEXT.md` | Contexto completo del proyecto Mili |
| `STYLE_GUIDE.md` | Sistema de diseño completo |
| `template_report_semanal.html` | Plantilla HTML limpia con placeholders |
| `generate_report.py` | Script Python CLI para generar PDFs |
| `CLAUDE.md` | Este archivo |

---

## Tareas pendientes de frontend

- [ ] Pulir diseño y flujo de las 3 pantallas
- [ ] Pantalla 3: hacer la preview del report editable en tiempo real
- [ ] Validación de formulario en pantalla 1 antes de continuar
- [ ] Gestión de obras guardadas (localStorage o JSON local)
- [ ] Vista de historial de reports generados
- [ ] Modo acta técnica (flujo alternativo al report semanal)
- [ ] Responsive para tablet (Mili usa iPad en obra)

---

## Arquitectura de agente (fase backend)

No hay servidor dedicado. El backend es un **agente Claude orquestado por n8n** que se activa bajo demanda. El frontend web es la interfaz manual; el flujo automático semanal corre por n8n sin intervención.

### Stack de producción

| Componente | Tecnología | Coste estimado |
|------------|------------|----------------|
| Orquestador | n8n self-hosted | ~5 €/mes (Hetzner CX22) |
| IA / agente | Claude API (claude-sonnet-4) | ~10–20 €/mes |
| Canal entrada | WhatsApp Business (WATI) | ~40 €/mes |
| Almacenamiento | OneDrive | incluido en M365 |
| **Total infraestructura** | | **~55–65 €/mes** |

### Flujo automático semanal

```
Domingo → WhatsApp (prefijo "parte" o "obra")
        ↓
    n8n webhook recibe el mensaje
        ↓
    Agente Claude API
    ├── 1. OCR del parte con Vision → JSON estructurado
    ├── 2. Genera resumen ejecutivo y tabla de trabajos
    ├── 3. Inyecta datos en template HTML
    ├── 4. Playwright genera PDF
    └── 5. Sube a OneDrive + avisa a Mili por WhatsApp
```

### Flujo manual (desde el frontend web)

```
Mili sube partes y fotos en el navegador
        ↓
    Frontend llama al endpoint del agente
        ↓
    Mismo agente Claude → mismo PDF
        ↓
    Preview en pantalla → descarga o envío
```

### Tareas del agente (todas en el mismo n8n + Claude API)

- **Reports semanales** — OCR de partes + generación de PDF
- **Actas de reunión técnica** — procesado de apuntes + PDF
- **Facturación** — Mili dice por WhatsApp "factura semana 20 a UNDERHIP" → agente genera y envía factura
- **Seguimiento de cobros** — revisión automática de facturas pendientes con aviso a Mili
- **Resumen de costes** — consolidación de horas y operarios por semana

### Prompts clave del agente

**OCR de partes:**
```
Eres un asistente especializado en obras de construcción.
Analiza este parte escrito a mano y devuelve SOLO un JSON con:
{
  "semana": "del X al X de mes año",
  "obra": "nombre",
  "trabajos": [
    {
      "fecha": "DD/MM",
      "operarios": [{ "nombre": "", "rol": "", "horas": 0 }],
      "descripcion": "trabajos del día",
      "confianza": "alta|media|baja"
    }
  ]
}
```

**Generación de resumen:**
```
Eres un redactor técnico de obras de construcción.
A partir de estos trabajos semanales, redacta un resumen
ejecutivo profesional de 4-5 líneas para enviar al promotor.
Tono: formal, conciso, orientado al avance de obra.
```

### Niveles de confianza OCR

| Nivel | Acción |
|-------|--------|
| Alta | Flujo normal — report generado sin interrupciones |
| Media | Report generado con sección marcada con ⚠ |
| Baja | n8n pausa y pide a Domingo reenviar la foto |

---

## Tareas pendientes de backend

- [ ] Flujo n8n: webhook WhatsApp → clasificación por prefijo
- [ ] Flujo n8n: llamada Claude API Vision para OCR
- [ ] Flujo n8n: llamada Claude API para resumen ejecutivo
- [ ] Flujo n8n: Playwright para generación de PDF
- [ ] Flujo n8n: subida a OneDrive + notificación WhatsApp
- [ ] Endpoint mínimo para conectar el frontend al agente
- [ ] Flujo de facturación automática
- [ ] Flujo de seguimiento de cobros

---

## Convenciones de código

- HTML/CSS/JS en un único archivo por ahora (sin bundler)
- CSS con variables en `:root` para todos los colores
- JS vanilla — sin frameworks hasta que el proyecto lo justifique
- Comentarios de sección en CSS con `/* ── NOMBRE ── */`
- IDs descriptivos en kebab-case: `obra-nombre`, `drop-fotos`, etc.
- Nunca incluir fotos de partes escritos en el grid del report

---

## Nomenclatura de archivos de salida

| Tipo | Formato |
|------|---------|
| Report semanal | `report_{obra}_{dd}_{dd}{mes}{yyyy}.pdf` |
| Acta técnica | `acta_reunion_tecnica_{obra}_{dd}{mes}{yyyy}.pdf` |

---

## Notas importantes

- Las fotos de los **partes escritos** son solo para OCR — **nunca** van al grid de fotografías del report
- El grid de fotos acepta cualquier número de imágenes — el layout se adapta automáticamente
- Los roles (Mili=Gerente, Domingo=Jefe de obra, Bernat Parera=Arquitecto) son fijos y deben aparecer siempre
- El corte semanal es **domingo a las 20:00** — cualquier parte posterior va a la semana siguiente
