import { For, Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RunState } from "@muchat/space-client";
import {
  type ClassId,
  type HeroV5,
  type PotionSize,
  type RpgRunMemberView,
  type RunFrame,
  balance as B,
  skillOf,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { sizeName } from "./gameText";
import { heroBars, num, potionOf } from "./heroModel";

/**
 * O painel de baixo da tela da corrida, no jeito do Diablo (o mesmo arranjo da tela de 24/11/2026,
 * agora sobre a engine v5): as barras de nível e de job com a Proficiência em cima; o cristal de
 * vida à esquerda com o cinto de vida, as 4 habilidades no meio e o cristal de mana à direita com o
 * cinto de mana. Tudo sai da corrida que o servidor já calculou: a vida e a mana de cada segundo,
 * a recarga das habilidades e das poções pelo último uso (eventos) e a recarga final de cada uma.
 * A recarga é da habilidade e da poção (o que o dono pediu para ver); nenhum relógio da corrida (D21).
 */
export function RunHud(props: {
  member: RpgRunMemberView;
  index: number;
  frame: RunFrame;
  state: RunState;
  /** O herói de quem joga (as barras de nível e job); null quando só assiste. */
  hero: HeroV5 | null;
}) {
  const { t } = useLingui();
  const hp = () => props.frame.h[props.index] ?? 0;
  const mp = () => props.frame.m[props.index] ?? 0;
  const dead = () => hp() <= 0;
  const supplies = () => props.member.supplies;
  return (
    <HudBox>
      <Hud
        role="group"
        aria-label={t`Painel de ${props.member.name}`}
        data-dead={dead() ? "" : undefined}
      >
        {/* No fim o XP da corrida já entrou no herói (rpg.state): a barra não soma de novo. */}
        <Levels
          member={props.member}
          hero={props.hero}
          gained={props.state.end ? 0 : (props.state.xp[props.index] ?? 0)}
        />
        <Side data-side="life">
          <Orb
            kind="life"
            name={props.member.name}
            value={hp()}
            max={props.member.hp_max}
            below={Math.round(supplies().hp * 100)}
          />
          <Belt
            kind="hp"
            size={props.member.belt.hp}
            level={props.member.level}
            count={props.state.potions[props.index]?.hp ?? 0}
            drankAt={props.state.drank[props.index]?.hp ?? -1}
            nowS={props.frame.s}
          />
        </Side>
        <Center>
          <SkillBar
            member={props.member}
            index={props.index}
            nowS={props.frame.s}
            mana={mp()}
            dead={dead()}
            casts={props.state.casts[props.index] ?? {}}
          />
        </Center>
        <Side data-side="mana">
          <Belt
            kind="mp"
            size={props.member.belt.mp}
            level={props.member.level}
            count={props.state.potions[props.index]?.mp ?? 0}
            drankAt={props.state.drank[props.index]?.mp ?? -1}
            nowS={props.frame.s}
          />
          <Orb
            kind="mana"
            name={props.member.name}
            value={mp()}
            max={props.member.mp_max}
            below={Math.round(supplies().mp * 100)}
          />
        </Side>
      </Hud>
    </HudBox>
  );
}

// ------------------------------------------------------------ níveis

/**
 * Nível (com o XP desta corrida listrado, que entra no fim), job e a Proficiência. Quem só assiste
 * vê os números da corrida (o servidor não manda a experiência dos outros).
 */
function Levels(props: {
  member: RpgRunMemberView;
  hero: HeroV5 | null;
  gained: number;
}) {
  const { t } = useLingui();
  const bars = () => (props.hero ? heroBars(props.hero) : null);
  const prof = () => props.hero?.proficiency ?? props.member.proficiency;
  const effective = () =>
    props.hero
      ? B.effectiveProficiency(props.hero.proficiency, props.hero.level)
      : null;
  /** Até onde a barra chega com o XP desta corrida (passa de 100%: sobe no fim). */
  const xpGain = () => {
    const b = bars();
    if (!b || b.xp.need <= 0) return null;
    const into = b.xp.into + props.gained;
    const next = B.levelForXp(
      Math.max(props.hero!.xp, B.xpTotalAt(b.level)) + props.gained,
    );
    return {
      pendingFrac: Math.min(1 - b.xp.frac, props.gained / b.xp.need),
      up: next > b.level ? next : null,
      into,
    };
  };
  const jobGain = () => {
    const b = bars();
    if (!b || b.jobXp.need <= 0) return 0;
    return Math.min(
      1 - b.jobXp.frac,
      (props.gained * B.cfg.xp.jobShare) / b.jobXp.need,
    );
  };
  return (
    <Xp>
      <Show
        when={bars()}
        fallback={
          <XpText>
            <span>
              {t`Nível ${props.member.level}`}
              <Show when={props.member.job}>
                {" "}
                · {t`Job ${props.member.job}`}
              </Show>
            </span>
            <Show when={prof()}>
              <span>{t`Proficiência ${num(prof()!)}`}</span>
            </Show>
          </XpText>
        }
      >
        {(b) => (
          <>
            <XpRow>
              <Tag data-kind="level" title={t`Nível do herói`}>
                {t`Nv`} {b().level}
              </Tag>
              <Track
                role="meter"
                aria-label={t`Nível ${b().level}: ${Math.floor(b().xp.frac * 100)}% para o próximo`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.floor(b().xp.frac * 100)}
              >
                <span
                  data-banked=""
                  style={{ width: `${b().xp.frac * 100}%` }}
                />
                <span
                  data-pending=""
                  style={{
                    left: `${b().xp.frac * 100}%`,
                    width: `${(xpGain()?.pendingFrac ?? 0) * 100}%`,
                  }}
                />
              </Track>
              <Small>
                {Math.floor(b().xp.frac * 100)}%
                <Show when={props.gained > 0}>
                  {" "}
                  <b data-up={xpGain()?.up ? "" : undefined}>
                    {xpGain()?.up
                      ? t`+${num(props.gained)} · nível ${xpGain()!.up!} no fim`
                      : t`+${num(props.gained)} no fim`}
                  </b>
                </Show>
              </Small>
            </XpRow>
            <XpRow>
              <Tag
                data-kind="job"
                title={t`Nível de job (pontos de habilidade)`}
              >
                {t`Job`} {b().job}
              </Tag>
              <Track
                data-kind="job"
                role="meter"
                aria-label={t`Job ${b().job}: ${Math.floor(b().jobXp.frac * 100)}% para o próximo`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.floor(b().jobXp.frac * 100)}
              >
                <span
                  data-banked=""
                  style={{ width: `${b().jobXp.frac * 100}%` }}
                />
                <span
                  data-pending=""
                  style={{
                    left: `${b().jobXp.frac * 100}%`,
                    width: `${jobGain() * 100}%`,
                  }}
                />
              </Track>
              <Tag
                data-kind="prof"
                title={t`Proficiência guardada ${num(prof() ?? 0)}; vale ${num(effective() ?? 0)} no seu nível (treine no Dojô)`}
              >
                {t`Prof.`} {num(prof() ?? 0)}
              </Tag>
            </XpRow>
          </>
        )}
      </Show>
    </Xp>
  );
}

// ------------------------------------------------------------ cristais

/** O cristal: o líquido sobe e desce com a vida (ou a mana); os riscos marcam onde ele bebe. */
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
  const hint = () =>
    props.below <= 0
      ? life()
        ? t`Não bebe poção de vida`
        : t`Não bebe poção de mana`
      : life()
        ? t`Bebe poção de vida abaixo de ${props.below}%`
        : t`Bebe poção de mana abaixo de ${props.below}%`;
  return (
    <OrbBox
      data-kind={props.kind}
      data-low={life() && p() < 30 ? "" : undefined}
      role="meter"
      aria-label={life() ? t`Vida de ${props.name}` : t`Mana de ${props.name}`}
      aria-valuemin={0}
      aria-valuemax={props.max}
      aria-valuenow={Math.round(props.value)}
      title={hint()}
    >
      <Liquid style={{ height: `${p()}%` }} />
      <Show when={props.below > 0}>
        <Mark style={{ bottom: `${props.below}%` }} />
      </Show>
      <OrbText aria-hidden="true">
        <strong>{num(props.value)}</strong>
        <span>{num(props.max)}</span>
      </OrbText>
    </OrbBox>
  );
}

