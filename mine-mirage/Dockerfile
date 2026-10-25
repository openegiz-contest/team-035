FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY platform/ ./platform/
COPY web/ ./web/
EXPOSE 5233
CMD ["node", "platform/server.mjs"]
