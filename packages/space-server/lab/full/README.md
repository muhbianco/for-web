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

## Arquivos gerados (gitignored)

| Arquivo | O que guarda |
|---|---|
| `.keys` / `.env` | chaves do LiveKit, só do laboratório |
| `.wsl-ip` | IP do WSL (muda a cada boot do Windows: refaça o `setup.sh` e reinicie o LiveKit) |
| `Revolt.toml`, `livekit.yaml` | configuração gerada pelo setup |
| `state.local.json` | senhas e tokens das contas de teste, token do bot, ids |
