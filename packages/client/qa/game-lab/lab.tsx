/**
 * Laboratório das telas do Idle Hunt v5 (sem servidor): as telas de verdade do app
 * (components/space/game) com o CSS e as traduções do app, sobre um "mapa" de mentira, ligadas a um
 * servidor local (labServer.ts) que aplica cada comando `rpg.*` com as funções puras do núcleo.
 * Cenário pela URL: `#s=ficha`, `#s=corrida-chefe`… (lista à esquerda); `&speed=4` acelera a
 * corrida. As capturas de desktop e celular saem de `shots.mjs`.
 */
import "material-symbols";
import "../../src/index.css";

import {
  For,
  Match,
  Show,
  Suspense,
  Switch,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
} from "solid-js";
import { render } from "solid-js/web";

import type { SpaceView } from "@muchat/space-client";
import type { NewsWire, NpcKind } from "@muchat/space-core";
import {
  LEGENDARIES,
  createHero,
  generateItem,
  materialOf,
} from "@muchat/space-core/game/ot/balance";

import { I18nProvider } from "../../components/i18n";
import HeroSheet from "../../components/space/game/HeroSheet";
import LobbyChip from "../../components/space/game/LobbyChip";
import ChestDialog from "../../components/space/game/ChestDialog";
import NpcDialog from "../../components/space/game/NpcDialog";
import RunChip from "../../components/space/game/RunChip";
import RunMeter from "../../components/space/game/RunMeter";
import RunPanel from "../../components/space/game/RunPanel";
import TrainingChip from "../../components/space/game/TrainingChip";
import TrainingDialog from "../../components/space/game/TrainingDialog";
import TvMenu from "../../components/space/game/TvMenu";
import { myLobby } from "../../components/space/game/partyUi";
import { type LabWorld, LabServer, emptyChest } from "./labServer";
import {
  CLEARED_REGION1,
  CLEARED_SOME,
  PEOPLE,
  boardRuns,
  grow,
  hunter52,
  lobbyOf,
  mage45,
  mage45Perks,
  newUid,
  stateOf,
  stuffBag,
} from "./scenarios";

// Preguiçoso como no app. O markdown do app tem um ciclo de import que só fecha entrando pelo
// editor (prosemirror); importado direto pelo painel, cai em "unifiedPipeline before initialization".
const NewsPanel = lazy(() =>
  import("../../components/markdown/prosemirror/from-model").then(
    () => import("../../components/space/NewsPanel"),
  ),
);

type Screen =
  | "hero"
  | "npc"
  | "dojo"
  | "tv"
  | "run"
  | "map"
  | "news"
  | "arsenal"
  | "bau";

/** O quadro de avisos sem o space-server: só o que o painel lê da vista. */
const NEWS: NewsWire = {
  url: "https://outline.example/novidades",
  items: [
    {
      id: "n4",
      title: "Arsenal: todos os itens do jogo",
      publishedAt: "2026-11-27T13:30:00Z",
      markdown:
        "Todas as bases de item nas 5 raridades, os lendários e quem usa cada um.\n\n[Abrir o Arsenal](https://chat.muhbianco.com.br/#arsenal)",
    },
    {
      id: "n3",
      title: "Janelas do jogo arrastáveis",
      publishedAt: "2026-11-25T15:00:00Z",
      markdown:
        "Agora dá para **arrastar** a ficha, a corrida e os NPCs pela barra do título.\n\n- Duplo clique na barra volta ao lugar.\n- No celular a janela continua de tela cheia.",
    },
    {
      id: "n2",
      title: "Tela da corrida nova",
      publishedAt: "2026-11-24T18:00:00Z",
      markdown:
        "Vida e mana nos globos, cinto de poções e as habilidades com recarga.",
    },
    {
      id: "n1",
      title: "Idle Hunt: recomeço",
      publishedAt: "2026-11-20T12:00:00Z",
      markdown: "O jogo recomeçou com a engine nova.",
    },
  ],
};
const newsView = {
  news: async () => NEWS,
  setNewsUnread: () => {},
} as unknown as SpaceView;
/** A estante do Arsenal não busca as novidades: se buscar, o cenário acusa. */
const shelfView = {
  news: () =>
    Promise.reject(new Error("a estante do Arsenal não busca as novidades")),
  setNewsUnread: () => {},
} as unknown as SpaceView;

