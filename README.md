# mili-reports

Generador de reports de obra y actas de reunión técnica para **Mili Construcciones**.

Aplicación web que automatiza la generación de documentos PDF profesionales a partir de los partes escritos a mano de Domingo (jefe de obra) y las fotos del proceso de obra.

---

## Estado del proyecto

| Fase | Estado |
|------|--------|
| Frontend — prototipo | ✅ Completo |
| Frontend — pulido y validación | 🔄 En curso |
| Backend — OCR con Claude API | ⏳ Pendiente |
| Backend — generación PDF | ⏳ Pendiente |
| Integración OneDrive | ⏳ Pendiente |
| Integración WhatsApp | ⏳ Pendiente |

---

## Arranque rápido

### Frontend (sin servidor)
```bash
open frontend/mili_report_generator.html
```
O arrastra el archivo a Chrome/Safari. No requiere servidor ni dependencias.

### Con servidor local (fase backend)
```bash
npm install
npm run dev
```

---

## Estructura del proyecto

```
mili-reports/
├── CLAUDE.md                              # Instrucciones para Claude Code
├── CONTEXT.md                             # Contexto del proyecto Mili
├── STYLE_GUIDE.md                         # Sistema de diseño
├── README.md
├── .gitignore
├── .env.example
├── package.json
│
├── frontend/
│   └── mili_report_generator.html        # App frontend
│
├── templates/
│   ├── template_report_semanal.html      # Plantilla report semanal
│   └── template_acta_tecnica.html        # Plantilla acta técnica
│
├── scripts/
│   └── generate_report.py               # Generador PDF por CLI
│
└── data/
    └── obras.json                        # Obras guardadas
```

---

## Tipos de documentos

### Report semanal de obra
`report_{obra}_{dd}_{dd}{mes}{yyyy}.pdf`

### Acta de reunión técnica
`acta_reunion_tecnica_{obra}_{dd}{mes}{yyyy}.pdf`

---

## Roles fijos

| Persona | Rol |
|---------|-----|
| Mili | Gerente |
| Domingo | Jefe de obra |
| Bernat Parera | Arquitecto |

---

## Stack técnico

| Capa | Tecnología |
|------|------------|
| Frontend | HTML + CSS + JS vanilla |
| IA / OCR | Claude API (claude-sonnet-4) con Vision |
| PDF | Playwright + Chromium |
| Almacenamiento | OneDrive |
| Notificaciones | WhatsApp Business (WATI) |
| Orquestación | n8n |

---

## Variables de entorno

```bash
cp .env.example .env
# Rellena los valores en .env
```

---

## Contexto con Claude

Para restaurar el contexto en Claude.ai: pega `CONTEXT.md` al inicio de la conversación.
Para Claude Code: abre el terminal en la raíz — leerá `CLAUDE.md` automáticamente.
