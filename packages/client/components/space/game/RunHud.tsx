import { For, Show, onMount } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type PotionCounts,
  type PotionKind,
  type RpgRunMemberView,
  type RunFrame,
  type SupplyRule,
  type VocationId,
  DEFAULT_SUPPLIES,
  POTION_COOLDOWN_MS,
  VOCATIONS,
  nextPotion,
  potionSizes,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { SkillBar } from "./SkillBar";
import { drinkLock } from "./itemUi";
import { vocationName } from "./rpgUi";

/**
 * A barra de experiência: a guardada (cheia) e a desta corrida (clara, listrada), que só entra
 * no fim e se perde se o herói cair. `next` > `level`: a corrida sobe o nível.
 */
export interface RunXp {
  level: number;
  next: number;
  /** Quanto do nível a guardada já enche e quanto a da corrida soma, em %. */
  pct: number;
  pendingPct: number;
  pending: number;
  lost: boolean;
}

/**
 * O painel de baixo da tela da dungeon (24/11/2026, "parecido com o Diablo"): a barra de
 * experiência em cima; o cristal de vida à esquerda com as poções de vida, as 4 habilidades no
 * meio e o cristal de mana à direita com as poções de mana. Tudo vem da corrida que o servidor
 * já calculou: a vida e a mana do quadro, a recarga das habilidades pelo registro, as poções e
 * a experiência pela contagem (belt.ts).
 */
export function RunHud(props: {
  member: RpgRunMemberView;
  index: number;
  frame: RunFrame;
  casts: Record<string, number>;
  /** As poções agora (null: o servidor não mandou; o cinto não aparece). */
  potions: PotionCounts | null;
  /** O último segundo em que bebeu e o que bebeu nesse segundo. */
  drankAt: number;
  drunk: readonly string[];
  /** A experiência (só do próprio herói: a de quem assiste não vem). */
  xp: RunXp | null;
}) {
  const { t } = useLingui();
  const hp = () => props.frame.h[props.index] ?? 0;
  const mp = () => props.frame.m[props.index] ?? 0;
  const rules = () => props.member.supplies ?? DEFAULT_SUPPLIES;
  const belt = (kind: PotionKind) => (
    <Show when={props.potions}>
      {(c) => (
        <PotionBelt
          kind={kind}
          layout="column"
          counts={c()}
          vocation={props.member.vocation}
          level={props.member.level}
          rule={rules()[kind]}
          nowS={props.frame.s}
          drankAt={props.drankAt}
          drunk={props.drunk}
        />
      )}
    </Show>
  );
  return (
    <HudBox>
      <Hud
        role="group"
        aria-label={t`Painel de ${props.member.name}`}
        data-dead={hp() <= 0 ? "" : undefined}
      >
        <Show when={props.xp}>{(x) => <XpBar xp={x()} />}</Show>
        <Side data-side="life">
          <Orb
            kind="life"
            name={props.member.name}
            value={hp()}
            max={props.member.health_max}
            below={rules().health.below}
          />
          {belt("health")}
        </Side>
        <Center>
          <SkillBar
            member={props.member}
            index={props.index}
            nowS={props.frame.s}
            mana={mp()}
            dead={hp() <= 0}
            casts={props.casts}
            size="hud"
          />
        </Center>
        <Side data-side="mana">
          {belt("mana")}
          <Orb
            kind="mana"
            name={props.member.name}
            value={mp()}
            max={props.member.mana_max}
            below={rules().mana.below}
          />
        </Side>
      </Hud>
    </HudBox>
  );
}

