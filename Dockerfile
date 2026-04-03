# ─── Stage 1: Build ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace configs
COPY package.json ./
COPY tsconfig.base.json ./
COPY agent/package.json ./agent/

# Install all dependencies (including dev for build)
RUN npm install --workspaces=false
RUN npm install --workspace=agent

# Copy source
COPY agent/ ./agent/

# Build TypeScript
RUN npm run build --workspace=agent

# ─── Stage 2: Run ────────────────────────────────────────────
FROM node:20-alpine AS runner

# Security: run as non-root
RUN addgroup -S agent && adduser -S agent -G agent

WORKDIR /app

# Copy workspace manifest for npm workspaces resolution
COPY package.json ./
COPY agent/package.json ./agent/

# Production deps only
ENV NODE_ENV=production
RUN npm install --workspace=agent --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/agent/dist ./agent/dist

# Health check: the agent exposes a minimal HTTP server on PORT
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3001}/health || exit 1

USER agent

EXPOSE 3001

CMD ["node", "agent/dist/index.js"]
