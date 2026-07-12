FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl su-exec

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && mkdir -p /app/data

EXPOSE 3456

ENV NODE_ENV=production \
    PORT=3456

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
  CMD curl -fsS http://localhost:3456/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
