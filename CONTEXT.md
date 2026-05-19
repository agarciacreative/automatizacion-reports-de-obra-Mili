# CONTEXT — Mili Construcciones · Generador de Reports
> Adjunta este archivo al inicio de una sesión de Claude Code para restaurar el contexto completo.

---

## El proyecto

Aplicación web para **Mili Construcciones** (autónoma de construcción en Mallorca).
Domingo (jefe de obra) escribe partes a mano cada día. Mili sube fotos de esos partes + fotos de obra → la app genera un PDF profesional listo para enviar al cliente.

**Equipo habitual:** Domingo (encargado), David, Brahim, Morad (oficiales).
**Roles fijos en documentos:** Mili = Gerente · Domingo = Jefe de obra · Bernat Parera = Arquitecto.

---

## Estado actual (mayo 2026)

| Fase | Estado |
|------|--------|
| 0 Setup | ✅ Completada |
| 1 Frontend | ✅ Completada |
| 2 Backend Express | ✅ Completada |
| 3 OCR Claude Vision | ✅ Completada |
| 4 PDF Playwright | ✅ Completada |
| 5 OneDrive | ⏳ Pendiente (requiere Azure App Registration) |
| 6 WhatsApp WATI | ⏳ Pendiente (requiere credenciales WATI) |
| 7 Automatización n8n | ⏳ Pendiente |

**Deploy activo:** `https://automatizacion-reports-de-obra-mili-production.up.railway.app`
**GitHub:** `https://github.com/agarciacreative/automatizacion-reports-de-obra-Mili`
**Railway:** usa Docker (`mcr.microsoft.com/playwright:v1.52.0-jammy`) forzado por `railway.toml`

---

## Stack técnico

| Pieza | Tecnología |
|-------|-----------|
| Backend | Node.js 18+ + Express 4 (CommonJS) |
| Frontend | Vanilla JS SPA — `index.html` único |
| OCR / resumen | `@anthropic-ai/sdk` v0.52 · modelo `claude-sonnet-4-6` |
| PDF | Playwright + Chromium headless (browser singleton) |
| Datos | `obras.json` (sin DB real aún — migración a Supabase planificada) |
| Deploy | Railway con Dockerfile |
| Proceso local | `npm run dev` (nodemon) |

---

## Estructura de ficheros

```
/
├── server.js                 ← Express: rutas + headers seguridad
├── index.html                ← SPA 3 pantallas
├── package.json
├── ecosystem.config.js       ← PM2 (VPS manual)
├── Dockerfile                ← imagen playwright:v1.52.0-jammy
├── railway.toml              ← fuerza builder=DOCKERFILE en Railway
├── obras.json                ← obras activas (BD temporal)
├── .env                      ← NO en git — contiene ANTHROPIC_API_KEY
├── routes/
│   ├── generate.js           ← pipeline OCR→resumen→PDF con SSE
│   └── obras.js              ← CRUD obras.json
├── services/
│   ├── ocr.js                ← Claude Vision → JSON de trabajos
│   ├── summary.js            ← Claude texto → resumen ejecutivo
│   ├── pdf.js                ← Playwright → PDF A4
│   ├── onedrive.js           ← STUB vacío
│   └── whatsapp.js           ← STUB vacío
├── templates/
│   ├── template_report_semanal.html
│   └── template_acta_tecnica.html
├── output/                   ← PDFs generados (gitignored)
├── tmp/                      ← uploads temporales (gitignored)
└── deploy/
    ├── nginx.conf            ← para VPS manual
    └── update.sh             ← script de actualización VPS
```

---

## Variables de entorno

En local → fichero `.env` en la raíz (nunca en git).
En Railway → panel Variables del servicio.

```
ANTHROPIC_API_KEY=sk-ant-api03-...
NODE_ENV=development
PORT=3000
ONEDRIVE_CLIENT_ID=        (vacío, Fase 5)
ONEDRIVE_CLIENT_SECRET=    (vacío, Fase 5)
ONEDRIVE_TENANT_ID=        (vacío, Fase 5)
WATI_API_URL=https://live-mt-server.wati.io
WATI_API_TOKEN=            (vacío, Fase 6)
WATI_PHONE_MILI=+34...     (vacío, Fase 6)
```

---

## Cómo correr en local (Windows con Node portátil)

