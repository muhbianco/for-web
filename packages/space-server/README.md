# @muchat/space-server

Servidor autoritativo do Muchat Espaço. Desenho e ADRs em `muchat/docs/espaco/`; regras
compartilhadas no [`@muchat/space-core`](../space-core/README.md). Roda na `stoat-net` atrás do
Caddy (`/_muchat/space*`, prefixo cortado).

## O que já faz (Fase 2b)

- **Estrutura do Stoat** (servidores, categorias, canais, papéis) lida do Mongo do Stoat,
  banco `revolt`, só leitura (`stoat/structure.ts`).
  - O `Ready` do bot não serve: o Stoat filtra os canais pelo `ViewChannel` de quem conecta, e as
    salas privadas sumiriam do mapa (e perderiam a vaga).
  - O bot no WebSocket (`stoat/bonfire.ts`) só avisa: um evento de estrutura agenda nova leitura
    (500 ms); a cada 10 s há uma leitura de qualquer jeito, para os canais que o bot não vê.
  - Os eventos de membro vão direto ao cache (`stoat/cache.ts`).
  - O bot é a conta do invite-bot, que já entra em todo servidor.
  - Membros vêm por REST (`stoat/api.ts`), com cache curto e invalidação pelos eventos.
  - Stoat fora do ar é "indisponível", nunca "sessão inválida".
- **Vagas** (`space/assignment.ts`, ADR 0005).
  - Canal de voz novo → próxima vaga livre da ala da categoria.
  - Canal apagado ou sem voz → vaga livre.
  - Ala nova → fim da espinha.
  - Persistência com compare-and-set (`space/store.ts`, Mongo `muchat_space.assignments`).
- **Permissões** pelo port do cálculo do backend (`space-core/perm`).
  - `ViewChannel` decide se a pessoa vê nome e ocupação da sala.
  - `ViewChannel + Connect` decide se a porta abre para ela.
- **Sessões** (`ws/gateway.ts`).
  - WebSocket em `/v1/ws`. O token da sessão do Stoat vai na primeira mensagem (`hello`), nunca na
    URL.
  - Allowlist de `Origin`.
  - Uma sessão por pessoa por espaço: a nova derruba a antiga (4001).
  - Limite de 20 mensagens/s com rajada de 40; abuso contínuo fecha (4429).
  - Revalidação da sessão a cada 5 min.
- **Mundo** (`space/runtime.ts`).
  - Snapshot por pessoa, com salas e alas filtradas por permissão.
  - Movimento validado pelo `applyMove`, com correção em caso de teleporte ou parede.
  - Difusão a 10 Hz só do que mudou.
  - Avatar dentro de sala que a pessoa não pode ver chega como `gone`, nunca como posição.
  - Quem cai fica como "reconectando" por 60 s.
- **Mapa por REST:** `GET /v1/spaces/{server}/layout/{fingerprint}`, só para membros. A geometria
  é igual para todos, mas o mapa vai **sem nomes**: nomes de sala e de ala só chegam no snapshot,
  filtrados.
- **Saúde:** `/health/live` e `/health/ready` (cache do Stoat pronto, bot conectado e, com mídia,
  Redis conectado).

## Voz nas salas (Fase 3a)

`space/roomMedia.ts` liga o núcleo de mídia da Fase 1 (`src/media`) ao mundo. Só a posição aceita
pelo servidor move a mídia: entrar na sala dá a mídia daquela sala, sair tira.

- **Uma fila por pessoa** (`MediaHub`, um por processo). Cada passo compara onde a pessoa **está**
  com a mídia que ela **tem** e corrige a diferença.
  - A ordem é a do `MediaController`. Para revogar: apaga a lease, depois remove o participante.
    Para conceder: confirma a remoção da anterior, depois lease, sala e token.
  - Se a remoção não se confirma, nada é concedido: a pessoa fica na sala sem mídia e recebe
    `media.unavailable`.
  - Entrar e sair em menos de 300 ms não cria lease nenhuma.
