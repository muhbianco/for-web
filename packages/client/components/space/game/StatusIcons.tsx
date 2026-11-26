import { For, Show, createMemo } from "solid-js";

import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/solid/macro";
import {
  type StatusTone,
  STATUS_COLOR,
  sortStatuses,
  statusGood,
  statusTone,
} from "@muchat/space-client";
import {
  type ClassId,
  type FrameStatus,
  type RpgRunMemberView,
  skillOf,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { mechanicName } from "./gameText";
import { num } from "./heroModel";
import { skillIcon } from "./skillText";

/**
 * Os efeitos ativos de um herói ou monstro na corrida (26/11/2026). As referências (Last Epoch,
 * as nameplates do WoW) separam o bom do ruim pela forma, não só pela cor: círculo é bom (buff,
 * cura, escudo), quadrado é ruim (veneno, fogo, maldição, lentidão). O tempo que falta fica
 * embaixo à direita e as camadas em cima, em cantos diferentes para não se cobrirem. O detalhe
 * (nome, de quem, quanto falta) vai no title e no rótulo para leitor de tela.
 */

const ICON: Record<StatusTone, string> = {
  buff: "trending_up",
  hot: "spa",
  shield: "shield",
  mana: "auto_awesome",
  poison: "science",
  burn: "local_fire_department",
  bleed: "water_drop",
  holy: "flare",
  debuff: "trending_down",
  curse: "skull",
  stun: "flash_on",
  taunt: "campaign",
};

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

function toneText(tone: StatusTone): string {
  switch (tone) {
    case "buff":
      return t`bônus`;
    case "hot":
      return t`cura por segundo`;
    case "shield":
      return t`escudo`;
    case "mana":
      return t`escudo de mana`;
    case "poison":
      return t`veneno`;
    case "burn":
      return t`queimadura`;
    case "bleed":
      return t`sangramento`;
    case "holy":
      return t`dano sagrado por segundo`;
    case "debuff":
      return t`enfraquecido`;
    case "curse":
      return t`maldição`;
    case "stun":
      return t`atordoado`;
    case "taunt":
      return t`provocado`;
  }
}

function statText(stat: string | undefined): string | null {
  switch (stat) {
    case "reducao":
    case "reducaoFisica":
    case "reducaoMagica":
    case "reducaoCerteiro":
      return t`recebe menos dano`;
    case "dano":
      return t`causa mais dano`;
    case "poder":
      return t`ataque e magia mais fortes`;
    case "critico":
    case "multCritico":
      return t`mais crítico`;
    case "fuga":
    case "esquiva":
      return t`esquiva mais`;
    case "precisao":
      return t`mexe na precisão`;
    case "hpMaxPct":
      return t`vida máxima maior`;
    case "curaRecebida":
      return t`recebe mais cura`;
    case "regenManaPct":
      return t`recupera mana`;
    case "regenVidaPct":
      return t`recupera vida`;
    case "danoCausado":
      return t`causa menos dano`;
    case "danoRecebido":
      return t`recebe mais dano`;
    case "velocidade":
      return t`ataca mais devagar`;
    case "defesa":
      return t`defesa menor`;
    default:
      return null;
  }
}

export interface StatusView {
  st: FrameStatus;
  tone: StatusTone;
  name: string;
  icon: string;
  /** A frase do title e do leitor de tela. */
  text: string;
}

/** Os efeitos com nome, ícone e frase (pronto para a tela e para o teste). */
export function statusViews(
  list: readonly FrameStatus[] | undefined,
  members: readonly Pick<RpgRunMemberView, "cls" | "name">[],
  own: ClassId | null,
): StatusView[] {
  if (!list?.length) return [];
  const views = list.map((st): StatusView => {
    const authorCls =
      (st.a !== undefined ? members[st.a]?.cls : undefined) ?? own;
    const tone = statusTone(st, authorCls);
    const skill = authorCls ? skillOf(authorCls, st.s) : undefined;
    const name =
      st.s === "maldicao"
        ? mechanicName("maldicao")
        : st.s === "drenar"
          ? mechanicName("dreno")
          : st.k === "atordoado"
            ? t`Atordoado`
            : st.k === "provocado"
              ? t`Provocado`
              : (skill?.name ?? (st.k === "escudo" ? t`Escudo` : st.s));
    const icon =
      tone === "buff" && authorCls && skill
        ? skillIcon(authorCls, st.s)
        : ICON[tone];
    const by = st.a !== undefined && members[st.a] ? members[st.a]!.name : null;
    const bits = [
      `${name}: ${toneText(tone)}`,
      statText(st.st),
      st.k === "escudo" && st.v ? t`segura ${num(st.v)}` : null,
      st.n && st.n > 1 ? t`${st.n} camadas` : null,
      t`${st.t} s`,
      by && st.k !== "provocado" ? t`de ${by}` : null,
      by && st.k === "provocado" ? t`preso em ${by}` : null,
    ].filter(Boolean);
    return { st, tone, name, icon, text: bits.join(" · ") };
  });
  return sortStatuses(views);
}

/** A fileira de ícones; `max`: quantos cabem (o resto vira "+N"). */
export function StatusIcons(props: {
  list: readonly FrameStatus[] | undefined;
  members: readonly Pick<RpgRunMemberView, "cls" | "name">[];
  own: ClassId | null;
  label: string;
  max?: number;
  size?: "sm" | "md";
}) {
  const { t } = useLingui();
  const views = createMemo(() =>
    statusViews(props.list, props.members, props.own),
  );
  const max = () => props.max ?? 8;
  return (
    <Show when={views().length > 0}>
      <Row role="list" aria-label={props.label} data-size={props.size ?? "md"}>
        <For each={views().slice(0, max())}>
          {(v) => (
            <Tile
              role="listitem"
              aria-label={v.text}
              title={v.text}
              data-good={statusGood(v.tone) ? "" : undefined}
              style={{ "--tone": hex(STATUS_COLOR[v.tone]) }}
            >
              <Symbol size={props.size === "sm" ? 11 : 15}>{v.icon}</Symbol>
              <Show when={(v.st.n ?? 1) > 1}>
                <Stacks aria-hidden="true">{v.st.n}</Stacks>
              </Show>
              <Time aria-hidden="true">{v.st.t}</Time>
            </Tile>
          )}
        </For>
        <Show when={views().length > max()}>
          <More
            role="listitem"
            title={views()
              .slice(max())
              .map((v) => v.text)
              .join("\n")}
            aria-label={t`Mais ${views().length - max()} efeitos`}
          >
            +{views().length - max()}
          </More>
        </Show>
      </Row>
    </Show>
  );
}

const Row = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "3px",
    "--tile": "22px",
    "&[data-size=sm]": { "--tile": "16px", gap: "2px" },
  },
});
const Tile = styled("span", {
  base: {
    position: "relative",
    display: "inline-grid",
    placeItems: "center",
    width: "var(--tile)",
    height: "var(--tile)",
    color: "var(--tone)",
    background: "rgba(10, 9, 8, 0.82)",
    border: "1.5px solid var(--tone)",
    // Ruim: quadrado; bom: círculo (a forma diz antes da cor).
    borderRadius: "3px",
    "&[data-good]": { borderRadius: "999px" },
    cursor: "help",
  },
});
const Time = styled("span", {
  base: {
    position: "absolute",
    right: "-3px",
    bottom: "-4px",
    fontSize: "9px",
    lineHeight: 1,
    fontWeight: 800,
    color: "#fff",
    textShadow: "0 0 2px #000, 0 0 2px #000",
    fontVariantNumeric: "tabular-nums",
    "[data-size=sm] &": { fontSize: "8px" },
  },
});
const Stacks = styled("span", {
  base: {
    position: "absolute",
    right: "-3px",
    top: "-4px",
    fontSize: "9px",
    lineHeight: 1,
    fontWeight: 900,
    color: "#ffe7a8",
    textShadow: "0 0 2px #000, 0 0 2px #000",
    "[data-size=sm] &": { fontSize: "8px" },
  },
});
const More = styled("span", {
  base: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: "var(--tile)",
    height: "var(--tile)",
    fontSize: "10px",
    fontWeight: 800,
    color: "#c4b8a2",
    cursor: "help",
  },
});
