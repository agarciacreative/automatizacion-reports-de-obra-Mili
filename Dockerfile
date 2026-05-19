FROM mcr.microsoft.com/playwright:v1.52.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npx playwright install chromium

COPY . .

ENV NODE_ENV=production

CMD ["node", "server.js"]
