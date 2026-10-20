# Single-service image: builds the dashboard, then runs the Express server which serves it.
# Used by Fly.io / Render / any container host. Railway can use this or its own Node build.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
ENV NODE_ENV=production SERVE_WEB=1 PORT=3000 DB_PATH=/data/pnl.db
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY app.config.json ./
# /data is where the host mounts its persistent volume (Railway/Fly). No VOLUME instruction: Railway rejects it.
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