// ------------------------------------------------------------ cinto

const FLASK_SIZE: Record<PotionSize, 1 | 3 | 5> = {
  pequena: 1,
  media: 3,
  grande: 5,
};

/**
 * O cinto de um tipo: o tamanho que vai na corrida (D35), quantas sobram, quanto cura, e a
 * recarga depois do gole (a cortina desce em 1, 2 ou 3 s, com os segundos que faltam).
 */
function Belt(props: {
  kind: "hp" | "mp";
  size: PotionSize;
  level: number;
  count: number;
  drankAt: number;
  nowS: number;
}) {
  const { t } = useLingui();
  const p = () => potionOf(props.kind, props.size, props.level);
  const left = () =>
    props.drankAt < 0
      ? 0
      : Math.max(0, props.drankAt * 1000 + p().cooldownMs - props.nowS * 1000);
  const label = () =>
    [
      props.kind === "hp"
        ? t`Poção de vida ${sizeName(props.size).toLowerCase()}`
        : t`Poção de mana ${sizeName(props.size).toLowerCase()}`,
      props.kind === "hp"
        ? t`cura ${num(p().heal)}`
        : t`devolve ${num(p().heal)} de mana`,
      t`${props.count} no cinto`,
      left() > 0 ? t`recarga: ${Math.ceil(left() / 1000)} s` : t`pronta`,
    ].join(" · ");
  return (
    <Vial
      data-empty={props.count <= 0 ? "" : undefined}
      data-cast={props.drankAt === props.nowS ? "" : undefined}
      role="img"
      aria-label={label()}
      title={label()}
    >
      <Flask kind={props.kind} size={FLASK_SIZE[props.size]} px={30} />
      <strong data-n="">{props.count}</strong>
      <small>{sizeName(props.size)}</small>
      <Wipe
        style={{ height: `${Math.round((left() / p().cooldownMs) * 100)}%` }}
      />
      <Show when={left() > 0}>
        <Secs data-small="">{Math.ceil(left() / 1000)}</Secs>
      </Show>
    </Vial>
  );
}

