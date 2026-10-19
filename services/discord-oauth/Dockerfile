# Bushin Browser — Discord Direct MCP (same original plugin)
# Expose only OAuth/MCP endpoints; Node runs without root privileges.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    BUSHIN_ENABLE_BROWSER_BRIDGE=0
WORKDIR /home/node/app
COPY --chown=node:node package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","src/server.mjs"]
