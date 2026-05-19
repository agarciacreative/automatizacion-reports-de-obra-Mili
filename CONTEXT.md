# CONTEXT — Sistema de Reports Mili Construcciones

> Pega este archivo al inicio de cualquier conversación con Claude para restaurar todo el contexto del proyecto.

---

## 1. Quién es Mili

**Mili** es una autónoma que se dedica a la dirección y ejecución de obras de construcción en Mallorca. Trabaja sola como jefa de obra y gestiona varios proyectos simultáneamente. Su encargado de obra principal es **Domingo**, que lidera el equipo de operarios sobre el terreno.

**Equipo habitual en obra:**
- Domingo — Encargado
- David — Oficial
- Brahim — Oficial
- Morad — Oficial

**Obra principal activa:** Rancho Manolo (reforma integral de finca rural en Mallorca, promotor no especificado). Trabajos actuales: derribos, estructura, drenaje, pilares metálicos.

**Obra de referencia anterior:** Molino 2, Calle Industria Nº13, Palma de Mallorca. Promotor: UNDERHIP.

---

## 2. El sistema de reports

### Qué hace el sistema
Cada semana Domingo fotografía los partes de obra escritos a mano y fotos del proceso, los envía por WhatsApp a un grupo compartido (Mili + Domingo + Alberto), y el sistema genera automáticamente un PDF profesional que Mili revisa y envía al cliente.

### Flujo técnico (arquitectura acordada)
```
Domingo (WhatsApp grupo)
  → prefijo "parte" + foto del parte escrito a mano
  → prefijo "obra" + foto de progreso de obra

n8n (orquestador)
  → recibe mensajes vía webhook
  → clasifica por prefijo
  → agrupa por semana (corte: domingo 20:00)
  → dispara Claude API

Claude API
  → OCR de partes escritos a mano (Vision)
  → genera resumen ejecutivo + tabla de trabajos
  → devuelve JSON estructurado

n8n
  → inyecta datos en plantilla HTML
  → convierte a PDF con Puppeteer/Playwright
  → sube a OneDrive (carpeta: Obra X > Semana N > report.pdf)
  → avisa a Mili por WhatsApp con enlace

Mili
  → revisa el PDF
  → lo reenvía al cliente
```

### Decisiones de diseño cerradas
- Las fotos NO van emparejadas con entradas de trabajo — van en un grid independiente (sección 03)
- No hay sección de "próximos pasos"
- Estructura fija: 01 Resumen ejecutivo · 02 Trabajos realizados · 03 Fotografías del proceso
- Para el acta de reunión técnica: 01 Asistentes · 02 Decisiones tomadas · 03 Puntos pendientes · 04 Croquis técnicos

### Errores y mitigaciones acordadas
| Error | Solución |
|-------|----------|
| Foto borrosa / OCR baja confianza | Sistema de 3 niveles: alta → normal · media → ⚠ en report · baja → bot pide reenvío |
| Domingo olvida prefijo | Claude Vision clasifica visualmente como fallback |
| Parte llega tarde | Ventana de corte semanal (domingo 20:00) — acumulado semana siguiente |
| Fallo Claude API | Timeout 30s + reintento ×2 + aviso al grupo |
| Fallo subida OneDrive | Reintento ×2 → backup PDF por WhatsApp directo a Mili |
| Cambio API WhatsApp | Proveedor oficial (WATI o Twilio) + carpeta OneDrive compartida como backup de entrada |

---

## 3. Dos tipos de documentos

### A) Report semanal de obra
Generado cada semana a partir de los partes de Domingo.
Secciones: cabecera · datos obra · banda de estado · resumen ejecutivo · tabla trabajos · grid fotos · pie firma.

### B) Acta de reunión técnica
Generado tras visitas de obra con arquitecto u otros técnicos.
Secciones: cabecera · datos obra · objeto · asistentes · decisiones tomadas · puntos pendientes · croquis técnicos.
Los croquis se muestran con efecto de papel técnico (cuadrícula sutil + marco).

---

## 4. Stack técnico

- **Orquestador:** n8n (self-hosted o cloud)
- **Canal de entrada:** WhatsApp Business (WATI o Twilio)
- **IA:** Claude API (claude-sonnet-4) con Vision para OCR
- **Generación PDF:** Playwright/Puppeteer (HTML → PDF)
- **Almacenamiento:** OneDrive (Microsoft)
- **Notificaciones:** WhatsApp al grupo
- **Fonts:** DM Serif Display + DM Sans (Google Fonts)

---

## 5. Personas del proyecto

- **Mili** — cliente, jefa de obra autónoma
- **Domingo** — encargado de obra, genera los partes
- **Alberto** — asesor de automatización e IA (tú), supervisor del sistema
- **Isra** — socio de Alberto en proyectos de marketing digital
