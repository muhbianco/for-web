# Laboratório completo do Muchat (app de verdade, contas de teste)

O app inteiro roda local, sem tocar a produção:
- **Stoat oficial v0.15.5:** api, events, Mongo, Redis e RabbitMQ.
- **LiveKit.**
- **Servidor do Espaço:** código deste worktree.
- **Cliente:** vite.

Serve para navegar como um usuário de verdade, com várias pessoas ao mesmo tempo. Microfone, câmera e tela são falsos (Chromium do Playwright). Criado em 16/11/2026 para reproduzir os problemas do palco e da Smart TV.

Diferenças para a produção:
- Imagens oficiais do Stoat, sem os patches do muchat. O join_call clássico não importa aqui: as salas do Espaço recebem token do próprio servidor do Espaço.
- Não há livekit-gate (o vite encaminha `/livekit` direto ao LiveKit).
- Não há autumn/january: avatares e anexos não carregam.

## Subir

No WSL, nesta pasta:

```sh
sed 's/\r$//' setup.sh | sh      # chaves do laboratório, Revolt.toml, livekit.yaml (IP do WSL)
docker compose up -d
```

No Windows, na raiz do for-web:

```sh
node packages/space-server/lab/full/seed.mjs   # contas ana/bia/caio, servidor "Espaço Lab", salas, bot
```

Depois, pelo `.claude/launch.json` da raiz do workspace (ou à mão):
- **`full-lab-space`:** `run-space.mjs`, servidor do Espaço na porta 8097.
- **`full-lab-client-build`:** `run-client.mjs --preview` serve o **build de produção** em http://localhost:5173. Gere antes o build com `VITE_API_URL=http://localhost:5173/api VITE_HOST=localhost:5173 node node_modules/vite/bin/vite.js build` em `packages/client`, depois de `lingui extract` e `lingui compile`, senão os textos novos aparecem como código.
- **`full-lab-client`:** o mesmo em modo dev, com HMR.
  - Atenção: no modo dev o card da chamada não aparece no palco. Um erro do devtools/HMR na carga quebra o efeito que posiciona o card.
  - Para testar palco e chamada, use o build.

## Navegar com várias pessoas

`packages/client/qa/full-lab/pilot.mjs` abre Ana, Bia e Caio, cada um no seu contexto do Chromium. O login usa as senhas de teste de `state.local.json`, que nunca são impressas. Depois fica recebendo comandos em http://127.0.0.1:5199 (lista no topo do arquivo):

```sh
cd packages/client && node qa/full-lab/pilot.mjs
curl -s -X POST localhost:5199/act -d '{"u":"bia","op":"key","key":"Shift+S"}'
curl -s -X POST localhost:5199/act -d '{"u":"ana","op":"shot","name":"palco"}'   # → qa/full-lab/out/palco.png
curl -s -X POST localhost:5199/act -d '{"u":"ana","op":"frame","url":"youtube","js":"document.querySelector(\"video\").currentTime"}'
```

**Armadilhas:**
- **Texto com acento no corpo do curl:** pelo Git Bash vira outra codificação. Clique por posição (`mouse`) ou por `eval`.
- **Captura de tela headless:** pode mostrar um retângulo, que é o vídeo do card flutuante refletido. É artefato da captura, não do app.
- **Para o piloto:** TaskStop não mata o node. Use `taskkill //PID <pid> //T //F`, achando o PID com `wmic process where "commandline like '%pilot.mjs%'"`.

## Celular e tablet (o APK)

O APK do Muchat é um WebView que abre o site. Por isso o Espaço no celular é o site numa tela pequena, com toque. O laboratório de celular (desde 23/11/2026) faz o Chromium se passar por esse WebView:
- **Aparelhos** em `packages/client/qa/full-lab/devices.mjs`:
  - celular em pé (393×851), pequeno (360×740) e deitado (851×393);
  - tablet em pé (800×1280) e deitado (1280×800).
- **Cada aparelho** tem densidade, toque, o user agent do WebView com ` Muchat/<versão>` e a ponte `MuchatNative` sem o lado nativo.

**Roteiro automático** (`packages/client/qa/full-lab/mobile-audit.mjs`):
- **O que percorre**, com o Caio:
  - abre o Espaço, passa pelo diálogo do áudio, abre e fecha a lista, anda tocando no mapa e entra numa sala;
  - abre o palco e a ficha do herói;
  - abre mercador, banqueiro, menu da TV e boneco de treino;
  - vai até a TV de verdade, monta um grupo do Idle Hunt e assiste à corrida.
- **Fechar** usa o voltar do Android (`window.muchatBack()`, o que o APK chama).
- **A cada passo**, tira captura e audita a tela:
  - rolagem lateral;
  - controle cortado pela borda, coberto por outro ou pequeno para o dedo (< 40 px);
  - conteúdo cortado;
  - quanto do mapa aparece.
- **Saída:** `qa/full-lab/out/mobile/<rodada>/report.html`, com as capturas lado a lado e os achados.

**Antes de rodar:**
```sh
node packages/space-server/lab/full/seed-heroes.ts --lab-dir <pasta do lab>   # heróis com vocação (Ana, Bia, Caio)
```

**Rodar:**
```sh
cd packages/client
FULL_LAB_DIR=<pasta do lab> node qa/full-lab/mobile-audit.mjs --with-share [--devices phone,tablet] [--run nome]
```
- `--with-share`: a Bia, no computador, compartilha a tela na mesma sala. Assim aparecem o palco e o avatar "AO VIVO".
- **Build:** rode no build de produção feito com `VITE_SPACE_TEST_HOOKS=1`. O roteiro abre os diálogos do jogo pela visão do Espaço, em `window.__spaceView`. O `run-client.mjs` já liga a variável no modo dev; no build, passe a variável no `vite build`. O build que vai para produção não tem a variável, e o trecho some do pacote.
- **`FULL_LAB_DIR` / `--lab-dir`** (scripts `run-space.mjs`, `run-client.mjs` e do piloto): usa o laboratório montado em outro worktree sem copiar as chaves dele.
- **O piloto** também aceita aparelho: `node qa/full-lab/pilot.mjs --devices caio=phone`, com a op `tap` (toque de verdade).

**Armadilhas:**
- **`click()` do Playwright é mouse, mesmo em aparelho de toque.** Com mouse, o botão com dica a mostra ao passar por cima. Por isso o roteiro usa `tap()`.
- **O avatar guarda a posição entre as rodadas.** O herói sobe de level e a corrida da rodada anterior pode estar rolando: o painel dela abre sozinho ao entrar, e o roteiro registra e fecha.
- **Estes achados não valem para produção:**
  - o aviso "O Stoat funciona melhor como aplicativo" só aparece em `localhost` e nos domínios do Stoat; o APK nunca o mostra;
  - o botão "Devtools" só existe no modo dev.

## Arquivos gerados (gitignored)

| Arquivo | O que guarda |
|---|---|
| `.keys` / `.env` | chaves do LiveKit, só do laboratório |
| `.wsl-ip` | IP do WSL (muda a cada boot do Windows: refaça o `setup.sh` e reinicie o LiveKit) |
| `Revolt.toml`, `livekit.yaml` | configuração gerada pelo setup |
| `state.local.json` | senhas e tokens das contas de teste, token do bot, ids |
