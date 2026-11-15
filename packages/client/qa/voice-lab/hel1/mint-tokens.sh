#!/bin/sh
# Emite tokens de teste do LiveKit da hel1 para uma sala de QA, sem imprimir a chave.
#   sh mint-tokens.sh <room> <identity> [identity...]
# Saída: /tmp/voice-qa/<identity>.jwt (0600), 2 h de validade. A chave sai do
# livekit.yml só para o ambiente do container node (node:22-alpine já existe na
# hel1) via --env-file temporário. Salas de QA nunca começam com msp_ (o gate do
# Espaço contaria a negação) nem com id de canal do Stoat.
set -eu
ROOM=${1:?room}
shift
case "$ROOM" in
  qa_*) ;;
  *) echo "a sala de QA precisa começar com qa_" >&2; exit 2 ;;
esac
CFG=${LIVEKIT_CFG:-/usr/src/stoat/livekit.yml}
OUT=${OUT:-/tmp/voice-qa}
umask 077
mkdir -p "$OUT"
KEY=$(awk '/^keys:/{f=1;next} f&&/^[^ \t]/{f=0} f&&NF{sub(":","",$1);print $1;exit}' "$CFG")
SECRET=$(awk '/^keys:/{f=1;next} f&&/^[^ \t]/{f=0} f&&NF{print $2;exit}' "$CFG")
if [ -z "$KEY" ] || [ -z "$SECRET" ]; then
  echo "chave do LiveKit não encontrada em $CFG" >&2
  exit 1
fi
ENVF=$(mktemp "$OUT/.env.XXXXXX")
trap 'rm -f "$ENVF"' EXIT
printf 'LIVEKIT_API_KEY=%s\nLIVEKIT_API_SECRET=%s\n' "$KEY" "$SECRET" > "$ENVF"
for ID in "$@"; do
  docker run --rm --env-file "$ENVF" -v "$OUT":/w:ro node:22-alpine \
    node /w/token.mjs "$ROOM" "$ID" 7200 > "$OUT/$ID.jwt"
  echo "ok $ID -> $OUT/$ID.jwt ($(wc -c < "$OUT/$ID.jwt") bytes)"
done
