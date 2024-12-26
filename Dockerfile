# Multi-stage build - first stage for dependencies and building
FROM oven/bun:canary-slim AS builder

# Set working directory
WORKDIR /app

# Copy dependency files only
COPY package.json bun.lockb ./

# Install production dependencies only
RUN bun install --frozen-lockfile --production --no-install-postinstall

# Copy source code to /app/src
COPY src ./src

# Second stage - minimal runtime environment
FROM oven/bun:canary-slim

WORKDIR /app

# Copy only necessary files from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src

# Switch to non-root user for better security
USER bun

# Set the entrypoint
ENTRYPOINT ["bun", "run", "start"]