function XpBar(props: { xp: RunXp }) {
  const { t } = useLingui();
  const x = () => props.xp;
  const pctText = () => Math.floor(x().pct);
  const gain = () => x().pending.toLocaleString();
  const label = () => {
    const lv = x().level;
    const p = pctText();
    const base = t`Nível ${lv}: ${p}% para o próximo`;
    if (x().pending <= 0) return base;
    if (x().lost)
      return `${base} · ${t`a experiência desta corrida se perdeu`}`;
    const nx = x().next;
    return x().next > x().level
      ? `${base} · ${t`+${gain()} nesta corrida: sobe para o nível ${nx} no fim`}`
      : `${base} · ${t`+${gain()} nesta corrida, entra no fim`}`;
  };
  return (
    <Xp
      role="meter"
      aria-label={label()}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pctText()}
      title={label()}
    >
      <XpTrack>
        <span data-banked="" style={{ width: `${x().pct}%` }} />
        <span
          data-pending=""
          data-lost={x().lost ? "" : undefined}
          style={{ left: `${x().pct}%`, width: `${x().pendingPct}%` }}
        />
      </XpTrack>
      <XpText aria-hidden="true">
        <span>{t`Nível ${x().level} · ${pctText()}%`}</span>
        <Show when={x().pending > 0}>
          <span
            data-lost={x().lost ? "" : undefined}
            data-up={x().next > x().level && !x().lost ? "" : undefined}
          >
            {x().lost
              ? t`+${gain()} perdida`
              : x().next > x().level
                ? t`+${gain()} · nível ${x().next} no fim`
                : t`+${gain()} no fim`}
          </span>
        </Show>
      </XpText>
    </Xp>
  );
}

/** O cristal: o líquido sobe e desce com a vida (ou a mana); a linha é onde ele bebe. */
function Orb(props: {
  kind: "life" | "mana";
  name: string;
  value: number;
  max: number;
  below: number;
}) {
  const { t } = useLingui();
  const p = () =>
    props.max > 0
      ? Math.max(0, Math.min(100, (props.value * 100) / props.max))
      : 0;
  const life = () => props.kind === "life";
  const hint = () => {
    const b = props.below;
    if (b <= 0)
      return life() ? t`Não bebe poção de vida` : t`Não bebe poção de mana`;
    return life()
      ? t`Bebe poção de vida abaixo de ${b}%`
      : t`Bebe poção de mana abaixo de ${b}%`;
  };
  return (
    <OrbBox
      data-kind={props.kind}
      data-low={life() && p() < 30 ? "" : undefined}
      role="meter"
      aria-label={life() ? t`Vida de ${props.name}` : t`Mana de ${props.name}`}
      aria-valuemin={0}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      title={hint()}
    >
      <Liquid style={{ height: `${p()}%` }} />
      <Show when={props.below > 0}>
        <Mark style={{ bottom: `${props.below}%` }} />
      </Show>
      <OrbText aria-hidden="true">
        <strong>{props.value}</strong>
        <span>{props.max}</span>
      </OrbText>
    </OrbBox>
  );
}

/**
 * O cinto: todos os tamanhos de um tipo de poção, com quantas tem de cada. A que ele bebe a
 * seguir tem a borda dourada; a que não pode beber (level ou vocação) fica apagada com um
 * cadeado. Na corrida, o gole acende a poção e a cortina de 1 s passa por todas (uma poção por
 * segundo, para as duas). Na ficha (`row`), sem a recarga.
 */
