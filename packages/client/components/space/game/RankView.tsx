import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type RpgRankEvent,
  type RpgRankRow,
  CLASSES,
  dungeonById,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { CLASS_ICON } from "./RunHud";
import { kindName } from "./gameText";
import { type GameLink, Muted, Notice, Tabs, useCommands } from "./gameUi";
import { dungeonName } from "./partyUi";

type Rank = RpgRankEvent["d"];

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

/**
 * O ranking do espaço (28/11/2026, o dono: "rank solo, quem vai mais longe nas DGs; rank grupo, as
 * comps que foram mais longe até agora; top 10 de cada"): a DG mais difícil que cada herói venceu
 * sozinho e que cada grupo venceu junto, em todo o Muchat, com o servidor de cada um ("rank é global,
 * entre todos os servidores; informe de qual servidor é o herói"). O servidor guarda o recorde (só
 * sobe) e manda o top 10;
 * empate, quem chegou antes. Mostra o que os jogadores fizeram, nada calculado.
 */
export default function RankView(props: {
  link: GameLink;
  myId: string | null;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [tab, setTab] = createSignal<"solo" | "grupo">("solo");
  const [data, setData] = createSignal<Rank | null>(null);
  let alive = true;
  onCleanup(() => (alive = false));
  const load = async () => {
    const r = await cmd.run("rpg.rank", {});
    if (alive && r?.ok) setData(r.e.d as unknown as Rank);
  };
  onMount(() => {
    void load();
    // Aberto na TV, acompanha as vitórias novas (o servidor guarda o ranking por 30 s).
    const id = setInterval(() => void load(), 30_000);
    onCleanup(() => clearInterval(id));
  });
  const rows = () => (tab() === "solo" ? data()?.solo : data()?.grupo) ?? [];
  const mine = (r: RpgRankRow) =>
    !!props.myId && r.members.some((m) => m.user_id === props.myId);

  return (
    <Wrap>
      <Tabs
        label={t`Ranking`}
        value={tab()}
        onChange={setTab}
        items={[
          { id: "solo", label: t`Sozinho` },
          { id: "grupo", label: t`Em grupo` },
        ]}
      />
      <Muted>
        {tab() === "solo"
          ? t`A dungeon mais difícil que cada herói venceu sozinho, em todos os servidores do Muchat. Empate: quem chegou antes.`
          : t`A dungeon mais difícil que cada grupo venceu junto, em todos os servidores do Muchat. Empate: quem chegou antes.`}
      </Muted>
      <Notice error={cmd.error()} />
      <Show
        when={data()}
        fallback={<Muted role="status">{t`Carregando o ranking…`}</Muted>}
      >
        <Show
          when={rows().length > 0}
          fallback={
            <Muted role="status">
              {tab() === "solo"
                ? t`Ninguém venceu uma dungeon sozinho ainda.`
                : t`Nenhum grupo venceu uma dungeon ainda.`}
            </Muted>
          }
        >
          <List
            aria-label={
              tab() === "solo" ? t`Ranking sozinho` : t`Ranking em grupo`
            }
          >
            <For each={rows()}>
              {(r, i) => {
                const d = dungeonById(r.dungeon);
                return (
                  <Item
                    data-mine={mine(r) ? "" : undefined}
                    data-top={i() < 3 ? String(i() + 1) : undefined}
                  >
                    <Pos aria-label={t`${i() + 1}º lugar`}>{i() + 1}</Pos>
                    <Who>
                      <For each={r.members}>
                        {(m) => (
                          <Member
                            title={t`${m.name}: ${CLASSES[m.cls].titles[0]}, nível ${m.level}`}
                            data-me={m.user_id === props.myId ? "" : undefined}
                          >
                            <Symbol size={14}>{CLASS_ICON[m.cls]}</Symbol>
                            <span>{m.name}</span>
                            <small>{t`Nv ${m.level}`}</small>
                          </Member>
                        )}
                      </For>
                    </Who>
                    <Where>
                      <strong>{dungeonName(r.dungeon)}</strong>
                      <small>
                        {/* O nome da Caçada e da Masmorra já tem o tipo e o nível; o da Região é o do chefe. */}
                        {d?.kind === "regional"
                          ? `${kindName(d.kind)} · ${t`nível ${d.level}`} · `
                          : ""}
                        {dateFmt.format(r.at)}
                      </small>
                      <Server title={t`Servidor onde a corrida aconteceu`}>
                        <Symbol size={12}>dns</Symbol>
                        {r.server.name ?? t`servidor que não existe mais`}
                      </Server>
                    </Where>
                  </Item>
                );
              }}
            </For>
          </List>
        </Show>
      </Show>
    </Wrap>
  );
}

const Wrap = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 },
});
const List = styled("ol", {
  base: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
});
const Item = styled("li", {
  base: {
    display: "grid",
    gridTemplateColumns: "28px minmax(0, 1fr) minmax(0, auto)",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
    "&[data-mine]": { boxShadow: "0 0 0 2px #d9b45a inset" },
    "@media (max-width: 520px)": {
      gridTemplateColumns: "28px minmax(0, 1fr)",
      "& > :last-child": { gridColumn: "2" },
    },
  },
});
const Pos = styled("span", {
  base: {
    fontWeight: 800,
    fontSize: "1.05rem",
    textAlign: "center",
    fontVariantNumeric: "tabular-nums",
    "[data-top='1'] &": { color: "#e8c35a" },
    "[data-top='2'] &": { color: "#c9d1dc" },
    "[data-top='3'] &": { color: "#d39a64" },
  },
});
const Who = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "4px 10px", minWidth: 0 },
});
const Member = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    minWidth: 0,
    "& > span": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontWeight: 600,
    },
    "& > small": { opacity: 0.7, fontSize: "0.75em", whiteSpace: "nowrap" },
    "&[data-me] > span": { color: "#e8c35a" },
  },
});
const Where = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    textAlign: "right",
    minWidth: 0,
    "& > strong": { fontSize: "0.85rem" },
    "& > small": { opacity: 0.75, fontSize: "0.75rem", whiteSpace: "nowrap" },
    "@media (max-width: 520px)": {
      alignItems: "flex-start",
      textAlign: "left",
    },
  },
});

const Server = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    fontSize: "0.72rem",
    opacity: 0.8,
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
