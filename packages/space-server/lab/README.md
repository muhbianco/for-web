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

Desligar: `docker compose --profile run --profile r5 down`.

A saída termina com `RESUMO n/m ok` e uma linha `RESULTS_JSON` com o detalhe de cada caso.
