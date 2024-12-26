FROM oven/bun:1.1-slim AS builder

WORKDIR /app

# Build arguments
ARG BUILD_DATE
ARG VERSION

# Environment
ENV NODE_ENV=production

# Copy dependency files
COPY package.json bun.lockb tsconfig.json ./

# Install dependencies
RUN bun install --no-install-postinstall

# Copy source code
COPY src/ ./src/

# Second stage
FROM oven/bun:1.1-slim

WORKDIR /app

# Labels
LABEL build_date=$BUILD_DATE version=$VERSION

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create necessary directories
RUN mkdir -p /app/tmp && chown -R bun:bun /app

# Create volume for data
VOLUME ["/app/data"]

# Switch to non-root user
USER bun:bun

ENTRYPOINT ["/entrypoint.sh"]