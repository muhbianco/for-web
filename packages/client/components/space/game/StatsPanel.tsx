import { createMemo, createSignal, For, Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type RpgHeroView,
  type StatId,
  type Stats,
  POINTS_PER_LEVEL,
  STAT_SOFT,
  statCost,
  statPointsSpent,
  STATS,
  statValue,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { Button } from "@revolt/ui";

import { heroDerived, num, statInfo } from "./heroUi";

/**
 * O painel de atributos (24/11/2026, "iguais ao do Ragnarok"): os seis atributos com o "+" de
 * cada um, os pontos livres e o que eles dão. Os pontos ficam marcados até "Confirmar" (o
 * servidor só recebe a soma); o que já foi posto só volta no Mestre. Desde o rework do mesmo
 * dia não há teto: cada "+" mostra quanto custa (a escada de 10 em 10) e, passado o 100, o
 * quanto o atributo vale nas contas (a escada de ganho).
 */
export function StatsPanel(props: {
  hero: RpgHeroView;
  busy: boolean;
  locked: boolean;
  send: (type: string, d: Record<string, unknown>) => void;
}) {
  const { t } = useLingui();
  const info = statInfo();
  const [add, setAdd] = createSignal<Partial<Record<StatId, number>>>({});
  const preview = createMemo((): Stats => {
    const s = { ...props.hero.stats };
    for (const k of STATS) s[k] += add()[k] ?? 0;
    return s;
  });
  // Os pontos marcados: o custo da escada do que já está posto até o marcado.
  const used = () =>
    statPointsSpent(preview()) - statPointsSpent(props.hero.stats);
  const marked = () => Object.values(add()).reduce((n, v) => n + (v ?? 0), 0);
  const free = () => props.hero.stat_points - used();
  /** O custo do próximo "+" de `k` (a partir do valor com os marcados). */
  const nextCost = (k: StatId) => statCost(preview()[k]);
  const now = () => heroDerived(props.hero, props.hero.stats);
  const next = () => heroDerived(props.hero, preview());
  const bump = (k: StatId, n: number) => {
    const v = (add()[k] ?? 0) + n;
    if (v < 0) return;
    if (n > 0 && nextCost(k) > free()) return;
    setAdd({ ...add(), [k]: v });
  };
  const confirm = () => {
    const d: Partial<Record<StatId, number>> = {};
    for (const k of STATS) if ((add()[k] ?? 0) > 0) d[k] = add()[k];
    props.send("rpg.stats", { add: d });
    setAdd({});
  };

  /** "12 → 15" quando os pontos marcados mudam o número. */
  const pair = (a: string, b: string) =>
    a === b ? (
      <strong>{a}</strong>
    ) : (
      <strong>
        {a} <Up>→ {b}</Up>
      </strong>
    );

  const rows = () => {
    const a = now();
    const b = next();
    return [
      {
        label: t`ATQ base`,
        hint: t`Corpo a corpo: FOR + (FOR/10)² + DES/5 + SOR/5. Cada ponto é +0,4% de dano da arma.`,
        a: `${Math.floor(a.d.atk)} (+${num(a.d.meleePct)}%)`,
        b: `${Math.floor(b.d.atk)} (+${num(b.d.meleePct)}%)`,
      },
      {
        label: t`ATQ à distância`,
        hint: t`Arco e besta: DES + (DES/10)² + FOR/5 + SOR/5.`,
        a: `${Math.floor(a.d.atkRanged)} (+${num(a.d.rangedPct)}%)`,
        b: `${Math.floor(b.d.atkRanged)} (+${num(b.d.rangedPct)}%)`,
      },
      {
        label: t`MATQ`,
        hint: t`Magias, curas e varinhas: INT + (INT/7)² até INT + (INT/5)². Cada ponto é +0,15%.`,
        a: `${Math.floor(a.d.matk[0])}~${Math.floor(a.d.matk[1])}`,
        b: `${Math.floor(b.d.matk[0])}~${Math.floor(b.d.matk[1])}`,
      },
      {
        label: t`Vida`,
        hint: t`× (1 + VIT/100)`,
        a: String(a.health),
        b: String(b.health),
      },
      {
        label: t`Mana`,
        hint: t`× (1 + INT/100)`,
        a: String(a.mana),
        b: String(b.mana),
      },
      {
        label: t`Esquiva`,
        hint: t`Level + AGI contra o acerto do monstro (2 × o level dele). Cai com 3 ou mais monstros em cima.`,
        a: String(a.d.flee),
        b: String(b.d.flee),
      },
      {
        label: t`Esquiva perfeita`,
        hint: t`(SOR + 10)/10: escapa de qualquer golpe normal. Nunca passa de 40%.`,
        a: `${num(a.d.perfectDodge)}%`,
        b: `${num(b.d.perfectDodge)}%`,
      },
      {
        label: t`Crítico`,
        hint: t`1% + SOR/3: o golpe sai no máximo e passa pela defesa e pela armadura. Nunca passa de 60%.`,
        a: `${num(a.d.crit)}%`,
        b: `${num(b.d.crit)}%`,
      },
      {
        label: t`Ataques por segundo`,
        hint: t`O intervalo cai (4 × AGI + DES)/1000 no começo, cada vez menos; no máximo 2,5 vezes mais rápido.`,
        a: num(a.attacksPerSecond, 2),
        b: num(b.attacksPerSecond, 2),
      },
      {
        label: t`Defesa da VIT`,
        hint: t`Tirada de cada golpe físico, depois da armadura.`,
        a: `${a.d.vitDef[0]}~${a.d.vitDef[1]}`,
        b: `${b.d.vitDef[0]}~${b.d.vitDef[1]}`,
      },
      {
        label: t`Defesa mágica`,
        hint: t`Tirada de cada magia dos monstros: (INT + VIT/2)/4.`,
        a: String(a.d.mdef),
        b: String(b.d.mdef),
      },
      {
        label: t`Capacidade`,
        hint: t`+10 oz por FOR.`,
        a: `${a.cap} oz`,
        b: `${b.cap} oz`,
      },
      {
        label: t`Recargas`,
        hint: t`As habilidades voltam DES/300 mais depressa no começo, cada vez menos; no máximo pela metade.`,
        a: `−${num((1 - a.d.cooldown) * 100)}%`,
        b: `−${num((1 - b.d.cooldown) * 100)}%`,
      },
    ];
  };

  return (
    <Wrap>
      <Head>
        <strong>{t`Pontos livres: ${free()}`}</strong>
        <Muted>
          {t`Cada level na dungeon dá ${POINTS_PER_LEVEL} pontos. Até o 50, cada ponto custa 1; do 51 ao 60 custa 2, do 61 ao 70 custa 3, e assim por diante. Passado o ${STAT_SOFT}, cada ponto vale menos nas contas. Não há teto.`}
        </Muted>
      </Head>
      <Grid>
        <List aria-label={t`Atributos`}>
          <For each={STATS}>
            {(k) => {
              const value = () => props.hero.stats[k] + (add()[k] ?? 0);
              const isMarked = () => (add()[k] ?? 0) > 0;
              // Com os itens: o valor nas contas (a escada de ganho, passado o 100).
              const worth = () =>
                statValue(value() + (props.hero.gear_stats?.[k] ?? 0));
              return (
                <StatRow data-marked={isMarked() ? "" : undefined}>
                  <Name title={info[k].blurb}>{info[k].name}</Name>
                  <Value>
                    {value()}
                    {/* O que os itens vestidos somam (24/11/2026), como o "+5" do Ragnarok. */}
                    <Show when={props.hero.gear_stats?.[k]}>
                      {(g) => (
                        <Bonus title={t`Dos itens vestidos`}>
                          {g() > 0 ? ` +${g()}` : ` ${g()}`}
                        </Bonus>
                      )}
                    </Show>
                    <Show
                      when={
                        value() + (props.hero.gear_stats?.[k] ?? 0) > STAT_SOFT
                      }
                    >
                      <Worth
                        title={t`Passado o ${STAT_SOFT}, cada ponto vale menos nas contas`}
                      >
                        {t`vale ${Math.floor(worth())}`}
                      </Worth>
                    </Show>
                  </Value>
                  <Step
                    type="button"
                    aria-label={t`Tirar um ponto de ${info[k].name}`}
                    disabled={!isMarked()}
                    onClick={() => bump(k, -1)}
                  >
                    −
                  </Step>
                  <Step
                    type="button"
                    aria-label={t`Subir ${info[k].name}: custa ${nextCost(k)}`}
                    title={t`Custa ${nextCost(k)}`}
                    disabled={
                      props.locked || props.busy || nextCost(k) > free()
                    }
                    onClick={() => bump(k, 1)}
                  >
                    +<Cost>{nextCost(k)}</Cost>
                  </Step>
                  <Blurb>{info[k].blurb}</Blurb>
                </StatRow>
              );
            }}
          </For>
          <Row>
            <Button
              size="xs"
              variant="filled"
              isDisabled={props.busy || props.locked || marked() === 0}
              onPress={confirm}
            >
              {t`Confirmar`}
            </Button>
            <Button
              size="xs"
              variant="text"
              isDisabled={marked() === 0}
              onPress={() => setAdd({})}
            >
              {t`Desfazer`}
            </Button>
          </Row>
          <Muted>
            {t`Depois de confirmar, os pontos só voltam no Mestre de evolução (a primeira vez é de graça).`}
          </Muted>
        </List>
        <Derived aria-label={t`O que os atributos dão`}>
          <For each={rows()}>
            {(r) => (
              <DerivedRow title={r.hint}>
                <span>{r.label}</span>
                {pair(r.a, r.b)}
              </DerivedRow>
            )}
          </For>
        </Derived>
      </Grid>
      <Show when={props.locked}>
        <Muted>{t`Na dungeon: os atributos voltam quando a corrida acabar.`}</Muted>
      </Show>
    </Wrap>
  );
}

const Wrap = styled("div", {
  base: {
    containerType: "inline-size",
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-md)",
  },
});

