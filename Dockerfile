# 可選：Railway 預設用 Nixpacks 自動偵測，不需要這個檔案。
# 若想換到任何支援 Docker 的平台（Fly.io、Cloud Run、Koyeb、自架 VPS），直接用這份即可。
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY shared ./shared
COPY public ./public
COPY server ./server
EXPOSE 8765
CMD ["node", "server/index.js"]