```powershell
# Node está en: C:\Users\agarcia\tools\node-v22.15.1-win-x64\
# Git está en:  C:\Users\agarcia\tools\PortableGit\cmd\git.exe
# El proyecto está en \\svrnscdc2\redirected$\agarcia\Desktop\PROYECTO REPORTS OBRAS
# Usar subst para evitar problemas de npm con rutas UNC:
subst P: "\\svrnscdc2\redirected$\agarcia\Desktop\PROYECTO REPORTS OBRAS"
Set-Location P:\
npm run dev   # → http://localhost:3000
```

---

## Pipeline de generación

```
POST /api/generate  →  { jobId }
GET  /api/progress/:jobId  →  SSE: { step, done, error, result }

Paso 1: OCR (services/ocr.js)
  - claude-sonnet-4-6 con Vision
  - System prompt cacheado (cache_control: ephemeral)
  - Devuelve: { trabajos[], confianza: alta|media|baja }
  - Trabaja ordenados cronológicamente por parseFecha()

Paso 2: datos extraídos

Paso 3: Resumen ejecutivo (services/summary.js)
  - claude-sonnet-4-6
  - 4-5 líneas, tercera persona, tono formal para el promotor

Paso 4: composición fotos

Paso 5: PDF (services/pdf.js)
  - Playwright browser singleton (reutilizado entre requests)
  - Template HTML con placeholders {{VARIABLE}}
  - Fotos embebidas como base64
  - Tabla de trabajos: reemplaza <tbody> completo con regex
  - Output: output/report_{slug}_{YYYYMMDD}.pdf

GET /api/download/:filename  →  descarga el PDF
GET /api/debug               →  solo en NODE_ENV≠production, muestra último OCR
```

---

## Seguridad implementada (auditoría mayo 2026)

- `express.static` solo sirve `index.html` y `/output` (no expone código fuente)
- Multer: `fileFilter` solo `image/*`, límite 15 MB
- `crypto.randomUUID()` para job IDs
- TTL 10 min para jobs huérfanos (memory leak si cliente desconecta)
- `escHtml()` en todos los campos del template incluido resumen ejecutivo
- XSS frontend: `createElement + textContent` en lugar de `innerHTML` para datos del usuario
- `obras.json`: escritura atómica con fichero `.tmp` + `renameSync`
- Headers: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`
- `/api/debug` bloqueado en producción

---

## Fases pendientes — detalle

### Fase 5 — OneDrive
Necesita Azure App Registration con `Files.ReadWrite.All` (Microsoft Graph).
Implementar `services/onedrive.js` → función `uploadReport(pdfPath, obraName, semana)`.
El botón "Guardar en OneDrive" en Pantalla 3 ya existe pero está `disabled`.

### Fase 6 — WhatsApp
Proveedor: WATI (~40€/mes). Necesita `WATI_API_TOKEN` y `WATI_PHONE_MILI`.
Implementar `services/whatsapp.js` → función `sendReportReady(phone, obraName, link)`.
El botón "Enviar enlace a Mili" en Pantalla 3 ya existe pero está `disabled`.

### Fase 7 — n8n automático
Endpoint `GET /api/generate-auto` que acepta URLs de imágenes en lugar de file uploads.
Workflow n8n: webhook WhatsApp → clasificar prefijo → acumular semana → llamar API → PDF → notificar.

---

## Visión a largo plazo (acordada)

Evolucionar hacia plataforma de gestión para constructoras:
- Multi-usuario con autenticación
- Módulos: reports, contabilidad, presupuestos
- BD real: Supabase (PostgreSQL) en lugar de obras.json
- Stack objetivo: Next.js + Supabase (auth + DB + storage) + Hetzner (Playwright)
- Migración incremental: BD primero → auth → Next.js

---

## Diseño y estilo

- **Fuentes:** DM Serif Display (títulos, italic) + DM Sans (body, weights 300/400/500/600)
- **Colores:** `--navy: #1a1a18` · `--cream: #f5f3ef` · `--green: #3B6D11` · `--amber: #854F0B`
- Guía completa en `STYLE_GUIDE.md`
- Templates con placeholders `{{VARIABLE}}` — ver lista completa en cada template

---

## Obras en obras.json

- **Rancho Manolo** — Manacor, Mallorca · reforma · activa
- **Molino 2** — C/ Industria Nº13, Palma · promotor UNDERHIP · inactiva
