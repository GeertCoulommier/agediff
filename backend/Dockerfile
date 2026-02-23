FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application code
COPY . .

# Create output directory and ensure the built-in node user (UID 1000) owns it
RUN mkdir -p /app/output && chown -R node:node /app/output

# Non-root user for security (node user has UID 1000, matching most host users)
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1

CMD ["node", "server.js"]
