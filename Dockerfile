FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 compiles from source when no prebuilt binary matches this Node version.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321 DB_PATH=/data/lightbox.db
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY deploy/backup.mjs ./deploy/backup.mjs
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4321/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/entry.mjs"]