const Head = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "2px" },
});

const Grid = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
    gap: "var(--gap-md)",
    "@container (max-width: 560px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
});

const List = styled("section", {
  base: { display: "flex", flexDirection: "column", gap: "6px" },
});

const StatRow = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "3.2em 2.6em auto auto 1fr",
    gridTemplateRows: "auto auto",
    alignItems: "center",
    columnGap: "8px",
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
  base: { fontWeight: 700, letterSpacing: "0.04em" },
});

const Value = styled("span", {
  base: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    textAlign: "right",
    whiteSpace: "nowrap",
  },
});

const Worth = styled("span", {
  base: {
    display: "block",
    fontSize: "0.72em",
    fontWeight: 500,
    opacity: 0.75,
  },
});

/** O custo do próximo ponto, pequeno dentro do "+". */
const Cost = styled("sup", {
  base: { fontSize: "0.65em", marginLeft: "1px", opacity: 0.8 },
});

const Bonus = styled("span", {
  base: { color: "#7ee08a", fontWeight: 700, fontSize: "0.9em" },
});

const Step = styled("button", {
  base: {
    width: "32px",
    height: "32px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
    fontSize: "1.1rem",
    lineHeight: 1,
    background: "var(--md-sys-color-secondary-container)",
    color: "var(--md-sys-color-on-secondary-container)",
    "&:disabled": { opacity: 0.35, cursor: "default" },
    "@media (pointer: coarse)": { width: "44px", height: "44px" },
  },
});

const Blurb = styled("span", {
  base: {
    gridColumn: "1 / -1",
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "0.78em",
    lineHeight: 1.35,
  },
});

const Derived = styled("section", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
    alignSelf: "start",
  },
});

const DerivedRow = styled("div", {
  base: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    fontSize: "0.88em",
    padding: "3px 0",
    borderBottom: "1px solid var(--md-sys-color-outline-variant)",
    "&:last-child": { borderBottom: "none" },
    "& strong": { fontVariantNumeric: "tabular-nums", textAlign: "right" },
  },
});

const Up = styled("span", {
  base: { color: "var(--md-sys-color-primary)" },
});

const Row = styled("div", {
  base: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.85em" },
});