const LIQUID: Record<"hp" | "mp", Record<1 | 3 | 5, string>> = {
  hp: { 1: "#f0626a", 3: "#d3242f", 5: "#9b0d1e" },
  mp: { 1: "#7fa4ff", 3: "#3d6bff", 5: "#1d33b5" },
};

/** Um frasco desenhado: quanto maior a poção, maior o frasco e mais fundo o líquido. */
function Flask(props: { kind: "hp" | "mp"; size: 1 | 3 | 5; px: number }) {
  const h = () => Math.round(props.px * (0.72 + 0.07 * (props.size - 1)));
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
        fill={props.size >= 3 ? "#d9b45a" : "#8a5a2b"}
      />
    </svg>
  );
}

// ------------------------------------------------------------ habilidades

/** O ícone da classe (retratos). */
export const CLASS_ICON: Record<ClassId, string> = {
  guerreiro: "swords",
  paladino: "shield",
  padre: "church",
  druida: "eco",
  mago: "wand_stars",
  cacador: "my_location",
  assassino: "skull",
};

/** O ícone de uma skill pelo que ela faz (o primeiro efeito do conteúdo). */
export function skillIcon(cls: ClassId, id: string): string {
  const s = skillOf(cls, id);
  const e = s?.effects[0];
  if (!e) return "star";
  switch (e.type) {
    case "dano": {
      const el = e.parts[0]?.element;
      if (el === "sagrado") return "flare";
      if (el === "magico")
        return cls === "druida"
          ? "eco"
          : cls === "padre"
            ? "flare"
            : "local_fire_department";
      if (e.targets === "area") return "cyclone";
      return cls === "cacador" ? "north_east" : "swords";
    }
    case "dot":
      return e.poison
        ? "science"
        : e.element === "magico"
          ? "whatshot"
          : "water_drop";
    case "cura":
      return "healing";
    case "hot":
      return "spa";
    case "escudo":
    case "escudoDeMana":
      return "shield";
    case "buff":
      return "trending_up";
    case "debuff":
      return "trending_down";
    case "provocar":
      return "campaign";
    case "atordoar":
      return "flash_on";
    case "reviver":
      return "favorite";
    case "purificar":
      return "water_drop";
    case "cortaAmeaca":
      return "visibility_off";
  }
  return "star";
}

/**
 * As 4 habilidades na ordem de prioridade: disponível (acesa), em recarga (a cortina desce com os
 * segundos que faltam), sem mana (apagada e fria) e acesa no segundo em que sai.
 */
