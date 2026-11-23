# Laboratório de voz do Muchat

Testa a voz **sem precisar de duas pessoas**: dois Chromium controlados pelo Playwright,
com microfone falso (um WAV de referência em PT-BR), conectados ao mesmo LiveKit que o
app usa, rodando **a mesma Room e a mesma cadeia de processamento do microfone** do
cliente (`components/rtc/roomOptions.ts` e `VoiceProcessor.ts`), sem login no Stoat.

Mede por janela de 2 s, nas duas pontas: jitter, perda, concealment (fala e DTX),
accelerate/decelerate do NetEQ, jitter buffer, pacotes/s, bitrate, FEC, RTT, codec
negociado, par ICE (UDP/TCP/relay e porta do SFU), banda estimada, reconexões; e no
publicador o estado do DSP (motor, quadros lentos do DeepFilter, silêncio emitido, VAD).
Grava o áudio processado que **sai** do publicador e o áudio que **chega** no assinante e
compara os dois com a referência: alinhamento, deriva (ms/s), dropouts (com classificação
início de fala × meio da fala), SNR segmental, distância log-espectral, banda acima de
4 kHz, e latência boca-ouvido do trecho pelo SFU (as duas páginas rodam na mesma máquina).

Não grava áudio de usuários reais: só o WAV sintético de `fixtures/`.

## Pré-requisitos (uma vez)

```bash
# referência de voz (voz PT-BR do Windows), 48 kHz mono
powershell -File qa/voice-lab/fixtures/make-reference.ps1

# Chromium do Playwright na versão do client
pnpm --filter client exec playwright install chromium

# SFU de laboratório no Docker do WSL (mesma imagem da hel1 + sidecar netem)
wsl -e bash /mnt/d/MUHBIANCO/for-web/packages/client/qa/voice-lab/lab/up.sh
```

E o dev server do client no ar (`vite dev`, porta 5173): a página do laboratório é
`http://127.0.0.1:5173/qa/voice-lab/index.html`.

## Rodar

De `packages/client`:

```bash
# laboratório local (SFU no WSL), 60 s
node qa/voice-lab/run.mjs --target lab --name baseline --duration 60

# rede degradada (saída do SFU): atraso 120 ms ± 30 ms, 2 % de perda
node qa/voice-lab/run.mjs --target lab --name atl-loss2 --netem "delay 120ms 30ms loss 2%"

# aplicar a degradação no meio da chamada (teste de adaptação / reconexão)
node qa/voice-lab/run.mjs --target lab --name reconnect --netem "loss 100%" --netem-at 20

# perda só na subida (iptables na entrada do SFU)
node qa/voice-lab/run.mjs --target lab --name up-loss --uplink-loss 0.02

# CPU do cliente ocupada (8 threads em prioridade baixa) com o DeepFilter rodando
node qa/voice-lab/run.mjs --target lab --name cpu --cpu-load 8

# Jogo idle (docs/espaco/jogo/ot do muchat): a tela da aventura de verdade (RunPanel)
# recebendo um quadro por segundo, uma corrida atrás da outra, com o painel aberto.
# --below-normal roda o node e os Chromiums em prioridade baixa (para comparar braços
# intercalados sem tomar a máquina)
node qa/voice-lab/run.mjs --target lab --name corrida --run-load --below-normal

# bidirecional, outros supressores, portão desligado
node qa/voice-lab/run.mjs --target lab --name bidir --bidir
node qa/voice-lab/run.mjs --target lab --name rnnoise --ns enhanced
node qa/voice-lab/run.mjs --target lab --name gate-off --gate off

# bateria completa (≈ 20 min)
bash qa/voice-lab/matrix.sh 45 antes-
```

Saída em `qa/voice-lab/out/<data>-<nome>/`: `report.md`, `report.json`, `timeline.json`
(todas as janelas), `console-A.log`/`console-B.log` e os WAVs
(`A-local-processed.wav`, `B-heard-from-A.wav`, …) para ouvir.

## Caminho real (hel1, Brasil ↔ Helsinque ↔ Brasil)

Os dois clientes continuam neste PC, mas a mídia vai de verdade até o LiveKit da hel1 e
volta: é o caminho que dois amigos no Brasil usam. Tokens de uma sala `qa_*` são emitidos
**na hel1**, lendo a chave do `livekit.yml` lá, sem a chave sair do host:

```bash
# na hel1 (uma vez por sessão de testes; validade 2 h)
sh /tmp/voice-qa/mint-tokens.sh qa_voz_<data> qa-pub qa-sub   # usa hel1/mint-tokens.sh + lib/token.mjs
# no PC
scp root@<hel1>:/tmp/voice-qa/qa-*.jwt qa/voice-lab/out/tokens/
node qa/voice-lab/run.mjs --target prod --name prod-path --room qa_voz_<data> --duration 600
```

Participante **ao lado do SFU** (dentro da `stoat-net`, com o `livekit-cli` oficial), para
medir um trecho só (Brasil → Helsinque) e ter um 3.º participante publicando:

```bash
sh hel1/lk-far-end.sh qa_voz_<data> 5m 1 1
```

Salas `qa_*` geram webhooks que o `voice-ingress` do Stoat responde com 500 (não são canais);
é ruído de log, sem efeito. O `livekit-gate` deixa passar qualquer sala que não comece com
`msp_`.

## Limitações conhecidas

- Dois clientes na mesma máquina compartilham CPU e uplink: perdas correlacionadas e carga
  de DSP dobrada. O trecho de rede, no alvo `prod`, é real.
- O `netem` age na saída do SFU (descida dos dois clientes); perda de subida vai por
  `iptables`; atraso de subida não é simulado.
- Métrica perceptual (POLQA/ViSQOL) não está incluída: POLQA é licenciado e o ViSQOL
  exige build com Bazel. As métricas aqui (dropouts, LSD, SNR segmental, deriva) medem
  cortes, distorção espectral e time-stretch, que são os sintomas relatados. Nenhuma
  delas é MOS.
- O microfone falso do Chromium passa pelo mesmo APM (AEC/AGC/NS) que um microfone real,
  mas sem eco acústico; AEC fica sem trabalho.
