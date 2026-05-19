#!/bin/bash
# Ejecutar en el servidor para actualizar la app con el último código de GitHub
set -e
cd /var/www/mili-reports
git pull origin main
npm install --omit=dev
pm2 reload mili-reports
echo "✓ Actualización completada"
