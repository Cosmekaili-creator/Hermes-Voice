# Hermes Voice — multi-stage production image (adapter-node).
# Build from repo root: docker build -f deploy/Dockerfile -t hermes-voice .
# Prefer: docker compose -f deploy/docker-compose.yml build

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
# Skip prepare (svelte-kit sync) until sources are present.
RUN npm ci --ignore-scripts
COPY . .
RUN npx svelte-kit sync \
	&& npm run build \
	&& npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
	HOST=127.0.0.1 \
	PORT=4331

RUN groupadd --system --gid 10001 hermesvoice \
	&& useradd --system --uid 10001 --gid hermesvoice --home-dir /app --shell /usr/sbin/nologin hermesvoice \
	&& mkdir -p /app/data \
	&& chown -R hermesvoice:hermesvoice /app

COPY --from=build --chown=hermesvoice:hermesvoice /src/build ./build
COPY --from=build --chown=hermesvoice:hermesvoice /src/package.json ./package.json
COPY --from=build --chown=hermesvoice:hermesvoice /src/package-lock.json ./package-lock.json
COPY --from=build --chown=hermesvoice:hermesvoice /src/node_modules ./node_modules

USER hermesvoice
EXPOSE 4331
CMD ["node", "build/index.js"]
