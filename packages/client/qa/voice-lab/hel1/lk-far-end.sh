#!/bin/sh
# Participante de teste ao lado do SFU da hel1 (dentro da stoat-net), com o
# livekit-cli oficial: publica áudio sintético e/ou assina a sala e, ao final,
# imprime perda de pacotes e latência vistas desse lado. Não grava áudio.
#   sh lk-far-end.sh <room> <duração ex. 5m> [audio-publishers] [subscribers]
# Lê a chave do livekit.yml como o mint-tokens.sh; nunca a imprime.
set -eu
ROOM=${1:?room (qa_*)}
DURATION=${2:-2m}
PUBS=${3:-1}
SUBS=${4:-1}
case "$ROOM" in qa_*) ;; *) echo "a sala de QA precisa começar com qa_" >&2; exit 2 ;; esac
CFG=${LIVEKIT_CFG:-/usr/src/stoat/livekit.yml}
IMAGE=${LK_IMAGE:-livekit/livekit-cli:latest}
OUT=${OUT:-/tmp/voice-qa}
umask 077
mkdir -p "$OUT"
KEY=$(awk '/^keys:/{f=1;next} f&&/^[^ \t]/{f=0} f&&NF{sub(":","",$1);print $1;exit}' "$CFG")
SECRET=$(awk '/^keys:/{f=1;next} f&&/^[^ \t]/{f=0} f&&NF{print $2;exit}' "$CFG")
[ -n "$KEY" ] && [ -n "$SECRET" ] || { echo "chave do LiveKit não encontrada" >&2; exit 1; }
ENVF=$(mktemp "$OUT/.env.XXXXXX")
trap 'rm -f "$ENVF"' EXIT
printf 'LIVEKIT_API_KEY=%s\nLIVEKIT_API_SECRET=%s\nLIVEKIT_URL=ws://livekit:7880\n' "$KEY" "$SECRET" > "$ENVF"
# Sem --cpus: o teste é curto e o lk é leve; a stoat-net dá acesso direto ao
# container do LiveKit, sem passar por Caddy/gate (é o lado "ao lado do SFU").
docker run --rm --network stoat-net --env-file "$ENVF" --name "voice-qa-lk-$$" "$IMAGE" \
  load-test --room "$ROOM" --duration "$DURATION" \
  --audio-publishers "$PUBS" --subscribers "$SUBS" --identity-prefix hel1-lk --no-simulcast -y 2>&1 \
  | tee "$OUT/lk-$(date +%s).log"
