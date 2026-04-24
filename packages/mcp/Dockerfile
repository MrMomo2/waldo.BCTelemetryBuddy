# BC Telemetry Buddy MCP - SSE Server for Rovo Studio
# Multi-stage build for minimal runtime image

FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
COPY packages ./packages
COPY scripts ./scripts

RUN npm ci --ignore-scripts && \
    node scripts/generate-telemetry-config-ci.js

WORKDIR /app/packages/shared
RUN npm run build

WORKDIR /app/packages/mcp
RUN npm run build && \
    node scripts/generate-version.js && \
    npx esbuild src/sse-server.ts --bundle --outfile=dist/sse-server.js --platform=node --format=cjs --sourcemap --minify

FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.title="BC Telemetry Buddy MCP SSE Server"
LABEL org.opencontainers.image.description="Model Context Protocol server for Business Central telemetry - SSE endpoint for Rovo Studio"
LABEL org.opencontainers.image.source="https://github.com/waldo1001/waldo.BCTelemetryBuddy"
LABEL org.opencontainers.image.version="3.3.12"

RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/mcp/dist ./packages/mcp/dist
COPY --from=builder /app/packages/mcp/node_modules ./packages/mcp/node_modules
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules

ENV NODE_ENV=production
ENV PORT=3000

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["node", "packages/mcp/dist/sse-server.js"]