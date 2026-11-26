import { type JSX, For, Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type ClassId,
  type Condition,
  type HeroStats,
  type HeroV5,
  type RpgRunMemberView,
  type SkillContent,
  type SkillDef,
  balance as B,
  compileSkill,
  freshBuild,
  skillOf,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { type TipBind, HoverTip } from "./ItemTip";
import { conditionText } from "./gameText";
import { type SkillRow, derivedOf, num, skillNumbers } from "./heroModel";
import { longestEffectMs, skillIcon, skillLines } from "./skillText";

/** O que o detalhe de uma skill mostra (montado só com o detalhe aberto). */
export interface SkillTipInfo {
  cls: ClassId;
  content: SkillContent;
  /** A skill compilada (os pontos e os lendários de quem joga, ou a de base). */
  def: SkillDef;
  /** Os atributos de quem usa (os números prontos); null: a skill de outra pessoa. */
  stats: HeroStats | null;
  mana: number;
  cooldownS: number;
  /** A IA da skill; sem ela, a linha não aparece (a de outra pessoa o app não sabe). */
  ai?: Condition[];
  customAi?: boolean;
  learned?: boolean;
  /** 0–3 nos slots, ou −1. */
  slot?: number;
  build?: { potency: number; efficiency: number };
  mechanics?: { name: string; ups: number }[];
  /** Os números são os de base (quem assiste não recebe os pontos de quem joga). */
  base?: boolean;
}

/** A skill na ficha (aprendida ou não): os pontos marcados entram como no detalhe ao lado. */
export function heroSkillInfo(h: HeroV5, row: SkillRow): SkillTipInfo {
  return {
    cls: h.cls,
    content: row.content,
    def: row.numbers.def,
    stats: derivedOf(h),
    mana: row.numbers.mana,
    cooldownS: row.numbers.cooldownS,
    ai: h.skills.ai[row.content.id] ?? row.content.ai,
    customAi: !!h.skills.ai[row.content.id],
    learned: row.learned,
    slot: row.slot,
    build: row.learned
      ? { potency: row.build.potency, efficiency: row.build.efficiency }
      : undefined,
    mechanics: row.mechanics
      .filter((m) => m.ups > 0)
      .map((m) => ({ name: m.name, ups: m.ups })),
  };
}

/**
 * A skill na barra da corrida: a mana e a recarga são as da corrida (o servidor manda as finais de
 * cada um). Na minha, o texto sai dos meus pontos; na de quem eu assisto, da skill de base.
 */
export function runSkillInfo(
  member: RpgRunMemberView,
  s: { id: string; mana: number; cd_ms: number },
  hero: HeroV5 | null,
): SkillTipInfo | null {
  const content = skillOf(member.cls, s.id);
  if (!content) return null;
  const common = {
    cls: member.cls,
    content,
    mana: s.mana,
    cooldownS: s.cd_ms / 1000,
  };
  if (!hero || hero.cls !== member.cls) {
    return {
      ...common,
      def: compileSkill(content, freshBuild()),
      stats: null,
      base: true,
    };
  }
  const build = hero.skills.builds[s.id] ?? freshBuild();
  return {
    ...common,
    def: skillNumbers(hero, content, build).def,
    stats: derivedOf(hero),
    ai: hero.skills.ai[s.id] ?? content.ai,
    customAi: !!hero.skills.ai[s.id],
    slot: hero.skills.slots.indexOf(s.id),
    build: { potency: build.potency, efficiency: build.efficiency },
    mechanics: content.mechanics
      .map((m) => ({ name: m.name, ups: build.mechanics[m.id] ?? 0 }))
      .filter((m) => m.ups > 0),
  };
}

/** O detalhe ao parar em cima de uma skill (mouse, Tab, toque longo), como o dos itens. */
export function SkillTip(props: {
  info: () => SkillTipInfo | null;
  children: (bind: TipBind) => JSX.Element;
}) {
  return (
    <HoverTip
      enabled
      width={320}
      content={() => (
        <Show when={props.info()}>{(i) => <SkillCard info={i()} />}</Show>
      )}
    >
      {props.children}
    </HoverTip>
  );
}

const secs = (x: number) =>
  `${Number.isInteger(x) ? x : x.toFixed(1).replace(".", ",")} s`;

/**
 * O que a skill faz: mana, recarga e quanto dura; cada efeito em uma frase (com o número de quem
 * usa); quando a IA solta; os pontos e as Mecânicas que já estão nela.
 */
export function SkillCard(props: { info: SkillTipInfo }) {
  const { t } = useLingui();
  const i = () => props.info;
  const lines = () => skillLines(i().def, i().stats);
  const lasts = () => longestEffectMs(i().def);
  return (
    <Card>
      <Top>
        <Icon aria-hidden="true">
          <Symbol size={26}>{skillIcon(i().cls, i().content.id)}</Symbol>
        </Icon>
        <div>
          <Name>{i().content.name}</Name>
          <Meta>
            T{i().content.tier} · {i().content.target}
          </Meta>
        </div>
      </Top>

      <Facts>
        <span>
          <small>{t`Mana`}</small>
          <b>{num(i().mana)}</b>
        </span>
        <span>
          <small>{t`Recarga`}</small>
          <b>{secs(i().cooldownS)}</b>
        </span>
        <span>
          <small>{t`Duração`}</small>
          <b>{lasts() > 0 ? secs(lasts() / 1000) : t`na hora`}</b>
        </span>
      </Facts>

      <Block>
        <h4>{t`O que faz`}</h4>
        <ul>
          <For each={lines()}>{(l) => <li>{l}</li>}</For>
        </ul>
      </Block>

      <Show when={i().ai}>
        {(ai) => (
          <Block>
            <h4>{t`Quando usa`}</h4>
            <Chips>
              <For each={ai()}>
                {(c, k) => (
                  <>
                    <Show when={k() > 0}>
                      <small>{t`ou`}</small>
                    </Show>
                    <Chip>{conditionText(c)}</Chip>
                  </>
                )}
              </For>
              <Show when={!i().customAi}>
                <small>{t`(padrão)`}</small>
              </Show>
            </Chips>
          </Block>
        )}
      </Show>

      <Show when={i().build}>
        {(b) => (
          <Points>
            {t`Potência ${b().potency} · Eficiência ${b().efficiency}`}
            <For each={i().mechanics}>
              {(m) => (
                <>
                  {" · "}
                  {m.name} {m.ups}/{B.cfg.skills.mechanicMax}
                </>
              )}
            </For>
          </Points>
        )}
      </Show>

      <Show when={i().learned === false}>
        <Note data-tone="lock">{t`🔒 Abre no T${i().content.tier}: evolua no Mestre da evolução.`}</Note>
      </Show>
      <Show when={i().learned !== false && (i().slot ?? -1) >= 0}>
        <Note>{t`No slot ${(i().slot ?? 0) + 1}º da corrida.`}</Note>
      </Show>
      <Show when={i().learned && (i().slot ?? -1) < 0}>
        <Note>{t`Fora dos slots: não sai na corrida.`}</Note>
      </Show>
      <Show when={i().base}>
        <Note>{t`Números de base: os pontos de quem joga não chegam para quem assiste.`}</Note>
      </Show>
    </Card>
  );
}

const Card = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "var(--md-sys-color-surface-container)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderTop: "3px solid #4f8ff0",
  },
});
const Top = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "10px",
    alignItems: "center",
    "& > div": {
      display: "flex",
      flexDirection: "column",
      gap: "1px",
      minWidth: 0,
    },
  },
});
const Icon = styled("span", {
  base: {
    display: "grid",
    placeItems: "center",
    width: "40px",
    height: "40px",
    borderRadius: "10px",
    background: "rgba(79, 143, 240, 0.16)",
    border: "1px solid rgba(79, 143, 240, 0.45)",
    color: "#d6e6ff",
  },
});
const Name = styled("strong", {
  base: { fontSize: "1.05rem", lineHeight: 1.2, color: "#d6e6ff" },
});
const Meta = styled("span", {
  base: {
    fontSize: "0.82em",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
const Facts = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "6px",
    "& > span": {
      display: "flex",
      flexDirection: "column",
      gap: "1px",
      padding: "4px 8px",
      borderRadius: "8px",
      background: "rgba(0, 0, 0, 0.22)",
      minWidth: 0,
    },
    "& small": {
      fontSize: "0.72em",
      color: "var(--md-sys-color-on-surface-variant)",
    },
    "& b": { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  },
});
const Block = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    "& h4": {
      margin: 0,
      fontSize: "0.75em",
      fontWeight: 800,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color: "var(--md-sys-color-on-surface-variant)",
    },
    "& ul": {
      margin: 0,
      paddingInlineStart: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "3px",
      fontSize: "0.9em",
    },
    "& li::marker": { color: "#4f8ff0" },
  },
});
const Chips = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    alignItems: "center",
    "& small": {
      fontSize: "0.78em",
      color: "var(--md-sys-color-on-surface-variant)",
    },
  },
});
const Chip = styled("span", {
  base: {
    fontSize: "0.75rem",
    padding: "2px 8px",
    borderRadius: "999px",
    background: "rgba(79, 143, 240, 0.16)",
    border: "1px solid rgba(79, 143, 240, 0.45)",
    color: "#d6e6ff",
  },
});
const Points = styled("div", {
  base: {
    fontSize: "0.82em",
    color: "var(--md-sys-color-on-surface-variant)",
    paddingTop: "6px",
    borderTop: "1px solid var(--md-sys-color-outline-variant)",
  },
});
const Note = styled("div", {
  base: {
    fontSize: "0.82em",
    color: "var(--md-sys-color-on-surface-variant)",
    "&[data-tone=lock]": { color: "#ffcfc6" },
  },
});