- **Uma lease por pessoa**, mesmo com dois espaços abertos.
  - Só **entrar** numa sala, ou pedir "Usar aqui" (`media.session.request`), leva a mídia para
    outro espaço. O espaço que perdeu recebe `media.revoked {reason: "elsewhere"}`.
  - Evento de fundo (papel editado, renovação, reconexão) nunca tira a mídia de outro espaço.
    Sem isso, dois espaços abertos ficariam tomando a mídia um do outro.
- **Token pelas permissões do Stoat**, como o `join_call` do delta:
  - `Speak` → microfone;
  - `Video` → câmera, tela e áudio da tela;
  - `Listen` → ouvir.

  Papel editado que muda isso gera uma concessão nova, com identity nova. Mudança que não mexe no
  token não faz nada.
- **Capacidade:** `voice.max_users` do canal. Com a sala cheia, a porta não abre para quem chega,
  e quem já está dentro nunca é expulso por isso. O valor vai no `RoomView.capacity`.
- **Época** (`msp_<sala>_<época>`): muda quando a sala esvazia. Token de uma ocupação anterior só
  alcança uma sala morta, que a varredura apaga.
- **Reconexão:**
  - Queda do WebSocket do espaço mantém a mídia nos 60 s de tolerância.
  - Aba nova ou `media.session.request` recebem um **token novo da mesma concessão** (mesma
    identity, nenhuma lease nova).
  - Sessão do Stoat encerrada (4401) ou membro removido: a mídia cai na hora, sem tolerância.
- **Reinício ou redeploy sem derrubar chamada.** O desligamento não revoga nada: a lease vive
  120 s no Redis.
  - Na volta, o `hello` procura a lease da pessoa. Se ela ainda pode estar na sala, o servidor a
    adota: mesma identity, avatar de volta na sala, token novo.
  - Se a pessoa perdeu o acesso enquanto o servidor estava fora, a lease é revogada na hora.
  - A varredura poupa as salas de espaços ainda não reabertos por 150 s, e mesmo nelas exige
    lease.
- **Renovação** a cada 30 s.
  - Lease perdida (Redis reiniciou): nova concessão.
  - Redis fora do ar: nada muda, porque a lease ainda tem até 120 s.

**Virada do servidor** (`space/spatialSwitch.ts`, ADR 0006): cada servidor ligado em
`SPACE_ENABLED_SERVERS` (`*` = todos, inclusive os novos) recebe a chave
`muchat:space:enabled:<servidor>` no Redis. O delta patcheado lê essa chave e recusa `join_call` e
o mover de voz naquele servidor (`FeatureDisabled{spatial_only}`); DMs e grupos não mudam.

- Na virada, as rooms clássicas daquele servidor são fechadas no LiveKit.
- Tirar o servidor da variável apaga a chave e devolve a voz clássica.
- Servidor que o cache não conhece fica como está: uma falha do banco nunca religa a voz
  clássica em todo lugar.
- A sincronia roda a cada mudança de estrutura e a cada minuto.

Eventos ao cliente:
- `media.grant {room_id, url, token, identity, sources, can_subscribe, expires_at}`;
- `media.revoked {room_id, reason: left|access|regrant|elsewhere}`;
- `media.unavailable {room_id, reason: livekit|elsewhere}`.

Comando: `media.session.request` (sem sala: quem decide a sala é o servidor), no máximo 1 a cada
3 s.

## Ainda não

- **Overlay (3c):**
  - serviço `space` no compose e rota no Caddy;
  - chave própria do espaço no LiveKit;
  - `enforcer` lendo `sp_<user>_<seq>`;
  - `SpatialOnly` no delta;
  - voice-ingress ignorando `msp_`;
  - backup do `muchat_space`.
- **Mongo de verdade:** os adaptadores (`MongoAssignmentStore`, `MongoProfileStore`,
  `loadStructure`) só passaram pela checagem de tipos e pelo build; os testes usam memória. O
  laboratório da 3d cobre.
- **Retomada por token:** hoje a retomada é por usuário, dentro dos 60 s.
- **Infra:** `/metrics`.

## Configuração (env)

