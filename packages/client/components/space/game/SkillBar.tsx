import { For, Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type RpgRunMemberView,
  abilitiesOf,
  abilityDef,
  VOCATIONS,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

/** O ícone de cada habilidade (Material Symbols). */
const ICON: Readonly<Record<string, string>> = {
  "golpe-brutal": "swords",
  "giro-da-lamina": "cyclone",
  atadura: "healing",
  desafio: "campaign",
  // O arqueiro do Ragnarok (24/11/2026).
  "rajada-dupla": "keyboard_double_arrow_right",
  "chuva-de-flechas": "rainy",
  "flecha-carregada": "north_east",
  concentracao: "center_focus_strong",
  "golpe-de-raio": "bolt",
  "golpe-de-chama": "local_fire_department",
  "onda-de-fogo": "whatshot",
  remendo: "healing",
  "golpe-de-gelo": "ac_unit",
  "onda-de-gelo": "severe_cold",
  "cura-do-companheiro": "volunteer_activism",
  seiva: "spa",
};

/** A chave do último uso: o herói (índice na corrida) e a habilidade. */
export function castKey(member: number, ability: string): string {
  return `${member}:${ability}`;
}

/**
 * A barra de habilidades da tela da dungeon (24/11/2026, "igual ux de RPG"): as 4 habilidades
 * do herói com a recarga correndo (a cortina desce e os segundos que faltam), apagadas sem
 * mana e acesas no segundo em que saem. A corrida já foi calculada no servidor: o último uso
 * vem do registro, e a mana e a recarga de cada uma vêm na corrida (adereços e DES).
 */
export function SkillBar(props: {
  member: RpgRunMemberView;
  index: number;
  /** Segundo da corrida agora e a mana do herói nele. */
  nowS: number;
  mana: number;
  dead: boolean;
  /** Último segundo em que cada habilidade saiu (castKey). */
  casts: Record<string, number>;
  /** "hud": a grande, dentro do painel de baixo (os cristais e o cinto em volta). */
  size: "big" | "mini" | "hud";
}) {
  const { t } = useLingui();
  const skills = () =>
    props.member.skills ??
    // Corrida de antes da barra: os números de partida, sem adereços.
    abilitiesOf(VOCATIONS[props.member.vocation].base).map((d) => ({
      id: d.id,
      mana: d.mana,
      cd_ms: d.cooldownMs,
    }));
  return (
    <Bar
      data-size={props.size}
      data-dead={props.dead ? "" : undefined}
      aria-label={t`Habilidades de ${props.member.name}`}
    >
      <For each={skills()}>
        {(s) => {
          const name = abilityDef(s.id)?.name ?? s.id;
          const at = () => props.casts[castKey(props.index, s.id)];
          const left = () => {
            const a = at();
            if (a === undefined) return 0;
            return Math.max(0, a * 1000 + s.cd_ms - props.nowS * 1000);
          };
          const frac = () => (s.cd_ms > 0 ? left() / s.cd_ms : 0);
          const secs = () => Math.ceil(left() / 1000);
          const noMana = () => props.mana < s.mana;
          const state = () =>
            left() > 0
              ? t`${name}: recarga, ${secs()} s`
              : noMana()
                ? t`${name}: sem mana (${s.mana})`
                : t`${name}: pronta`;
          return (
            <Slot
              title={`${name} · ${t`${s.mana} de mana`} · ${t`recarga ${s.cd_ms / 1000} s`}`}
              aria-label={state()}
              data-cd={left() > 0 ? "" : undefined}
              data-nomana={noMana() ? "" : undefined}
              data-cast={at() === props.nowS ? "" : undefined}
            >
              <Symbol size={props.size === "mini" ? 13 : 22}>
                {ICON[s.id] ?? "star"}
              </Symbol>
              <Wipe
                data-wipe=""
                style={{ height: `${Math.round(frac() * 100)}%` }}
              />
              <Show when={props.size !== "mini" && left() > 0}>
                <Secs>{secs()}</Secs>
              </Show>
            </Slot>
          );
        }}
      </For>
    </Bar>
  );
}

const Bar = styled("ul", {
  base: {
    display: "flex",
    gap: "6px",
    margin: 0,
    padding: 0,
    listStyle: "none",
    "&[data-size=big]": {
      justifyContent: "center",
      padding: "6px 8px",
      borderRadius: "12px",
      background: "rgba(15, 16, 21, 0.72)",
      alignSelf: "center",
    },
    "&[data-size=hud]": { justifyContent: "center", alignItems: "center" },
    "&[data-size=mini]": { gap: "3px", marginTop: "2px" },
    "&[data-dead]": { opacity: 0.4, filter: "grayscale(1)" },
  },
});

const Slot = styled("li", {
  base: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    borderRadius: "8px",
    background: "var(--md-sys-color-secondary-container)",
    color: "var(--md-sys-color-on-secondary-container)",
    boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
    transition: "box-shadow 0.2s ease, filter 0.2s ease",
    "[data-size=big] > &": { width: "44px", height: "44px" },
    "[data-size=hud] > &": { width: "44px", height: "44px" },
    "[data-size=mini] > &": {
      width: "20px",
      height: "20px",
      borderRadius: "5px",
    },
    // Sem mana: apagada e fria.
    "&[data-nomana]": {
      filter: "grayscale(0.85) brightness(0.7)",
    },
    // No segundo em que sai: acende.
    "&[data-cast]": {
      boxShadow:
        "inset 0 0 0 2px var(--md-sys-color-primary), 0 0 10px var(--md-sys-color-primary)",
    },
    "&[data-cast] > [data-wipe]": { transition: "none" },
    "@media (prefers-reduced-motion: reduce)": {
      transition: "none",
      "& > [data-wipe]": { transition: "none" },
    },
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
  },
});

const Secs = styled("span", {
  base: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    fontSize: "0.95rem",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    color: "#fff",
    textShadow: "0 1px 2px rgba(0, 0, 0, 0.8)",
    pointerEvents: "none",
  },
});