export function PotionBelt(props: {
  kind: PotionKind;
  layout: "column" | "row";
  counts: PotionCounts;
  vocation: VocationId;
  level: number;
  rule: SupplyRule;
  nowS?: number;
  drankAt?: number;
  drunk?: readonly string[];
}) {
  const { t } = useLingui();
  const base = () => VOCATIONS[props.vocation].base;
  const next = () =>
    nextPotion(props.kind, props.counts, props.rule, base(), props.level);
  const drankNow = () =>
    props.nowS !== undefined && props.drankAt === props.nowS;
  return (
    <Belt
      data-layout={props.layout}
      aria-label={
        props.kind === "health" ? t`Poções de vida` : t`Poções de mana`
      }
    >
      <For each={potionSizes(props.kind)}>
        {(d) => {
          const n = () => props.counts[d.id] ?? 0;
          const locked = () => drinkLock(d, base(), props.level, vocationName);
          const label = () => {
            const [a, b] = d.potion![props.kind]!;
            const count = n();
            const parts = [
              d.name,
              props.kind === "health"
                ? t`cura ${a} a ${b} de vida`
                : t`devolve ${a} a ${b} de mana`,
              t`${count} na mochila`,
            ];
            const why = locked();
            if (why) parts.push(why);
            else if (next() === d.id) parts.push(t`é a próxima que ele bebe`);
            return parts.join(" · ");
          };
          return (
            <Vial
              data-empty={n() <= 0 ? "" : undefined}
              data-locked={locked() ? "" : undefined}
              data-next={next() === d.id ? "" : undefined}
              data-cast={
                drankNow() && props.drunk?.includes(d.id) ? "" : undefined
              }
              title={label()}
              aria-label={label()}
            >
              <Flask
                kind={props.kind}
                size={d.potion!.size}
                px={props.layout === "row" ? 32 : 22}
              />
              <span data-n="">{n()}</span>
              <Show when={locked()}>
                <Symbol size={props.layout === "row" ? 13 : 10} data-lock="">
                  lock
                </Symbol>
              </Show>
              {/* Uma por gole: o segundo novo monta outra cortina. */}
              <For each={drankNow() ? [props.nowS!] : []}>
                {() => <PotionWipe />}
              </For>
            </Vial>
          );
        }}
      </For>
    </Belt>
  );
}

/** As cores do líquido por tamanho: a pequena mais clara, a forte mais funda. */
const LIQUID: Record<PotionKind, Record<1 | 2 | 3, string>> = {
  health: { 1: "#f0626a", 2: "#d3242f", 3: "#9b0d1e" },
  mana: { 1: "#7fa4ff", 2: "#3d6bff", 3: "#1d33b5" },
};

/** Um frasco desenhado: o tamanho diz qual é (pequena, normal, forte). */
export function Flask(props: {
  kind: PotionKind;
  size: 1 | 2 | 3;
  px: number;
}) {
  const h = () => Math.round(props.px * (0.72 + 0.14 * (props.size - 1)));
  return (
    <svg
      viewBox="0 0 24 28"
      width={Math.round((h() * 24) / 28)}
      height={h()}
      aria-hidden="true"
      style={{ "flex-shrink": 0 }}
    >
      <path
        d="M4.25 15 A8.5 8.5 0 1 0 19.75 15 Z"
        fill={LIQUID[props.kind][props.size]}
      />
      <path
        d="M9.5 3 H14.5 V10.38 A8.5 8.5 0 1 1 9.5 10.38 Z"
        fill="rgba(255, 255, 255, 0.1)"
        stroke="rgba(255, 255, 255, 0.6)"
        stroke-width="1.3"
      />
      <ellipse
        cx="8.4"
        cy="18.5"
        rx="1.5"
        ry="3"
        fill="rgba(255, 255, 255, 0.4)"
      />
      <rect
        x="8.8"
        y="0.8"
        width="6.4"
        height="2.8"
        rx="0.9"
        fill={props.size === 3 ? "#d9b45a" : "#8a5a2b"}
      />
    </svg>
  );
}

/** A recarga do gole: a cortina desce uma vez, em 1 s (sem movimento, fica parada o segundo). */
function PotionWipe() {
  let el: HTMLSpanElement | undefined;
  onMount(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el?.animate?.([{ height: "100%" }, { height: "0%" }], {
      duration: POTION_COOLDOWN_MS,
      easing: "linear",
      fill: "forwards",
    });
  });
  return <Wipe ref={el} data-wipe="" />;
}

/** O painel decide o próprio arranjo pela largura que tem (cabe no celular). */
const HudBox = styled("div", {
  base: {
    containerType: "inline-size",
    containerName: "hud",
    width: "100%",
  },
});

