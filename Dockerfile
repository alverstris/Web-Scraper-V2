# Supply a reviewed, supported Node 22+ Debian image pinned by digest at build time.
# Example command shape: --build-arg NODE_IMAGE=node:<version>-bookworm-slim@sha256:<digest>
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
RUN npm install --global pnpm@10.32.1
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY server ./server
COPY shared ./shared
COPY deploy/policy ./deploy/policy
COPY deploy/providers ./deploy/providers
COPY tsconfig.json ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "server/main.ts"]
