# Multi-stage build for OpenClaw Relay Server
# Build stage compiles TypeScript in workspace context
FROM node:22-alpine AS builder

WORKDIR /app

# Copy entire workspace for build (shared is a workspace dependency)
COPY package*.json ./
COPY tsconfig.json ./
COPY shared ./shared
COPY relay-server/package*.json ./relay-server/
COPY relay-server/tsconfig.json ./relay-server/
COPY relay-server/src ./relay-server/src

# Install all workspace dependencies
RUN npm install

# Build shared first, then relay-server
RUN npm run build --workspace=@openclaw/shared && \
    npm run build --workspace=@openclaw/relay-server

# Production stage - only runtime deps
FROM node:22-alpine

WORKDIR /app

# Copy built artifacts and package files
COPY --from=builder /app/relay-server/dist ./dist
COPY --from=builder /app/relay-server/package*.json ./

# Install only production dependencies
RUN npm ci --only=production

EXPOSE 18791

CMD ["node", "dist/main.js"]
