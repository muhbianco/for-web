#!/usr/bin/env bash
# Bateria de cenários do laboratório (alvo lab, SFU no WSL). Cada cenário é uma
# chamada A→B de DURATION segundos; relatórios em out/<data>-<nome>/.
#   bash qa/voice-lab/matrix.sh [DURATION=45] [PREFIX=]
# Rode de packages/client com o vite dev no ar e lab/up.sh já executado.
set -uo pipefail
cd "$(dirname "$0")/../.."
DURATION=${1:-45}
PREFIX=${2:-}
RUN="node qa/voice-lab/run.mjs --target lab --duration $DURATION --record 60"

run() {
  local name=$1; shift
  echo "=== $PREFIX$name ==="
  $RUN --name "$PREFIX$name" "$@" 2>&1 | grep -E "^\[|dropouts|^\| (jitter|perda|concealment fala|acelerado)|quadros lentos|silêncio emitido|motores" || true
}

run baseline
run gate-off        --gate off
run ns-rnnoise      --ns enhanced
run ns-browser      --ns browser
run ns-disabled     --ns disabled
run cpu-load-8      --cpu-load 8
run bidir           --bidir
# Rede: atraso transatlântico (~120 ms por sentido) com jitter, depois perda.
run atl-delay       --netem "delay 120ms 30ms"
run atl-loss2       --netem "delay 120ms 30ms loss 2%"
run atl-loss5       --netem "delay 120ms 30ms loss 5%"
run jitter-60       --netem "delay 60ms 60ms"
run uplink-loss2    --uplink-loss 0.02
run rate-96k        --netem "rate 96kbit"
run reconnect       --netem "loss 100%" --netem-at 20
echo "matriz concluída"
