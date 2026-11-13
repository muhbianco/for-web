# Laboratório da Fase 1 (Muchat Espaço)

Prova de isolamento e revogação de mídia com a mesma imagem do LiveKit da hel1, Caddy com o
controle de admissão (`livekit-gate`), Valkey, Chromium real e o núcleo de mídia de verdade.
**Não fala com a produção.** Relatório: `muchat/docs/espaco/fase-1-relatorio.md`.

Pré-requisitos: Docker (no WSL serve), `pnpm install` feito na raiz do for-web, e o worktree do
overlay `muchat` ao lado deste (o controle de admissão é construído de
`../../../../muchat-espaco/livekit-gate`; outro caminho em `GATE_SRC`).

```bash
sh setup.sh                      # chaves só do laboratório + livekit-client em www/
docker compose up -d --build livekit valkey gate caddy
docker compose --profile run run --rm harness              # 23 casos
```

Cenários extras (sempre com `--no-deps`, senão o compose religa o controle ou o recria):

```bash
# Controle de admissão fora do ar
docker compose stop gate
docker compose --profile run run --rm --no-deps -e SCENARIO=gate-down harness
docker compose start gate

# Modo sombra
GATE_MODE=shadow docker compose up -d gate
docker compose --profile run run --rm --no-deps -e SCENARIO=shadow harness
GATE_MODE=enforce docker compose up -d gate

# voice-ingress do Stoat recebendo webhooks de rooms msp_* (R5)
export LIVEKIT_CONFIG=livekit.r5.local.yaml
docker compose --profile r5 up -d database rabbit valkey livekit voice-ingress
docker compose --profile r5 restart voice-ingress   # se subiu antes do RabbitMQ
docker compose --profile run run --rm --no-deps -e SCENARIO=r5 harness
```

Rodar contra o **Caddyfile e a imagem do Caddy de produção** (o harness serve a página de teste
sozinho, então não precisa de rota `/lab` no Caddy):

```bash
export LAB_CADDYFILE=../../../../muchat-espaco/Caddyfile
export LAB_CADDY_IMAGE=docker.io/caddy@sha256:df7f1c2fb114453b951de51a98efc010db1655a92c2e86be6706714e2417a78d
docker compose up -d --build livekit valkey gate caddy
docker compose --profile run run --rm --no-deps harness
```

## Fase 3d: voz nas salas, fluxo completo (perfil `space`)

O servidor do espaço sobe da **mesma imagem da hel1** (`packages/space-server/Dockerfile`). Junto
vêm o Mongo e um Stoat simulado (`e2e/stoatSim.ts`): REST, bonfire e a semente do banco
`revolt`. O `Ready` do bot simulado deixa de fora a sala privada, como o do Stoat real.

A página de teste (`www/space.html`, de `e2e/spacePage.ts`) usa, sem PixiJS:
- o protocolo, o mundo, o movimento e o `MediaLink` do app;
- o `livekit-client` no lugar do `Voice`.

O Caddy do laboratório tem a rota `/_muchat/space`, e o gate fica em `enforce`.

```bash
pnpm --filter @muchat/space-server lab:bundle      # na raiz do for-web, no Windows: www/space-lab.js
# no WSL, com `wsl -e sleep 5400` segurando o Docker acordado:
docker compose --profile space up -d --build livekit valkey gate caddy database stoat-sim space
docker compose --profile run --profile space build harness
docker compose --profile run --profile space run --rm --no-deps harness node space-server/lab/e2e/space.ts
```

Reinício sob uma chamada: rode o harness com `-e SCENARIO=restart`. Quando ele imprimir
`RESTART_NOW`, faça `docker compose --profile space restart space`.

**Pare o `space` antes da bateria da fase 1.** Os IDs de sala coincidem, e a varredura dele
apagaria as salas de teste.

Rodadas com menos de 60 s de intervalo herdam o estado da anterior, porque o avatar fica na
tolerância de reconexão.

Desligar: `docker compose --profile run --profile r5 --profile space down`.

A saída termina com `RESUMO n/m ok` e uma linha `RESULTS_JSON` com o detalhe de cada caso.