const Hud = styled("div", {
  base: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    gridTemplateAreas: '"xp xp xp" "life skills mana"',
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderRadius: "14px",
    color: "#f3efe6",
    background:
      "linear-gradient(180deg, rgba(30, 26, 22, 0.94), rgba(12, 11, 10, 0.97))",
    boxShadow:
      "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 1px rgba(122, 100, 64, 0.55)",
    "&[data-dead]": { filter: "grayscale(1)", opacity: 0.55 },
    // Estreito (celular, painel sem a cena): os cristais nas pontas e as habilidades embaixo.
    "@container hud (max-width: 470px)": {
      gridTemplateColumns: "auto auto",
      gridTemplateAreas: '"xp xp" "life mana" "skills skills"',
      justifyContent: "space-between",
      rowGap: "8px",
    },
  },
});

const Xp = styled("div", {
  base: {
    gridArea: "xp",
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    minWidth: 0,
  },
});

/** A trilha em 10 gomos, como nos RPGs: dá para ler a fração de relance. */
const XpTrack = styled("div", {
  base: {
    position: "relative",
    height: "7px",
    borderRadius: "999px",
    overflow: "hidden",
    background: "rgba(255, 255, 255, 0.08)",
    boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
    "&::after": {
      content: "''",
      position: "absolute",
      inset: 0,
      background:
        "repeating-linear-gradient(to right, transparent 0 calc(10% - 1px), rgba(0, 0, 0, 0.55) calc(10% - 1px) 10%)",
      pointerEvents: "none",
    },
    "& > span": {
      position: "absolute",
      top: 0,
      bottom: 0,
      transition: "width 0.5s ease, left 0.5s ease",
    },
    "& > [data-banked]": {
      left: 0,
      background: "linear-gradient(to bottom, #f3cf6d, #b8892f)",
    },
    // A da corrida: clara e listrada (ainda não é dele).
    "& > [data-pending]": {
      background:
        "repeating-linear-gradient(135deg, rgba(255, 224, 138, 0.75) 0 4px, rgba(255, 224, 138, 0.4) 4px 8px)",
    },
    "& > [data-pending][data-lost]": {
      background:
        "repeating-linear-gradient(135deg, rgba(160, 150, 140, 0.45) 0 4px, rgba(160, 150, 140, 0.2) 4px 8px)",
    },
    "@media (prefers-reduced-motion: reduce)": {
      "& > span": { transition: "none" },
    },
  },
});

const XpText = styled("div", {
  base: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    fontSize: "0.7rem",
    lineHeight: 1.2,
    opacity: 0.85,
    fontVariantNumeric: "tabular-nums",
    "& > span": { whiteSpace: "nowrap" },
    "& [data-up]": { color: "#ffd66b", fontWeight: 700, opacity: 1 },
    "& [data-lost]": { color: "#b9b2a6", textDecoration: "line-through" },
  },
});

const Side = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    "&[data-side=life]": { gridArea: "life" },
    "&[data-side=mana]": { gridArea: "mana" },
  },
});

const Center = styled("div", {
  base: {
    gridArea: "skills",
    display: "flex",
    justifyContent: "center",
    minWidth: 0,
  },
});

const OrbBox = styled("div", {
  base: {
    position: "relative",
    flexShrink: 0,
    width: "76px",
    height: "76px",
    borderRadius: "50%",
    overflow: "hidden",
    background: "radial-gradient(circle at 50% 35%, #2b2a33, #0b0b0f 72%)",
    boxShadow:
      "0 0 0 2px #17130f, 0 0 0 4px #7a6440, 0 4px 10px rgba(0, 0, 0, 0.6)",
    transition: "box-shadow 0.3s ease",
    // O vidro: um brilho em cima e a sombra embaixo, por cima do líquido.
    "&::after": {
      content: "''",
      position: "absolute",
      inset: 0,
      borderRadius: "50%",
      background:
        "radial-gradient(circle at 32% 24%, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0) 30%), radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0) 58%, rgba(0, 0, 0, 0.45) 100%)",
      pointerEvents: "none",
    },
    "&[data-low]": {
      boxShadow:
        "0 0 0 2px #17130f, 0 0 0 4px #9a3a2a, 0 0 16px 3px rgba(255, 40, 40, 0.55)",
    },
    "@container hud (max-width: 470px)": { width: "66px", height: "66px" },
  },
});