interface Scenario {
  id: string;
  label: string;
  screen: Screen;
  npc?: NpcKind;
  build: () => LabWorld;
  /** O baú compartilhado (`screen: "bau"`): o que já está nele e o histórico. */
  chest?: (srv: LabServer) => void;
  run?: { dungeon: string; seek?: number | "chefe" | "fim" };
}

const world = (
  hero: LabWorld["rpg"]["hero"],
  extra: Partial<LabWorld> = {},
): LabWorld => ({
  rpg: { hero, serverNow: Date.now(), at: Date.now(), rev: 1 },
  lobbies: {},
  runs: {},
  runOpen: null,
  notice: null,
  ...extra,
});

const party4 = () =>
  lobbyOf("masmorra-40", [
    { id: "u-ana", name: "Ana", cls: "mago", level: 45 },
    { id: "u-bia", name: "Bia", cls: "guerreiro", level: 44 },
    { id: "u-caio", name: "Caio", cls: "padre", level: 43 },
    { id: "u-duda", name: "Duda", cls: "cacador", level: 44 },
  ]);

const SCENARIOS: Scenario[] = [
  {
    id: "novo",
    label: "Jogador novo (wipe)",
    screen: "hero",
    build: () => world(null),
  },
  {
    id: "nivel1",
    label: "Nível 1, kit inicial",
    screen: "hero",
    build: () => world(stateOf(createHero("guerreiro", newUid))),
  },
  {
    id: "ficha",
    label: "Ficha (mago 45)",
    screen: "hero",
    build: () => world(stateOf(mage45())),
  },
  {
    id: "ficha-perks",
    label: "Ficha com perks lendários",
    screen: "hero",
    build: () => world(stateOf(mage45Perks())),
  },
  {
    id: "mercador",
    label: "Mercador",
    screen: "npc",
    npc: "mercador",
    build: () => world(stateOf(mage45())),
  },
  {
    id: "mercador-cacador",
    label: "Mercador (caçador)",
    screen: "npc",
    npc: "mercador",
    build: () => world(stateOf(hunter52())),
  },
  {
    id: "ferreiro",
    label: "Ferreiro",
    screen: "npc",
    npc: "ferreiro",
    build: () => world(stateOf(mage45())),
  },
  {
    id: "ferreiro-pedra",
    label: "Ferreiro (uma Pedra, ouro e minério de sobra)",
    screen: "npc",
    npc: "ferreiro",
    // A caixa da Pedra não passa de um item para outro nem fica presa quando a pedra acaba (26/11/2026).
    build: () => {
      const h = mage45();
      const ores = Object.fromEntries(
        [...h.bag, ...Object.values(h.equipment)]
          .filter((x) => !!x)
          .map((x) => [materialOf(x!.ilvl), 9999]),
      );
      return world(stateOf({ ...h, gold: 1e9, stones: 1, ores }));
    },
  },
  {
    id: "ferreiro-perk",
    label: "Ferreiro (perk lendário, 25 Essências)",
    screen: "npc",
    npc: "ferreiro",
    // 27/11/2026: o perk do lendário rola numa skill da classe de quem rola. O Cajado da Aurora (perk
    // do Padre) num mago: o perk dele não vale até rolar.
    build: () => {
      const h = mage45();
      let seed = 7;
      const rng = {
        next: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
      };
      const mk = (id: string) => {
        const def = LEGENDARIES.find((l) => l.id === id)!;
        return {
          ...generateItem(def.base, 45, "lendario", rng),
          legendary: id,
          uid: `lab-${id}`,
        };
      };
      const bag = [...h.bag, mk("cajado-da-aurora"), mk("cetro-das-cinzas")];
      return world(stateOf({ ...h, essence: 25, bag }));
    },
  },
  {
    id: "ferreiro-suprema",
    label: "Ferreiro (Arma Suprema: 5 espadas Lendárias iguais)",
    screen: "npc",
    npc: "ferreiro",
    // D68 (27/11/2026): 5 espadas Lendárias do iL 200 (uma vestida, de +9, e uma de +7 na mochila) e
    // 2 do iL 190 (grupo incompleto), para a forja da Suprema.
    build: () => {
      const h = grow("guerreiro", 200, 30);
      let seed = 11;
      const rng = {
        next: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
      };
      let k = 0;
      const sword = (ilvl: number, refine: number) => ({
        ...generateItem(
          { slot: "arma", family: "espada" },
          ilvl,
          "lendario",
          rng,
        ),
        perks: [{ skill: "grito-de-guerra", value: 0.5 }],
        refine,
        uid: `lab-espada-${k++}`,
      });
      const worn = sword(200, 9);
      const bag = [
        sword(200, 0),
        sword(200, 7),
        sword(200, 2),
        sword(200, 0),
        sword(190, 0),
        sword(190, 3),
        ...h.bag,
      ];
      return world(
        stateOf({
          ...h,
          essence: 6,
          bag,
          equipment: { ...h.equipment, arma: worn } as typeof h.equipment,
        }),
      );
    },
  },
  {
    id: "ferreiro-corrida",
    label: "Ferreiro (na corrida)",
    screen: "npc",
    npc: "ferreiro",
    // O herói numa dungeon: só o desmonte vale (26/11/2026).
    build: () =>
      world(
        stateOf(stuffBag(mage45(), 8), {
          run: {
            id: "lab-run",
            dungeon: "masmorra-40",
            ends_at: Date.now() + 10 * 60_000,
          },
        }),
      ),
  },
  {
    id: "bau",
    label: "Baú compartilhado (com itens)",
    screen: "bau",
    // O baú do servidor (28/11/2026): itens de outras classes, um +7 e um Lendário na mochila de Ana.
    build: () => {
      const h = mage45();
      const bag = h.bag.map((x, i) =>
        i === 0 ? { ...x, refine: 7 } : i === 1 ? { ...x, rarity: "lendario" as const } : x,
      );
      return world(stateOf({ ...h, bag }));
    },
    chest: (srv) => {
      const items = stuffBag(mage45(), 18, 31).bag.slice(-18);
      const t0 = Date.now() - 3 * 3600_000;
      // Idades variadas: o selo do canto mostra 4d, 1d, horas e minutos até sumir.
      const day = 24 * 3600_000;
      const ages = [10 * 60_000, 2 * 3600_000, 20 * 3600_000, 2 * day, 4 * day + 23 * 3600_000];
      srv.chest = {
        rev: 3,
        items,
        put_at: Object.fromEntries(
          items.map((x, i) => [x.uid, Date.now() - ages[i % ages.length]!]),
        ),
        gold: 12_500,
        log: [
          srv.chestLog("Caio", "pegou", items.slice(0, 1), t0 + 2 * 3600_000),
          srv.chestLog("Bia", "pos", items.slice(10, 18), t0 + 3600_000),
          srv.chestLog("Caio", "pos", items.slice(0, 10), t0),
        ],
      };
    },
  },
  {
    id: "bau-vazio",
    label: "Baú compartilhado (vazio)",
    screen: "bau",
    build: () => world(stateOf(mage45())),
    chest: (srv) => {
      srv.chest = emptyChest();
    },
  },
  {
    id: "banqueiro",
    label: "Mula (antes Banqueiro)",
    screen: "npc",
    npc: "banqueiro",
    build: () => world(stateOf(mage45())),
  },
  {
    id: "mochila-300",
    label: "Mochila com 300 itens (sem limite)",
    screen: "hero",
    // A mochila não tem limite (28/11/2026): busca e páginas de 60 na ficha.
    build: () => world(stateOf(stuffBag(mage45(), 300, 5))),
  },
  {
    id: "mestre",
    label: "Mestre da evolução",
    screen: "npc",
    npc: "mestre",
    build: () => world(stateOf(mage45())),
  },
  {
    id: "mestre-evoluir",
    label: "Mestre (pronto para T2)",
    screen: "npc",
    npc: "mestre",
    build: () => world(stateOf({ ...grow("padre", 22, 20), gold: 1200 })),
  },
  {
    id: "dojo",
    label: "Dojô (treinando)",
    screen: "dojo",
    build: () => {
      const h = mage45();
      return world(
        stateOf(
          { ...h, dojo: { since: Date.now() - 95_000 } },
          { dojo: { instance: "boneco-1", since: Date.now() - 95_000 } },
        ),
      );
    },
  },
  {
    id: "tv",
    label: "TV (catálogo)",
    screen: "tv",
    build: () => world(stateOf(mage45(), { cleared: CLEARED_SOME })),
  },
  {
    id: "tv-grupo",
    label: "TV (meu grupo)",
    screen: "tv",
    build: () =>
      world(stateOf(mage45(), { cleared: CLEARED_SOME }), {
        lobbies: {
          x: lobbyOf("masmorra-40", [
            { id: "u-ana", name: "Ana", cls: "mago", level: 45 },
            { id: "u-bia", name: "Bia", cls: "guerreiro", level: 44 },
            { id: "u-caio", name: "Caio", cls: "cacador", level: 33 },
          ]),
        },
      }),
  },
  {
    id: "tv-cacada-5",
    label: "TV (Caçada com 5)",
    screen: "tv",
    // 27/11/2026: a Caçada abriu para 5; o drop do grupo cresce e o Lendário aparece com 4 e 5.
    build: () =>
      world(stateOf(mage45(), { cleared: CLEARED_SOME }), {
        lobbies: {
          x: lobbyOf("cacada-40", [
            { id: "u-ana", name: "Ana", cls: "mago", level: 45 },
            { id: "u-bia", name: "Bia", cls: "guerreiro", level: 44 },
            { id: "u-caio", name: "Caio", cls: "cacador", level: 43 },
            { id: "u-duda", name: "Duda", cls: "padre", level: 42 },
            { id: "u-edu", name: "Edu", cls: "assassino", level: 41 },
          ]),
        },
      }),
  },
  {
    id: "tv-chefe",
    label: "TV (chefe, região concluída)",
    screen: "tv",
    // A região 1 inteira concluída: o Rei Javali abre; Bia ainda não concluiu (o aviso no grupo).
    build: () =>
      world(stateOf(mage45(), { cleared: CLEARED_REGION1 }), {
        lobbies: {
          x: lobbyOf("regiao-1", [
            { id: "u-ana", name: "Ana", cls: "mago", level: 45, regions: [1] },
            {
              id: "u-bia",
              name: "Bia",
              cls: "guerreiro",
              level: 47,
              regions: [],
            },
          ]),
        },
      }),
  },
  {
    id: "corrida",
    label: "Corrida (sala 1)",
    screen: "run",
    build: () => world(stateOf(mage45()), { lobbies: { x: party4() } }),
    run: { dungeon: "masmorra-40", seek: 4 },
  },
  {
    id: "corrida-perks",
    label: "Corrida com perks lendários",
    screen: "run",
    build: () => world(stateOf(mage45Perks()), { lobbies: { x: party4() } }),
    run: { dungeon: "masmorra-40", seek: 4 },
  },
  {
    id: "efeitos",
    label: "Efeitos das skills (vitrine)",
    screen: "run",
    // Fase 1 dos efeitos (26/11/2026): Meteoro, Raio em Cadeia, Nevasca, Redemoinho, Consagração,
    // Nuvem Tóxica, Chuva de Flechas e os escudos, cada herói com o kit fixo e tudo saindo sempre.
    build: () =>
      world(stateOf(grow("mago", 75, 46)), {
        lobbies: {
          x: lobbyOf("masmorra-70", [
            { id: "u-ana", name: "Ana", cls: "mago", level: 75 },
            { id: "u-bia", name: "Bia", cls: "guerreiro", level: 75 },
            { id: "u-caio", name: "Caio", cls: "paladino", level: 75 },
            { id: "u-duda", name: "Duda", cls: "assassino", level: 75 },
            { id: "u-eva", name: "Eva", cls: "cacador", level: 75 },
          ]),
        },
        kits: {
          "u-ana": ["meteoro", "raio-em-cadeia", "nevasca", "escudo-de-mana"],
          "u-bia": [
            "redemoinho",
            "golpe-provocador",
            "grito-de-guerra",
            "muralha-de-ferro",
          ],
          "u-caio": [
            "consagracao",
            "golpe-sagrado",
            "escudo-da-fe",
            "bencao-da-egide",
          ],
          "u-duda": [
            "fumaca",
            "lamina-envenenada",
            "sequencia-letal",
            "esquiva-sombria",
          ],
          "u-eva": [
            "chuva-de-flechas",
            "rajada-dupla",
            "marca-do-cacador",
            "tiro-perfurante",
          ],
        },
      }),
    run: { dungeon: "masmorra-70", seek: 3 },
  },
  {
    id: "corrida-chefe",
    label: "Corrida (chefe, Cataclismo)",
    screen: "run",
    // Grupo sem dano: o chefe não cai a tempo e o Cataclismo cresce (D24).
    build: () =>
      world(
        stateOf({
          ...grow("padre", 52, 32),
          potions: {
            hp: { pequena: 100, media: 0, grande: 0 },
            mp: { pequena: 100, media: 0, grande: 0 },
          },
        }),
        {
          lobbies: {
            x: lobbyOf("masmorra-40", [
              { id: "u-ana", name: "Ana", cls: "padre", level: 52 },
              { id: "u-bia", name: "Bia", cls: "guerreiro", level: 52 },
              { id: "u-caio", name: "Caio", cls: "druida", level: 52 },
              { id: "u-duda", name: "Duda", cls: "paladino", level: 52 },
            ]),
          },
        },
      ),
    run: { dungeon: "masmorra-40", seek: "chefe" },
  },
  {
    id: "corrida-invocacao",
    label: "Corrida (chefe que invoca)",
    screen: "run",
    // A Invocação só entra no chefe do 70 (§12.3): o corrida-chefe, na 40, não a mostrava (28/11/2026).
    build: () =>
      world(stateOf(grow("mago", 85, 50)), {
        lobbies: {
          x: lobbyOf("masmorra-70", [
            { id: "u-ana", name: "Ana", cls: "mago", level: 85 },
            { id: "u-bia", name: "Bia", cls: "guerreiro", level: 85 },
            { id: "u-caio", name: "Caio", cls: "padre", level: 85 },
            { id: "u-duda", name: "Duda", cls: "cacador", level: 85 },
          ]),
        },
      }),
    run: { dungeon: "masmorra-70", seek: "chefe" },
  },
  {
    id: "corrida-fim",
    label: "Corrida (fim)",
    screen: "run",
    build: () => world(stateOf(mage45()), { lobbies: { x: party4() } }),
    run: { dungeon: "masmorra-40", seek: "fim" },
  },
  {
    id: "avisos",
    label: "Quadro de avisos",
    screen: "news",
    build: () => world(stateOf(mage45())),
  },
  {
    id: "estante",
    label: "Estante do Arsenal",
    screen: "arsenal",
    build: () => world(stateOf(mage45())),
  },
  {
    id: "mapa",
    label: "Faixas no mapa",
    screen: "map",
    build: () => {
      const h = mage45();
      return world(
        stateOf(
          { ...h, dojo: { since: Date.now() - 400_000 } },
          { dojo: { instance: "boneco-1", since: Date.now() - 400_000 } },
        ),
        {
          lobbies: {
            x: {
              ...party4(),
              loop: true,
              state: "ready",
              runs: 3,
              last: "vitoria",
            },
          },
        },
      );
    },
  },
];

