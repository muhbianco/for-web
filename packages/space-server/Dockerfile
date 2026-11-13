# Muchat Espaço — imagem do servidor do espaço (muchat-space:<sha12>).
# Contexto: raiz do repositório (precisa do lockfile e dos manifestos do workspace).
#   docker build -f packages/space-server/Dockerfile -t muchat-space:dev .
#
# O build empacota o servidor num único main.cjs (build.mjs): o runtime não tem
# pnpm nem node_modules, só o Node e o arquivo.

# node:24-alpine em 13/11/2026 (NODE_VERSION=24.22.3)
FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /build

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY patches/ patches/
# Os outros pacotes do workspace entram só com o manifesto: o lockfile cita
# todos, e a instalação filtrada pula os que não são do servidor.
COPY packages/client/package.json packages/client/
COPY packages/stoat.js/package.json packages/stoat.js/
COPY packages/solid-livekit-components/package.json packages/solid-livekit-components/
COPY packages/space-client/package.json packages/space-client/
COPY packages/space-core/ packages/space-core/
COPY packages/space-server/ packages/space-server/

RUN pnpm install --frozen-lockfile --filter "@muchat/space-server..." \
  && pnpm --filter @muchat/space-server build

FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    SPACE_PORT=8095
WORKDIR /app
COPY --from=build /build/packages/space-server/dist/ ./
USER node
EXPOSE 8095
CMD ["node", "main.cjs"]