const Liquid = styled("span", {
  base: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    transition: "height 0.35s ease",
    boxShadow: "inset 0 2px 0 rgba(255, 255, 255, 0.3)",
    "[data-kind=life] > &": {
      background:
        "radial-gradient(ellipse at 50% 100%, #ff6b5e 0%, #c4161f 48%, #5c0508 100%)",
    },
    "[data-kind=mana] > &": {
      background:
        "radial-gradient(ellipse at 50% 100%, #80b0ff 0%, #2552e0 48%, #0a1a5c 100%)",
    },
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  },
});

/**
 * O limite em que ele bebe a poção: dois riscos nas bordas do cristal (uma linha inteira
 * cortava os números e parecia texto riscado).
 */
const Mark = styled("span", {
  base: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "2px",
    marginBottom: "-1px",
    background:
      "linear-gradient(to right, rgba(255, 255, 255, 0.85) 0 20%, transparent 20% 80%, rgba(255, 255, 255, 0.85) 80% 100%)",
    pointerEvents: "none",
  },
});

const OrbText = styled("span", {
  base: {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1.05,
    fontVariantNumeric: "tabular-nums",
    color: "#fff",
    textShadow: "0 1px 2px rgba(0, 0, 0, 0.9)",
    pointerEvents: "none",
    "& strong": { fontSize: "1.02rem", fontWeight: 700 },
    "& span": { fontSize: "0.7rem", opacity: 0.85 },
  },
});

const Belt = styled("ul", {
  base: {
    display: "flex",
    gap: "3px",
    margin: 0,
    padding: 0,
    listStyle: "none",
    "&[data-layout=column]": { flexDirection: "column" },
    "&[data-layout=row]": {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: "6px",
    },
  },
});

const Vial = styled("li", {
  base: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "3px",
    overflow: "hidden",
    borderRadius: "6px",
    transition: "box-shadow 0.2s ease, opacity 0.2s ease",
    "[data-layout=column] > &": {
      height: "24px",
      minWidth: "46px",
      padding: "0 7px 0 4px",
      background: "rgba(255, 255, 255, 0.09)",
      boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.14)",
    },
    "[data-layout=row] > &": {
      height: "44px",
      minWidth: "60px",
      padding: "0 10px 0 8px",
      gap: "6px",
      borderRadius: "10px",
      background: "#1c1916",
      color: "#f3efe6",
      boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
      "& [data-n]": { fontSize: "0.95rem" },
    },
    "& [data-n]": {
      fontSize: "0.74rem",
      fontWeight: 700,
      fontVariantNumeric: "tabular-nums",
    },
    "&[data-empty]": { opacity: 0.42 },
    "&[data-locked]": { filter: "grayscale(1) brightness(0.7)" },
    // A próxima que ele bebe: a borda dourada.
    "&[data-next]": {
      boxShadow: "inset 0 0 0 1.5px #d9b45a",
    },
    // O gole: acende.
    "&[data-cast]": {
      boxShadow: "inset 0 0 0 2px #fff, 0 0 8px rgba(255, 255, 255, 0.8)",
    },
    "& [data-lock]": {
      position: "absolute",
      top: "1px",
      right: "1px",
      opacity: 0.9,
    },
  },
});

/** A cortina da recarga (1 s, todas juntas). */
const Wipe = styled("span", {
  base: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "100%",
    background: "rgba(5, 6, 10, 0.62)",
    pointerEvents: "none",
  },
});
