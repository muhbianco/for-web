# @muchat/space-core

Regras do Muchat Espaço que valem igual no cliente e no servidor. TypeScript puro, sem I/O; a
única dependência é o `zod`. Desenho completo e ADRs em `muchat/docs/espaco/`.

## Mapa (`src/map`)

Há um modelo único para todos os servidores (ADR 0005). O lobby fica fixo; à direita sai uma
espinha que cresce para leste; dela saem as alas, as pares para o norte e as ímpares para o sul.
Cada ala é um corredor de 3 tiles com vagas dos dois lados, e cada vaga recebe uma sala P, M ou G
(tamanho pela capacidade na criação, `roomSizeFor`).

- **Template 2 (ADR 0007):** hall de 12×9, primeira ala colada no hall, salas de 7 de profundidade
  em "rua" dos dois lados do corredor (P 7×5, M 7×7, G 7×12), a primeira de cada lado abrindo para
  a espinha, paredes compartilhadas. Vaga livre guarda o tamanho (`roomId: null`); `null` legado
  vale G.
- `generateLayout(input)` é função pura e determinística: a mesma entrada dá o mesmo mapa e o
  mesmo `fingerprint` (FNV-1a, não criptográfico).
- **Estabilidade por construção:** a posição de uma ala depende só do índice dela, e a de uma
  vaga só de (ala, vaga). Acrescentar ala ou sala nunca move nada que já existe; só a espinha e o
  fim dos corredores crescem.
  - Coordenadas de tile com sinal, origem fixa no canto do lobby. As alas do norte crescem para y
    negativo sem deslocar ninguém.
  - Vaga arquivada continua no array como `null`, para o corredor não encolher.
- **Porta:** um tile `Door` na parede do corredor. É limiar neutro: ficar parado ou oscilar nela
  não muda a sala (`nextRoom`).
- **Limites:** 30 alas × 60 vagas. No pior caso (1.800 salas, grade 522×667, 340 KB) o layout sai
  em ~76 ms e o índice em ~2 ms, no PC de desenvolvimento.

## Movimento (`src/move`)

- **`applyMove`** é o servidor validando a posição proposta pelo cliente:
  - **Velocidade:** orçamento de distância que reabastece a 1,25 × 160 px/s e acumula no máximo
    0,5 s. Rajadas da rede passam; teleporte não.
  - **Colisão:** varre todo o segmento em passos de 4 px, então não atravessa parede.
  - **Porta:** conta como parede para quem não pode atravessá-la (`DoorRule`). Quem está dentro
    sempre sai, regra embutida.
  - **Entrar numa sala** exige poder atravessar a porta naquele momento. A checagem é
    independente da geometria, e cobre quem estava em cima do limiar quando a porta trancou: essa
    pessoa sai, mas não entra.
  - **Ordem:** `seq` repetido ou fora de ordem é ignorado; coordenada inválida vira correção.
- **`slide`:** passo do cliente com deslize na parede, para as propostas quase nunca serem
  corrigidas.
- **`findPath`:** A* de 4 vizinhos para o clique e o toque, limitado a 20 mil tiles explorados
  para nunca travar um quadro. Destinos mais longe (do outro lado de um mapa enorme) vão pela
  lista de salas ("Ir para"), que o servidor resolve.

## Decoração (`src/decor`, ADR 0007)

- **Catálogo** (`catalog.ts`): ~80 itens em 8 categorias, só dados (id, nome PT-BR, camada,
  footprint, rotações, sólido, variantes, interação). A arte fica no `space-client`.
- **Zonas** (`zones.ts`): `hall`, `spine`, `wing:<i>`, `room:<id>`; instâncias guardam
  coordenadas relativas à zona.
- **Colocação** (`placement.ts`): `validatePlacement` (zona, chão/parede, sobreposição por camada,
  porta/spawn livres, flood fill até todas as portas), `solidMask` (vira `MapIndex.solid`, que
  colisão, movimento e A* respeitam), `applyDecorOp`, `pruneDecor`, limites e validação de
  `config` (URL http(s), texto, alvo de portal).
- **Tema** (`theme.ts`): `furnish`/`defaultDecor`, mobília padrão determinística por zona e
  tamanho de sala, sempre validada; `defaultFloor` por zona.
- Protocolo: comandos `decor.*` e `avatar.teleport`, evento `decor.changed`, `DecorRights` no
  snapshot (`protocol/messages.ts`).

## Mídia (`src/media`)

Nomes de room (`msp_<sala>_<época>`) e de identity (`sp_<usuário>_<seq>`) e o formato da lease que
o `livekit-gate` lê (ADR 0001 e 0003).

## Testes

```bash
pnpm --filter @muchat/space-core test        # node --test, sem dependência nova
pnpm --filter @muchat/space-core typecheck
```

O teste de propriedade (`map/layout.test.ts`) gera 12 sequências com semente fixa de alas e salas
acrescentadas e arquivadas. A cada passo ele exige que nenhuma sala existente se mova, que nada se
sobreponha, que toda porta seja alcançável a partir do lobby e que os spawns caibam o avatar.
