# Compute service (Node/Express): webhook de Twilio, long-polling de cada
# bot de Telegram conectado, el loop de tool-calling del asistente y los
# workers de outbox/jobs/recordatorios. Necesita un proceso persistente
# (no serverless) — Railway, Render, Fly.io o un VPS. No sirve Vercel.
#
# Build context: la RAÍZ del repositorio (monorepo con npm workspaces), no
# server/. En Railway/Render: "Root Directory" = . (raíz del repo),
# "Dockerfile Path" = server/Dockerfile.
FROM node:20-slim AS base
WORKDIR /repo
COPY package.json package-lock.json ./
COPY app/package.json app/package.json
COPY server/package.json server/package.json
COPY db-tests/package.json db-tests/package.json

FROM base AS build
RUN npm ci
COPY server ./server
RUN npm run build -w server

FROM base AS prod-deps
RUN npm ci --omit=dev

FROM node:20-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=build /repo/server/dist ./server/dist
COPY server/package.json ./server/package.json
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