function SkillBar(props: {
  member: RpgRunMemberView;
  index: number;
  nowS: number;
  mana: number;
  dead: boolean;
  casts: Record<string, number>;
}) {
  const { t } = useLingui();
  return (
    <Bar
      aria-label={t`Habilidades de ${props.member.name}`}
      data-dead={props.dead ? "" : undefined}
    >
      <For each={props.member.skills}>
        {(s, i) => {
          const name = skillOf(props.member.cls, s.id)?.name ?? s.id;
          const at = () => props.casts[s.id];
          const left = () => {
            const a = at();
            return a === undefined
              ? 0
              : Math.max(0, a * 1000 + s.cd_ms - props.nowS * 1000);
          };
          const frac = () => (s.cd_ms > 0 ? left() / s.cd_ms : 0);
          const secs = () => Math.ceil(left() / 1000);
          const noMana = () => props.mana < s.mana;
          const state = () =>
            props.dead
              ? t`${name}: o herói caiu`
              : left() > 0
                ? t`${name}: recarga, ${secs()} s`
                : noMana()
                  ? t`${name}: sem mana (${s.mana})`
                  : t`${name}: pronta`;
          return (
            <Slot
              title={`${name} · ${t`${s.mana} de mana`} · ${t`recarga ${(s.cd_ms / 1000).toFixed(1).replace(".", ",")} s`}`}
              aria-label={state()}
              data-cd={left() > 0 ? "" : undefined}
              data-nomana={noMana() ? "" : undefined}
              data-ready={
                !props.dead && left() <= 0 && !noMana() ? "" : undefined
              }
              data-cast={at() === props.nowS ? "" : undefined}
            >
              <Symbol size={24}>{skillIcon(props.member.cls, s.id)}</Symbol>
              <Prio aria-hidden="true">{i() + 1}</Prio>
              <Cost aria-hidden="true" data-cost="">
                {s.mana}
              </Cost>
              <Wipe style={{ height: `${Math.round(frac() * 100)}%` }} />
              <Show when={left() > 0}>
                <Secs>{secs()}</Secs>
              </Show>
              <SkillName aria-hidden="true">{name}</SkillName>
            </Slot>
          );
        }}
      </For>
    </Bar>
  );
}

// ------------------------------------------------------------ estilos

/** O painel decide o próprio arranjo pela largura que tem (cabe no celular). */
const HudBox = styled("div", {
  base: { containerType: "inline-size", containerName: "hud", width: "100%" },
});

const Hud = styled("div", {
  base: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    gridTemplateAreas: '"xp xp xp" "life skills mana"',
    alignItems: "center",
    gap: "10px",
    padding: "8px 12px 10px",
    borderRadius: "14px",
    color: "#f3efe6",
    background:
      "linear-gradient(180deg, rgba(30, 26, 22, 0.96), rgba(12, 11, 10, 0.98))",
    boxShadow:
      "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 1px rgba(122, 100, 64, 0.55)",
    "&[data-dead]": { filter: "grayscale(1)", opacity: 0.6 },
    // Estreito (celular): os cristais nas pontas e as habilidades embaixo.
    "@container hud (max-width: 520px)": {
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
    gap: "4px",
    minWidth: 0,
  },
});

const XpRow = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "8px",
  },
});

const Tag = styled("span", {
  base: {
    whiteSpace: "nowrap",
    fontSize: "0.72rem",
    fontWeight: 800,
    padding: "1px 7px",
    borderRadius: "999px",
    fontVariantNumeric: "tabular-nums",
    "&[data-kind=level]": { background: "#d9b45a", color: "#1b140b" },
    "&[data-kind=job]": { background: "#9b7bd8", color: "#120c1e" },
    "&[data-kind=prof]": { background: "#5fbf8f", color: "#08180f" },
  },
});

/** A trilha em 10 gomos: dá para ler a fração de relance. */
const Track = styled("div", {
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
    "&[data-kind=job] > [data-banked]": {
      background: "linear-gradient(to bottom, #b89cf0, #6f4fb3)",
    },
    // A desta corrida: clara e listrada (entra no fim).
    "& > [data-pending]": {
      background:
        "repeating-linear-gradient(135deg, rgba(255, 224, 138, 0.75) 0 4px, rgba(255, 224, 138, 0.4) 4px 8px)",
    },
    "@media (prefers-reduced-motion: reduce)": {
      "& > span": { transition: "none" },
    },
  },
});

const Small = styled("span", {
  base: {
    whiteSpace: "nowrap",
    fontSize: "0.72rem",
    opacity: 0.9,
    fontVariantNumeric: "tabular-nums",
    "& b": { color: "#ffe7a8" },
    "& b[data-up]": {
      color: "#ffd66b",
      textShadow: "0 0 6px rgba(255, 214, 102, 0.6)",
    },
  },
});

const XpText = styled("div", {
  base: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    fontSize: "0.78rem",
    fontVariantNumeric: "tabular-nums",
  },
});

const Side = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
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
    width: "84px",
    height: "84px",
    borderRadius: "50%",
    overflow: "hidden",
    background: "radial-gradient(circle at 50% 35%, #2b2a33, #0b0b0f 72%)",
    boxShadow:
      "0 0 0 2px #17130f, 0 0 0 4px #7a6440, 0 4px 10px rgba(0, 0, 0, 0.6)",
    transition: "box-shadow 0.3s ease",
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
    "@container hud (max-width: 520px)": { width: "70px", height: "70px" },
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

