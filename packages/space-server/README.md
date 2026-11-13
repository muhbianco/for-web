# @muchat/space-server

Servidor autoritativo do Muchat Espaço. Desenho e ADRs em `muchat/docs/espaco/`; regras
compartilhadas no [`@muchat/space-core`](../space-core/README.md). Roda na `stoat-net` atrás do
Caddy (`/_muchat/space*`, prefixo cortado).

## O que já faz (Fase 2b)

- **Estrutura do Stoat.** Um bot no WebSocket do Stoat (`stoat/bonfire.ts`) mantém o cache de
  servidores, categorias, canais e papéis (`stoat/cache.ts`).
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
- **Saúde:** `/health/live` e `/health/ready` (cache do Stoat pronto, bot conectado).

## Ainda não

- **Mídia** (lease, token, varredura já existem em `src/media`, Fase 1). Liga nas salas na fase 3.
- **Bot de verdade e Mongo de verdade:** o bot ainda não existe no Stoat, e falta entrar nos
  servidores como o `invite-bot` faz. O adaptador do Mongo só passou pela checagem de tipos. Os
  testes usam o Stoat simulado e o armazenamento em memória.
- **Retomada por token:** hoje a retomada é por usuário, dentro dos 60 s.
- **Infra:** `/metrics`, Dockerfile, serviço no compose e rota no Caddy.

## Configuração (env)

| Variável | Padrão | |
|---|---|---|
| `SPACE_BOT_TOKEN` | — | Token do bot do espaço (segredo, no Env da stack) |
| `STOAT_API_URL` | `http://api:14702` | delta, direto pela `stoat-net` |
| `STOAT_WS_URL` | `ws://events:14703` | bonfire |
| `MONGO_URL` | `mongodb://database:27017` | Mongo do stack (banco `muchat_space`) |
| `SPACE_ENABLED_SERVERS` | vazio | Ids de servidor com espaço ligado, separados por vírgula (`*` no laboratório) |
| `SPACE_ALLOWED_ORIGINS` | `https://chat.muhbianco.com.br` | Origens de navegador aceitas no WebSocket |
| `SPACE_PORT` | `8095` | |

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
