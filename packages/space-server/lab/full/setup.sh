#!/bin/sh
# Prepara o laboratório completo: chaves só do laboratório (.keys), o Revolt.toml do
# Stoat apontando para o app em http://localhost:5173 e o LiveKit anunciando o IP
# do WSL (o navegador no Windows manda mídia direto para ele).
# Rode no WSL, nesta pasta: sh setup.sh
set -eu
cd "$(dirname "$0")"

if [ ! -f .keys ]; then
  key="lab$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
  secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  printf 'LAB_LIVEKIT_KEY=%s\nLAB_LIVEKIT_SECRET=%s\n' "$key" "$secret" > .keys
  chmod 600 .keys
  echo "full-lab: .keys criado (chaves só do laboratório)"
fi
. ./.keys

# O IP do WSL muda a cada boot do Windows: refaça o setup quando mudar.
wsl_ip=$(hostname -I | awk '{print $1}')
echo "$wsl_ip" > .wsl-ip

APP=http://localhost:5173
cat > Revolt.toml <<TOML
[hosts]
app = "$APP"
api = "$APP/api"
events = "ws://localhost:5173/ws"
autumn = "$APP/autumn"
january = "$APP/january"

[hosts.livekit]
worldwide = "ws://localhost:5173/livekit"

[api.livekit.nodes.worldwide]
url = "http://livekit:7880"
lat = 0.0
lon = 0.0
key = "$LAB_LIVEKIT_KEY"
secret = "$LAB_LIVEKIT_SECRET"
TOML

cat > livekit.yaml <<YAML
port: 7880
log_level: info
rtc:
  tcp_port: 17881
  udp_port: 17882
  use_external_ip: false
  node_ip: $wsl_ip
room:
  auto_create: true
YAML

# docker compose lê LAB_LIVEKIT_* do .env da pasta.
cp .keys .env
chmod 600 .env
echo "full-lab: Revolt.toml e livekit.yaml gerados (WSL em $wsl_ip)"
