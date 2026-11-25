import { Match, Show, Switch, createMemo, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RpgHeroState } from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { CLASSES } from "@muchat/space-core/game/ot/balance";
import { AttributesPanel } from "./AttributesPanel";
import { ClassPicker } from "./ClassPicker";
import { GearPanel } from "./GearPanel";
import { SkillsPanel } from "./SkillsPanel";
import { roleName } from "./gameText";
import { type GameLink, Bar, GameDialog, Gold, Tabs } from "./gameUi";
import { derivedOf, gold, heroBars, num, pending } from "./heroModel";

type Tab = "equip" | "attrs" | "skills";

/**
 * A ficha do herói (Idle Hunt v5): no topo, quem é, o nível com a barra de XP, o job, o ouro e a
 * Proficiência; embaixo, três abas com um selo do que pede atenção agora (pontos para gastar, item
 * melhor na mochila). Abre na aba que tem pendência. Sem herói, é a escolha de classe (D34).
 */
export default function HeroSheet(props: {
  link: GameLink;
  rpg: { hero: RpgHeroState | null; serverNow: number; at: number };
  name: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const state = () => props.rpg.hero;
  const hero = () => state()?.hero ?? null;
  const todo = createMemo(() => (hero() ? pending(hero()!) : null));
  const first = (): Tab => {
    const p = todo();
    if (p?.attrPoints) return "attrs";
    if (p?.skillPoints) return "skills";
    return "equip";
  };
  const [tab, setTab] = createSignal<Tab>(first());
  const bars = createMemo(() => (hero() ? heroBars(hero()!) : null));
  const d = createMemo(() => (hero() ? derivedOf(hero()!) : null));
  const inRun = () => !!state()?.run;

  return (
    <GameDialog
      id="rpg-hero"
      wide
      title={hero() ? props.name : t`Escolha sua classe`}
      subtitle={
        <Show when={bars()}>
          {(b) => (
            <>
              {b().title} · {roleName(CLASSES[hero()!.cls].role)} · T{b().tier}
            </>
          )}
        </Show>
      }
      onClose={props.onClose}
    >
      <Show
        when={hero() && bars() && d()}
        fallback={<ClassPicker link={props.link} />}
      >
        <Header>
          <Bar
            label={t`Nível ${bars()!.level}`}
            color="xp"
            frac={bars()!.xp.frac}
            text={
              bars()!.maxLevel
                ? t`nível máximo`
                : `${num(bars()!.xp.into)} / ${num(bars()!.xp.need)} XP`
            }
          />
          <Bar
            label={t`Job ${bars()!.job}`}
            color="job"
            frac={bars()!.jobXp.frac}
            text={`${num(bars()!.jobXp.into)} / ${num(bars()!.jobXp.need)}`}
          />
          <Facts>
            <Gold n={gold(hero()!.gold)} />
            <span
              title={t`A Proficiência efetiva é limitada pelo nível (10 × nível + 250); o resto fica guardado.`}
            >
              {t`Proficiência ${num(d()!.proficiencyEffective)}`}
              <Show when={hero()!.proficiency > d()!.proficiencyEffective}>
                {" "}
                {t`(+${num(hero()!.proficiency - d()!.proficiencyEffective)} guardada)`}
              </Show>
            </span>
            <span>{t`Vida ${num(d()!.hp)} · Mana ${num(d()!.mp)}`}</span>
          </Facts>
        </Header>
        <Show when={inRun()}>
          <Lock role="note">
            {t`Seu herói está numa dungeon: dá para olhar tudo, mas as trocas ficam para quando a corrida acabar.`}
          </Lock>
        </Show>
        <Tabs
          label={t`Ficha do herói`}
          value={tab()}
          onChange={setTab}
          items={[
            {
              id: "equip",
              label: t`Equipamento`,
              badge: todo()?.upgrades ? `▲${todo()!.upgrades}` : null,
            },
            {
              id: "attrs",
              label: t`Atributos`,
              badge: todo()?.attrPoints || null,
            },
            {
              id: "skills",
              label: t`Habilidades`,
              badge: todo()?.skillPoints || (todo()?.canEvolve ? "!" : null),
            },
          ]}
        />
        <div role="tabpanel">
          <Switch>
            <Match when={tab() === "equip"}>
              <GearPanel link={props.link} state={state()!} locked={inRun()} />
            </Match>
            <Match when={tab() === "attrs"}>
              <AttributesPanel
                link={props.link}
                hero={hero()!}
                locked={inRun()}
              />
            </Match>
            <Match when={tab() === "skills"}>
              <SkillsPanel link={props.link} hero={hero()!} locked={inRun()} />
            </Match>
          </Switch>
        </div>
      </Show>
    </GameDialog>
  );
}

const Header = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px 16px",
    "@container (max-width: 520px)": { gridTemplateColumns: "1fr" },
  },
});
const Facts = styled("div", {
  base: {
    gridColumn: "1 / -1",
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 16px",
    fontSize: "0.9em",
    fontVariantNumeric: "tabular-nums",
  },
});
const Lock = styled("div", {
  base: {
    padding: "8px 12px",
    borderRadius: "10px",
    background: "rgba(79, 143, 240, 0.12)",
    border: "1px solid rgba(79, 143, 240, 0.4)",
    fontSize: "0.9em",
  },
});
