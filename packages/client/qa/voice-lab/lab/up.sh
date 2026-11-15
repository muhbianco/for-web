#!/usr/bin/env bash
# Sobe o SFU de laboratório no Docker do WSL. Rode de dentro do WSL:
#   wsl -e bash /mnt/d/MUHBIANCO/for-web/packages/client/qa/voice-lab/lab/up.sh
# Gera chaves descartáveis em .env (não vai para o git) e anuncia o IP do WSL,
# que o Windows alcança direto (TCP e UDP), ao contrário de localhost.
set -euo pipefail
cd "$(dirname "$0")"

NODE_IP=$(hostname -I | awk '{print $1}')
if [ -z "$NODE_IP" ]; then
  echo "não achei o IP do WSL" >&2
  exit 1
fi

if [ ! -f .env ]; then
  umask 077
  printf 'LAB_API_KEY=lab%s\nLAB_API_SECRET=%s\n' "$(openssl rand -hex 6)" "$(openssl rand -hex 24)" > .env
fi
# shellcheck disable=SC1091
. ./.env
grep -v '^LAB_URL=' .env > .env.tmp || true
echo "LAB_URL=ws://$NODE_IP:7880" >> .env.tmp
mv .env.tmp .env

sed -e "s/__NODE_IP__/$NODE_IP/" -e "s/__KEY__/$LAB_API_KEY/" -e "s/__SECRET__/$LAB_API_SECRET/" \
  livekit.yaml.tmpl > livekit.yaml
chmod 600 livekit.yaml

docker compose up -d
# Reinicia o LiveKit se o IP mudou desde a última subida (config é lida no boot).
docker compose restart livekit >/dev/null
sleep 1
echo "SFU de laboratório em ws://$NODE_IP:7880 (UDP 7882, TCP 7881)"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
