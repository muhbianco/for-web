#!/usr/bin/env bash
# Cenários extras do laboratório: fala baixa e piso de ruído realista.
#   bash qa/voice-lab/extra.sh [DURATION=45] [PREFIX=]
set -uo pipefail
cd "$(dirname "$0")/../.."
DURATION=${1:-45}
PREFIX=${2:-}
FX=qa/voice-lab/fixtures
RUN="node qa/voice-lab/run.mjs --target lab --duration $DURATION --record 60"
run() {
  local name=$1; shift
  echo "=== $PREFIX$name ==="
  $RUN --name "$PREFIX$name" "$@" 2>&1 | grep -E "^\[|dropouts|quadros lentos|silêncio emitido|motores" || true
}
run quiet-12   --ref $FX/ref-ptbr-48k-12db.wav
run quiet-24   --ref $FX/ref-ptbr-48k-24db.wav
run noise60    --ref $FX/ref-ptbr-48k-noise60.wav
run noise45    --ref $FX/ref-ptbr-48k-noise45.wav
run reconnect2 --netem "loss 100%" --netem-at 15 --netem-clear-at 30
echo "extras concluídos"
