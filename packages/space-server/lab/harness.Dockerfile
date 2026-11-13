# Harness do laboratório: Chromium do Playwright + o núcleo de mídia real.
# Contexto de build: packages/ (precisa de space-core e space-server).
FROM mcr.microsoft.com/playwright:v1.60.0-noble
WORKDIR /app
RUN printf '{"name":"lab-harness","private":true,"type":"module"}\n' > package.json \
 && npm install --no-audit --no-fund --omit=dev \
      ioredis@5.10.1 livekit-server-sdk@2.19.2 zod@4.6.7 playwright@1.60.0
COPY space-core/package.json /app/space-core/package.json
COPY space-core/src /app/space-core/src
COPY space-server/package.json /app/space-server/package.json
COPY space-server/src /app/space-server/src
COPY space-server/lab/e2e /app/space-server/lab/e2e
COPY space-server/lab/www /app/space-server/lab/www
# Workspace link, as pnpm would make it (realpath outside node_modules keeps
# Node's type stripping working for the .ts sources).
RUN mkdir -p node_modules/@muchat && ln -s /app/space-core node_modules/@muchat/space-core
CMD ["node", "space-server/lab/e2e/run.ts"]