function params() {
  const p = new URLSearchParams(location.hash.slice(1));
  const speed = Number(p.get("speed") ?? "1");
  // &peers=3: quantos treinam junto no Dojô (o bônus na faixa e no boneco).
  const peers = Number(p.get("peers") ?? "0");
  return {
    s: p.get("s") ?? "ficha",
    speed: Number.isFinite(speed) ? speed : 1,
    peers: Number.isFinite(peers) ? peers : 0,
  };
}

function Lab() {
  const [w, setW] = createSignal<LabWorld>(world(null));
  const [screen, setScreen] = createSignal<Screen>("hero");
  const [npc, setNpc] = createSignal<NpcKind>("mercador");
  const [open, setOpen] = createSignal(true);
  // A janela do NPC como no app (SpacePage): o pedido vem de um sinal e chega pela Match; fechar
  // zera o pedido (closeNpcRequest), e o `request()` da Match fica velho enquanto a janela é
  // descartada. Com o pedido fixo, o laboratório não via o travamento de 27/11/2026.
  const [npcReq, setNpcReq] = createSignal<{
    instance: string;
    title: string;
    npc: NpcKind;
  } | null>(null);
  // Um estado só, como o `ui()` do app: o pedido e o herói mudam juntos (fechar invalida os dois).
  const ui = createMemo(() => ({ ...w(), npcRequest: npcReq() }));
  const askNpc = (kind: NpcKind) =>
    setNpcReq({ instance: `npc-${kind}`, title: "", npc: kind });
  const [meter, setMeter] = createSignal(false);
  const server = new LabServer(w(), setW, params().speed);
  // Para os testes pelo navegador: `labServer.chestOther()` simula outra pessoa pegando do baú.
  (globalThis as { labServer?: LabServer }).labServer = server;
  const load = () => {
    const { s, speed } = params();
    const sc = SCENARIOS.find((x) => x.id === s) ?? SCENARIOS[2]!;
    server.speed = speed;
    server.load(sc.build());
    server.chest = emptyChest();
    sc.chest?.(server);
    server.chestFar = new URLSearchParams(location.hash.slice(1)).get("longe") === "1";
    setScreen(sc.screen);
    if (sc.npc) setNpc(sc.npc);
    setOpen(true);
    if (sc.screen === "npc" && sc.npc) askNpc(sc.npc);
    else setNpcReq(null);
    if (sc.run) {
      const l = Object.values(server.current.lobbies)[0]!;
      server.startRun(l, { seek: sc.run.seek });
    }
    document.title = `Idle Hunt · ${sc.label}`;
  };
  load();
  const onHash = () => load();
  window.addEventListener("hashchange", onHash);
  onCleanup(() => window.removeEventListener("hashchange", onHash));
  const current = () => params().s;
  const run = () => (w().runOpen ? (w().runs[w().runOpen!] ?? null) : null);
  const mine = () => myLobby(w().lobbies, server.me);
  return (
    <Page>
      <nav aria-label="Cenários">
        <strong>Idle Hunt · laboratório</strong>
        <select
          aria-label="Cenário"
          value={current()}
          onChange={(e) => (location.hash = `s=${e.currentTarget.value}`)}
        >
          <For each={SCENARIOS}>
            {(s) => <option value={s.id}>{s.label}</option>}
          </For>
        </select>
        <ul>
          <For each={SCENARIOS}>
            {(s) => (
              <li>
                <a
                  href={`#s=${s.id}`}
                  aria-current={current() === s.id ? "page" : undefined}
                >
                  {s.label}
                </a>
              </li>
            )}
          </For>
        </ul>
      </nav>
      <main class="map" data-testid="map">
        <div class="chips">
          <Show when={w().rpg.hero?.dojo ? w().rpg : null}>
            {(rpg) => (
              <TrainingChip link={server} rpg={rpg()} peers={params().peers} />
            )}
          </Show>
          <Show when={Object.keys(w().lobbies).length > 0}>
            <LobbyChip link={server} lobbies={w().lobbies} myId={server.me} />
          </Show>
          <Show when={Object.keys(w().runs).length > 0}>
            <RunChip link={server} runs={w().runs} myId={server.me} />
          </Show>
          <button
            type="button"
            class="reopen"
            onClick={() => {
              setOpen(true);
              if (screen() === "npc") askNpc(npc());
            }}
          >
            Abrir a tela
          </button>
        </div>
        <Show when={w().notice}>
          <p class="notice">{w().notice}</p>
        </Show>
        <Show when={open()}>
          <Switch>
            <Match when={screen() === "hero"}>
              <HeroSheet
                link={server}
                rpg={w().rpg}
                name="Ana"
                onClose={() => setOpen(false)}
              />
            </Match>
            <Match when={screen() === "npc" ? ui().npcRequest : null}>
              {(request) => (
                <NpcDialog
                  link={server}
                  request={request()}
                  rpg={ui().rpg}
                  people={PEOPLE}
                  onClose={() => setNpcReq(null)}
                />
              )}
            </Match>
            <Match when={screen() === "bau" && open()}>
              <ChestDialog
                link={server}
                request={{ instance: "bau-1", title: "Baú compartilhado" }}
                rpg={w().rpg}
                onClose={() => setOpen(false)}
              />
            </Match>
            <Match when={screen() === "dojo"}>
              <TrainingDialog
                link={server}
                request={{ instance: "boneco-1", title: "Boneco de treino" }}
                rpg={w().rpg}
                peers={params().peers}
                onClose={() => setOpen(false)}
              />
            </Match>
            <Match when={screen() === "tv"}>
              <TvMenu
                link={server}
                request={{ instance: "tv-1", title: "Smart TV" }}
                hero={w().rpg.hero}
                lobbies={Object.values(w().lobbies).filter(
                  (l) => l.tv === "tv-1",
                )}
                mine={mine()}
                board={{ lobbies: [], runs: boardRuns(), at: Date.now() }}
                roomTitle={(r) =>
                  r === "sala-2" ? "Sala da Diretoria" : "Sala do Lab"
                }
                myId={server.me}
                onClose={() => setOpen(false)}
              />
            </Match>
            <Match when={screen() === "news"}>
              <Suspense>
                <NewsPanel
                  view={newsView}
                  title="Quadro de avisos"
                  onClose={() => setOpen(false)}
                />
              </Suspense>
            </Match>
            <Match when={screen() === "arsenal"}>
              <Suspense>
                <NewsPanel
                  view={shelfView}
                  title="Arsenal"
                  mode="arsenal"
                  onClose={() => setOpen(false)}
                />
              </Suspense>
            </Match>
            <Match when={screen() === "run" && run()}>
              <RunPanel
                state={run()!}
                myId={server.me}
                hero={w().rpg.hero}
                link={server}
                lobby={mine()}
                onClose={() => setOpen(false)}
                meterOpen={meter()}
                onMeter={() => setMeter(!meter())}
              />
              <Show when={meter()}>
                <RunMeter
                  state={run()!}
                  myId={server.me}
                  link={server}
                  onClose={() => setMeter(false)}
                />
              </Show>
            </Match>
          </Switch>
        </Show>
      </main>
    </Page>
  );
}

function Page(props: { children: unknown }) {
  return <div class="lab">{props.children as never}</div>;
}

const root = document.getElementById("root")!;
render(
  () => (
    <I18nProvider>
      <Lab />
    </I18nProvider>
  ),
  root,
);
