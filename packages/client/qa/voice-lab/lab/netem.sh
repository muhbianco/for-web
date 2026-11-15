#!/usr/bin/env bash
# Degrada a rede do SFU de laboratório (saída do LiveKit = descida dos clientes).
#   netem.sh clear
#   netem.sh delay 120ms 30ms            # atraso médio 120 ms, jitter ±30 ms
#   netem.sh delay 50ms 10ms loss 2%     # + 2% de perda aleatória
#   netem.sh rate 64kbit                 # limite de banda
#   netem.sh uplink-loss 0.02            # perda de 2% na SUBIDA (iptables, entrada do SFU)
# Qualquer outra lista de argumentos é passada direto ao `tc qdisc ... netem`.
set -euo pipefail
cd "$(dirname "$0")"
NETEM=$(docker compose ps -q netem)
if [ -z "$NETEM" ]; then
  echo "sidecar netem não está rodando (lab/up.sh)" >&2
  exit 1
fi
run() { docker exec "$NETEM" "$@"; }

case "${1:-}" in
  clear)
    run tc qdisc del dev eth0 root 2>/dev/null || true
    run iptables -t filter -F INPUT 2>/dev/null || true
    echo "rede limpa"
    ;;
  uplink-loss)
    P=${2:?probabilidade, ex. 0.02}
    run iptables -t filter -F INPUT 2>/dev/null || true
    run iptables -A INPUT -p udp --dport 7882 -m statistic --mode random --probability "$P" -j DROP
    echo "perda de subida: $P"
    ;;
  "")
    run tc qdisc show dev eth0
    run iptables -S INPUT
    ;;
  *)
    run tc qdisc replace dev eth0 root netem "$@"
    run tc qdisc show dev eth0
    ;;
esac
