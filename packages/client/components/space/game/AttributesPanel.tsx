import { For, Show, createMemo, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type ArchetypeId,
  type HeroV5,
  type Stat,
  type VersusRow,
  CLASSES,
  attributePanel,
  balanceHero,
  previewRaise,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { derivedName, statBlurb } from "./gameText";
import {
  type GameLink,
  Btn,
  Delta,
  Muted,
  Notice,
  Panel,
  Row,
  Section,
  Stepper,
  useCommands,
} from "./gameUi";
import {
  type DerivedKey,
  DERIVED_ALL,
  DERIVED_MAIN,
  STAT_ORDER,
  derivedDiff,
  derivedText,
  pct,
  suggestRaise,
} from "./heroModel";

type Add = Partial<Record<Stat, number>>;

/**
 * Atributos (spec §3 e Fase 2): os pontos se marcam antes (− e +, ou a sugestão da classe) e só
 * vão ao servidor no "Confirmar". Cada linha diz quanto custa o próximo ponto (a escada sobe a cada
 * 10 depois do 50); ao lado, os derivados e os % efetivos contra lacaio, elite e chefe do nível,
 * sempre antes → depois do que está marcado.
 */
export function AttributesPanel(props: {
  link: GameLink;
  hero: HeroV5;
  locked: boolean;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [add, setAdd] = createSignal<Add>({});
  const [vsLevel, setVsLevel] = createSignal(props.hero.level);
  const [all, setAll] = createSignal(false);
  const [ok, setOk] = createSignal<string | null>(null);

  const bh = () => balanceHero(props.hero);
  const now = createMemo(() =>
    attributePanel(bh(), { monsterLevel: vsLevel() }),
  );
  const preview = createMemo(() => {
    if (Object.values(add()).every((n) => !n)) return null;
    const r = previewRaise(bh(), add(), { monsterLevel: vsLevel() });
    return r.ok ? r : null;
  });
  const after = () => preview()?.panel ?? now();
  const staged = () => preview()?.spent ?? 0;
  const free = () => now().points.free - staged();
  const marked = () => Object.values(add()).reduce((a, n) => a + (n ?? 0), 0);

  const bump = (s: Stat, n: number) => {
    setOk(null);
    const next = { ...add(), [s]: Math.max(0, (add()[s] ?? 0) + n) };
    const r = previewRaise(bh(), next);
    if (n > 0 && !r.ok) return;
    setAdd(next);
  };
  const nextCost = (s: Stat) =>
    after().rows.find((r) => r.stat === s)!.nextCost;
  const suggest = () => {
    setOk(null);
    const extra = suggestRaise(
      {
        ...props.hero,
        attrs: after().rows.reduce(
          (a, r) => ({ ...a, [r.stat]: r.points }),
          {} as HeroV5["attrs"],
        ),
      },
      free(),
    );
    const next = { ...add() };
    for (const [s, n] of Object.entries(extra))
      next[s as Stat] = (next[s as Stat] ?? 0) + (n ?? 0);
    setAdd(next);
  };
  const confirm = async () => {
    const r = await cmd.run("rpg.attrs", { add: add() });
    if (r?.ok) {
      setOk(t`Pontos confirmados.`);
      setAdd({});
    }
  };

  const keys = (): DerivedKey[] =>
    all() ? DERIVED_ALL : DERIVED_MAIN[props.hero.cls];
  const shares = () =>
    CLASSES[props.hero.cls].referenceBuild
      .map(([s, w]) => `${s} ${w}%`)
      .join(" · ");

  return (
    <Wrap>
      <Head>
        <div>
          <strong>
            {t`Pontos livres`}:{" "}
            <Big data-has={free() > 0 ? "" : undefined}>{free()}</Big>
          </strong>
          <Show when={marked() > 0}>
            <Muted> {t`(${staged()} marcados em ${marked()} subidas)`}</Muted>
          </Show>
        </div>
        <Muted>
          {t`Cada nível dá 5 pontos. Até o 50 cada ponto custa 1; do 51 ao 60 custa 2, do 61 ao 70 custa 3, e assim por diante.`}
        </Muted>
      </Head>

      <Grid>
        <Section aria-label={t`Atributos`}>
          <h3>{t`Distribuir`}</h3>
          <For each={STAT_ORDER}>
            {(s) => {
              const row = () => after().rows.find((r) => r.stat === s)!;
              const mine = () => add()[s] ?? 0;
              return (
                <StatRow data-marked={mine() > 0 ? "" : undefined}>
                  <Name>{s}</Name>
                  <Value>
                    {row().points}
                    <Show when={mine() > 0}>
                      <Plus> (+{mine()})</Plus>
                    </Show>
                    <Show when={row().gear > 0}>
                      <Gear title={t`Dos itens vestidos`}>
                        {" "}
                        +{Math.round(row().gear)}
                      </Gear>
                    </Show>
                  </Value>
                  <Btn
                    type="button"
                    data-size="sm"
                    aria-label={t`Tirar um ponto marcado de ${s}`}
                    disabled={mine() === 0}
                    onClick={() => bump(s, -1)}
                  >
                    −
                  </Btn>
                  <Btn
                    type="button"
                    data-size="sm"
                    data-tone={nextCost(s) <= free() ? "primary" : undefined}
                    aria-label={t`Subir ${s}: o próximo ponto custa ${nextCost(s)}`}
                    disabled={props.locked || nextCost(s) > free()}
                    onClick={() => bump(s, 1)}
                  >
                    + <Cost>{nextCost(s)}</Cost>
                  </Btn>
                  <Btn
                    type="button"
                    data-size="sm"
                    data-tone="quiet"
                    aria-label={t`Subir ${s} 5 vezes`}
                    disabled={props.locked || nextCost(s) > free()}
                    onClick={() => {
                      for (let i = 0; i < 5; i++) bump(s, 1);
                    }}
                  >
                    +5
                  </Btn>
                  <Blurb>{statBlurb(s)}</Blurb>
                </StatRow>
              );
            }}
          </For>
          <Row>
            <Btn
              type="button"
              data-size="sm"
              disabled={props.locked || free() <= 0}
              onClick={suggest}
              title={t`Sugestão da classe: ${shares()}`}
            >
              {t`Distribuir pela sugestão`}
            </Btn>
            <Muted>{t`Sugestão: ${shares()}`}</Muted>
          </Row>
        </Section>

        <Section aria-label={t`O que os atributos dão`}>
          <h3>{t`Antes → depois`}</h3>
          <Panel>
            <For each={derivedDiff(now().derived, after().derived, keys())}>
              {(row) => (
                <Line>
                  <span>{derivedName(row.key)}</span>
                  <Delta
                    a={row.a}
                    b={row.b}
                    dir={row.dir}
                    compact={row.dir === 0}
                    fmt={(n) => derivedText(row.key, n)}
                  />
                </Line>
              )}
            </For>
            <Btn
              type="button"
              data-size="sm"
              data-tone="quiet"
              onClick={() => setAll(!all())}
            >
              {all() ? t`Mostrar só o principal` : t`Ver todos os números`}
            </Btn>
          </Panel>
          <h3>{t`Contra monstros do nível`}</h3>
          <Stepper
            label={t`Nível dos monstros`}
            value={vsLevel()}
            min={1}
            max={500}
            onChange={setVsLevel}
          />
          <Versus now={now().versus} after={after().versus} />
        </Section>
      </Grid>

      <Notice error={cmd.error()} ok={ok()} />
      <Footer>
        <Btn
          type="button"
          data-tone="primary"
          disabled={props.locked || cmd.busy() || marked() === 0}
          onClick={confirm}
        >
          {marked() > 0 ? t`Confirmar ${staged()} pontos` : t`Confirmar`}
        </Btn>
        <Btn type="button" disabled={marked() === 0} onClick={() => setAdd({})}>
          {t`Desfazer`}
        </Btn>
        <Muted>
          {t`Depois de confirmar, só o Mestre da evolução redistribui (a 1ª vez é grátis).`}
        </Muted>
      </Footer>
    </Wrap>
  );
}

/** Crítico, esquiva, erro e reduções contra lacaio, elite e chefe; o "erro" é melhor para baixo. */
function Versus(props: { now: VersusRow[]; after: VersusRow[] }) {
  const { t } = useLingui();
  const arch = (a: ArchetypeId) =>
    a === "lacaio" ? t`Lacaio` : a === "elite" ? t`Elite` : t`Chefe`;
  const rows: {
    label: () => string;
    get: (v: VersusRow) => number;
    lower?: boolean;
    hint?: () => string;
  }[] = [
    { label: () => t`Crítico`, get: (v) => v.crit },
    {
      label: () => t`Esquiva`,
      get: (v) => v.avoid,
      hint: () => t`Contra 1 atacante.`,
    },
    {
      label: () => t`Esquiva cercado`,
      get: (v) => v.avoidSurrounded,
      hint: () => t`Com 4 atacantes em volta.`,
    },
    {
      label: () => t`Erro`,
      get: (v) => v.miss,
      lower: true,
      hint: () => t`Magia e dano sagrado nunca erram.`,
    },
    { label: () => t`Redução física`, get: (v) => v.physicalReduction },
    { label: () => t`Redução mágica`, get: (v) => v.magicReduction },
  ];
  return (
    <Table>
      <thead>
        <tr>
          <th />
          <For each={props.now}>
            {(v) => <th scope="col">{arch(v.archetype)}</th>}
          </For>
        </tr>
      </thead>
      <tbody>
        <For each={rows}>
          {(r) => (
            <tr>
              <th scope="row" title={r.hint?.()}>
                {r.label()}
              </th>
              <For each={props.now}>
                {(v, i) => {
                  const a = () => r.get(v);
                  const b = () => r.get(props.after[i()]!);
                  // Mudou de verdade = mudou o número que a tela mostra (senão "42% → 42% ▲").
                  const moved = () => pct(a()) !== pct(b());
                  return (
                    <td
                      title={moved() ? `${pct(a())} → ${pct(b())}` : undefined}
                    >
                      <Delta
                        a={a()}
                        b={b()}
                        compact
                        dir={!moved() ? 0 : b() > a() !== !!r.lower ? 1 : -1}
                        fmt={pct}
                      />
                    </td>
                  );
                }}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </Table>
  );
}

const Wrap = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    paddingTop: "8px",
  },
});
const Head = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "2px" },
});
const Big = styled("span", {
  base: {
    fontSize: "1.2em",
    fontVariantNumeric: "tabular-nums",
    "&[data-has]": { color: "var(--md-sys-color-primary)" },
  },
});
const Grid = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)",
    gap: "16px",
    "@container (max-width: 640px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
});
const StatRow = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "3em minmax(3.5em, 1fr) auto auto auto",
    gridTemplateRows: "auto auto",
    alignItems: "center",
    columnGap: "6px",
    rowGap: "2px",
    padding: "6px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
    "&[data-marked]": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },
  },
});
const Name = styled("span", {
  base: { fontWeight: 800, letterSpacing: "0.04em" },
});
const Value = styled("span", {
  base: { fontVariantNumeric: "tabular-nums", fontWeight: 700 },
});
const Plus = styled("span", { base: { color: "var(--md-sys-color-primary)" } });
const Gear = styled("span", {
  base: { color: "#9fd0ff", fontWeight: 500, fontSize: "0.85em" },
});
const Cost = styled("small", { base: { fontSize: "0.7em", opacity: 0.85 } });
const Blurb = styled("span", {
  base: {
    gridColumn: "1 / -1",
    fontSize: "0.78em",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
const Line = styled("div", {
  base: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    fontSize: "0.92em",
  },
});
const Table = styled("table", {
  base: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.85em",
    fontVariantNumeric: "tabular-nums",
    "& th, & td": { padding: "4px 6px", textAlign: "right" },
    "& th[scope=row]": { textAlign: "left", fontWeight: 500 },
    "& thead th": {
      color: "var(--md-sys-color-on-surface-variant)",
      fontWeight: 600,
    },
    "& tbody tr:nth-child(odd)": { background: "rgba(255,255,255,0.03)" },
  },
});
const Footer = styled("div", {
  base: {
    position: "sticky",
    bottom: "-20px",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    padding: "10px 0",
    background: "#17140f",
    borderTop: "1px solid var(--md-sys-color-outline-variant)",
    zIndex: 1,
  },
});
