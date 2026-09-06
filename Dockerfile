# Multi-stage Dockerfile for Relay Backend on Railway / Cloud Containers
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools if needed
RUN apk add --no-cache python3 make g++

# Copy package manifests for monorepo dependency caching
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

# Install dependencies
RUN npm ci

# Copy codebase
COPY . .

# Build API
RUN npm --workspace apps/api run build

# --- Production Runner Stage ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy root and API manifests
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/

# Install only production dependencies
RUN npm ci --omit=dev

# Copy compiled build from builder stage
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Default port
EXPOSE 3000

CMD ["node", "apps/api/dist/main"]
