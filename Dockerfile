FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm i --no-save tsx@4

COPY tsconfig.json ./
COPY src ./src
COPY web ./web
COPY assets ./assets

ENV NODE_ENV=production PORT=3000
# reports, score history, launches and sessions live here; mount a volume to keep them
VOLUME /app/data
EXPOSE 3000
CMD ["npx", "tsx", "src/server.ts"]
