ARG NODE_IMAGE=node:22-alpine
ARG NPM_REGISTRY=https://registry.npmjs.org
FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=nmtaskboard-build-npm,target=/root/.npm,sharing=locked \
  npm ci --ignore-scripts --registry=${NPM_REGISTRY} --fetch-retries=5 --fetch-retry-maxtimeout=120000
COPY vite.config.js server.js ./
COPY client ./client
COPY lib ./lib
RUN npm run build

FROM ${NODE_IMAGE}
ARG NPM_REGISTRY
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=nmtaskboard-runtime-npm,target=/root/.npm,sharing=locked \
  npm ci --omit=dev --omit=optional --ignore-scripts --registry=${NPM_REGISTRY} --fetch-retries=5 --fetch-retry-maxtimeout=120000 \
  && npm cache clean --force
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/lib ./lib
COPY --chown=node:node --from=build /app/server.js ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3301
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3301/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