/** O limite em que ele bebe: dois riscos nas bordas do cristal. */
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
    "& strong": { fontSize: "1.05rem", fontWeight: 700 },
    "& span": { fontSize: "0.72rem", opacity: 0.85 },
  },
});

const Vial = styled("div", {
  base: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "auto auto",
    gridTemplateRows: "auto auto",
    alignItems: "center",
    columnGap: "4px",
    minWidth: "64px",
    minHeight: "48px",
    padding: "4px 8px 4px 6px",
    overflow: "hidden",
    borderRadius: "10px",
    background: "rgba(255, 255, 255, 0.07)",
    boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.14)",
    transition: "box-shadow 0.2s ease",
    "& > svg": { gridRow: "1 / 3" },
    "& [data-n]": {
      fontSize: "1rem",
      fontWeight: 800,
      fontVariantNumeric: "tabular-nums",
      lineHeight: 1,
    },
    "& small": { fontSize: "0.62rem", opacity: 0.8, lineHeight: 1 },
    "&[data-empty]": { opacity: 0.45, boxShadow: "inset 0 0 0 1px #ff8a7a" },
    "&[data-cast]": {
      boxShadow: "inset 0 0 0 2px #fff, 0 0 8px rgba(255, 255, 255, 0.8)",
    },
  },
});

const Bar = styled("ul", {
  base: {
    display: "flex",
    gap: "8px",
    margin: 0,
    padding: 0,
    listStyle: "none",
    justifyContent: "center",
    alignItems: "flex-start",
    flexWrap: "wrap",
    "&[data-dead]": { opacity: 0.45, filter: "grayscale(1)" },
  },
});

const Slot = styled("li", {
  base: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: "52px",
    height: "52px",
    marginBottom: "16px",
    borderRadius: "10px",
    background: "linear-gradient(180deg, #3a2f20, #1c1814)",
    color: "#f0dcae",
    boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1), 0 0 0 1px #4a3d2a",
    transition: "box-shadow 0.2s ease, filter 0.2s ease",
    // Pronta: a borda dourada.
    "&[data-ready]": {
      boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 0 0 2px #d9b45a",
    },
    // Sem mana: apagada e fria, com o custo em vermelho.
    "&[data-nomana]": { filter: "grayscale(0.85) brightness(0.7)" },
    "&[data-nomana] > [data-cost]": { color: "#ff8a7a" },
    // No segundo em que sai: acende.
    "&[data-cast]": { boxShadow: "0 0 0 2px #fff, 0 0 12px #d9b45a" },
    "@container hud (max-width: 520px)": { width: "56px", height: "56px" },
  },
});

const Prio = styled("span", {
  base: {
    position: "absolute",
    top: "2px",
    left: "4px",
    fontSize: "0.62rem",
    fontWeight: 800,
    opacity: 0.75,
    zIndex: 1,
  },
});

const Cost = styled("span", {
  base: {
    position: "absolute",
    right: "3px",
    bottom: "2px",
    fontSize: "0.62rem",
    fontWeight: 700,
    color: "#9fc3ff",
    zIndex: 1,
    fontVariantNumeric: "tabular-nums",
  },
});

const SkillName = styled("span", {
  base: {
    position: "absolute",
    top: "calc(100% + 2px)",
    left: "50%",
    transform: "translateX(-50%)",
    width: "58px",
    textAlign: "center",
    fontSize: "0.58rem",
    lineHeight: 1.1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    opacity: 0.8,
  },
});

/** A cortina da recarga: cobre de cima e desce um segundo por vez. */
const Wipe = styled("span", {
  base: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    background: "rgba(5, 6, 10, 0.68)",
    transition: "height 1s linear",
    pointerEvents: "none",
    borderRadius: "inherit",
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  },
});

const Secs = styled("span", {
  base: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    fontSize: "1.05rem",
    fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    color: "#fff",
    textShadow: "0 1px 2px rgba(0, 0, 0, 0.9)",
    pointerEvents: "none",
    zIndex: 2,
    // No cinto, os segundos ficam num selo no canto (o número de poções segue legível).
    "&[data-small]": {
      inset: "auto",
      top: "2px",
      right: "3px",
      minWidth: "18px",
      height: "16px",
      padding: "0 4px",
      borderRadius: "999px",
      fontSize: "0.7rem",
      background: "rgba(0, 0, 0, 0.75)",
    },
  },
});
