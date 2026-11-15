FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY Backend/package*.json Backend/
COPY Frontend/package*.json Frontend/
RUN npm --prefix Backend ci --omit=dev && npm --prefix Frontend ci --include=dev
COPY Backend Backend
COPY Frontend Frontend
COPY package.json package.json
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/Backend Backend
COPY --from=build --chown=node:node /app/Frontend/dist Frontend/dist
COPY --chown=node:node package.json package.json
COPY --chown=node:node scripts/start.mjs scripts/start.mjs
USER node
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