| Variável | Padrão | |
|---|---|---|
| `SPACE_BOT_TOKEN` | — | Token do bot (no compose: o do invite-bot, `STOAT_BOT_TOKEN`) |
| `STOAT_DB` | `revolt` | Banco do Stoat no mesmo Mongo, lido para a estrutura |
| `STOAT_API_URL` | `http://api:14702` | delta, direto pela `stoat-net` |
| `STOAT_WS_URL` | `ws://events:14703` | bonfire |
| `MONGO_URL` | `mongodb://database:27017` | Mongo do stack (banco `muchat_space`) |
| `SPACE_ENABLED_SERVERS` | vazio | Ids de servidor com espaço ligado, separados por vírgula (`*` no laboratório) |
| `SPACE_ALLOWED_ORIGINS` | `https://chat.muhbianco.com.br` | Origens de navegador aceitas no WebSocket |
| `SPACE_PORT` | `8095` | |
| `LIVEKIT_SPACE_KEY` / `LIVEKIT_SPACE_SECRET` | — | Chave **própria** do espaço no LiveKit (segredo, no Env da stack). Sem ela, o espaço roda só com presença |
| `LIVEKIT_URL` | `http://livekit:7880` | API de administração, direto pela `stoat-net` |
| `LIVEKIT_PUBLIC_URL` | `wss://chat.muhbianco.com.br/livekit` | O que vai no `media.grant` (passa pelo `livekit-gate`) |
| `REDIS_URL` | `redis://redis:6379` | Valkey do stack (leases que o `livekit-gate` lê) |

## Imagem

`Dockerfile` (contexto: raiz do repositório). O `build.mjs` empacota o servidor com o esbuild
num único `main.cjs`: o Node só remove tipos de `.ts` fora de `node_modules`, e o `space-core`
cairia lá dentro. O runtime é `node:24.22.3-alpine` (por digest), usuário `node`, sem pnpm nem
`node_modules`.

O pipeline do for-web gera `muchat-space:<sha12>` + `:latest` quando `packages/space-*` ou o
lockfile mudam, e só sobe o serviço se ele estiver ligado no overlay. Como ligar:
`muchat/docs/espaco/fase-3-implantacao.md`.

## Testes

```bash
pnpm --filter @muchat/space-server test        # unidade + protocolo (gateway real, clientes ws reais)
pnpm --filter @muchat/space-server typecheck
```

O teste de protocolo (`ws/gateway.test.ts`) sobe o gateway numa porta local com o Stoat simulado
e relógio controlado. Ele cobre:

- autenticação e códigos de fechamento;
- origem;
- correção de teleporte;
- difusão;
- privacidade: quem não vê a sala nunca recebe posição dentro dela e a porta não abre para essa
  pessoa;
- segunda aba;
- mapa sem nomes;
- canal novo entrando no mapa.

`space/roomMedia.test.ts` (18 casos) roda o runtime de verdade com LiveKit, Redis e emissor de
token simulados (`media/fakes.ts`):

- **Entrar e sair:**
  - entrar concede e sair revoga;
  - entrar e sair rápido não cria nada;
  - as fontes do token seguem as permissões;
  - sala cheia não abre;
  - a época só muda quando a sala esvazia.
- **Perda de acesso:**
  - quem perde o acesso dentro da sala sai e perde a mídia;
  - papel editado gera concessão nova;
  - membro removido durante a reconexão perde a mídia sem esperar.
- **Quedas e abas:**
  - a queda do WebSocket mantém a mídia durante a tolerância;
  - evict revoga na hora;
  - aba nova e pedido de token reaproveitam a concessão, com limite de pedidos;
  - LiveKit fora do ar deixa a pessoa na sala sem mídia.
- **Redis:** lease perdida gera concessão nova; Redis fora do ar não muda nada.
- **Reinício:**
  - a pessoa volta para a sala com a mesma identity, e a varredura não a remove;
  - lease de quem perdeu o acesso é revogada;
  - a tolerância de 150 s para salas de espaços não reabertos.
- **Dois espaços abertos:** a mídia vai para onde a pessoa entrou, nunca volta sozinha, e "Usar
  aqui" a traz de volta.
- **Servidor apagado:** encerra todas as concessões daquele espaço.
