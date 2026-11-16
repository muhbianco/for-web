#!/usr/bin/env bash
# Regra zero da voz: a cadeia de áudio não muda por efeito colateral de outra
# feature. Compara a branch atual com a base (padrão: origin/main) e falha se
# algum arquivo protegido mudou. `rtc/state.tsx` mistura captura e interface:
# ele pode mudar, mas só fora das funções de conexão/captura, e o script lista
# as funções tocadas para a revisão humana.
#   bash packages/client/qa/voice-lab/tools/protected-diff.sh [base]
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
BASE=${1:-origin/main}
RTC=packages/client/components/rtc

PROTECTED=(
  "$RTC/VoiceProcessor.ts"
  "$RTC/rmsGateProcessor.ts"
  "$RTC/vadPolicy.ts"
  "$RTC/roomOptions.ts"
  "$RTC/dfContextPool.ts"
  "$RTC/callStats.ts"
  "$RTC/callRecorder.ts"
  "$RTC/callDiagnosis.ts"
  "$RTC/deepFilterHealth.ts"
  "$RTC/deepFilterModel.ts"
  "$RTC/deepFilterSupport.ts"
  "$RTC/patchDeepFilterWorklet.ts"
  "$RTC/rmsGateWorklet.ts"
  "$RTC/vadClient.ts"
  "$RTC/vadWorker.ts"
  "$RTC/virtualMic.ts"
  "$RTC/productionMeter.ts"
  "$RTC/productionMeterProcessor.ts"
  "$RTC/voiceEngineStatus.ts"
  "$RTC/components/RoomAudioManager.tsx"
  "packages/client/components/state/stores/noiseSuppressionPolicy.ts"
)

# O Silero só carrega em dev com o onnxruntime fora da pré-otimização do Vite.
if ! grep -q 'onnxruntime-web' packages/client/vite.config.ts; then
  echo "PROTEGIDO ALTERADO: vite.config.ts perdeu optimizeDeps.exclude onnxruntime-web"
  exit 1
fi

fail=0
for f in "${PROTECTED[@]}"; do
  [ -e "$f" ] || [ -n "$(git ls-tree -r --name-only "$BASE" -- "$f")" ] || continue
  if ! git diff --quiet "$BASE"... -- "$f"; then
    echo "PROTEGIDO ALTERADO: $f"
    git diff --stat "$BASE"... -- "$f"
    fail=1
  fi
done

# Funções de rtc/state.tsx que tocam conexão, captura ou publicação de áudio.
GUARDED='connect\(|disconnect\(|setMicrophone|setDeafen|publishTrack|createLocalAudioTrack|VoiceProcessor|roomOptions|noiseSuppression|applyVoice|restartMic|switchMic|setInputDevice|setOutputDevice'
STATE="$RTC/state.tsx"
if ! git diff --quiet "$BASE"... -- "$STATE"; then
  echo "rtc/state.tsx mudou; hunks:"
  git diff -U0 "$BASE"... -- "$STATE" | grep '^@@' | sed 's/^/  /'
  if git diff -U3 "$BASE"... -- "$STATE" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -qE "$GUARDED"; then
    echo "ATENÇÃO: linhas alteradas em state.tsx citam conexão/captura de áudio; revisar à mão."
    fail=1
  fi
fi

if [ $fail -eq 0 ]; then
  echo "ok: nenhum arquivo da cadeia de áudio alterado em relação a $BASE"
fi
exit $fail
