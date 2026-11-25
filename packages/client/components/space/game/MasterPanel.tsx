import { For, Show, createMemo } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type RpgHeroState,
  balance as B,
  CLASSES,
  attributePanel,
  balanceHero,
  pointsSpent,
  skillPointsSpent,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { derivedName, roleName } from "./gameText";
import { GAME_DOWN, GAME_UP } from "./gameTheme";
import {
  type GameLink,
  Bar,
  Confirm,
  Gold,
  Muted,
  Notice,
  Panel,
  Row,
  Section,
  useCommands,
} from "./gameUi";
import {
  DERIVED_MAIN,
  derivedText,
  evolveCheck,
  gold,
  num,
  pct,
  respecCosts,
} from "./heroModel";

/**
 * O Mestre da evolução (§6, §10, D25): a evolução com o que falta escrito (marco e pontos), o que
 * ela libera; as redistribuições com o preço antes (a 1ª de cada é grátis, depois 5.000); a
 * Proficiência recomendada, a guardada e a efetiva (§2); e o resumo da build com os % efetivos
 * contra o chefe do nível.
 */
export function MasterPanel(props: {
  link: GameLink;
  npc: string;
  state: RpgHeroState;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const h = () => props.state.hero;
  const ev = createMemo(() => evolveCheck(h()));
  const costs = () => respecCosts(h());
  const panel = createMemo(() => attributePanel(balanceHero(h())));
  const boss = () => panel().versus.find((v) => v.archetype === "chefe")!;
  const prof = () => panel().proficiency;
  const role = () => CLASSES[h().cls].role;
  const act = async (action: string) =>
    cmd.run("rpg.master", { npc: props.npc, action });

  return (
    <Wrap>
      <Notice error={cmd.error()} />
      <Section aria-label={t`Evolução`}>
        <h3>{t`Evolução`}</h3>
        <Show
          when={ev().next}
          fallback={
            <Panel>
              <strong>{t`Você está no último tier: ${CLASSES[h().cls].titles[3]}.`}</strong>
            </Panel>
          }
        >
          {(next) => (
            <Panel data-ready={ev().ok ? "" : undefined}>
              <Row>
                <strong>
                  T{h().skills.tier} → T{next()}: {ev().newTitle}
                </strong>
                <Muted>{t`grátis`}</Muted>
              </Row>
              <Checks>
                <li data-ok={ev().milestone?.ok ? "" : undefined}>
                  {ev().milestone?.ok ? "✓" : "✗"}{" "}
                  {ev().milestone?.kind === "job"
                    ? t`Job ${ev().milestone!.need} (você tem ${ev().milestone!.have})`
                    : t`Nível ${ev().milestone!.need} (você tem ${ev().milestone!.have})`}
                </li>
                <li data-ok={ev().pointsLeft === 0 ? "" : undefined}>
                  {ev().pointsLeft === 0 ? "✓" : "✗"}{" "}
                  {ev().pointsLeft === 0
                    ? t`Pontos de habilidade gastos`
                    : t`Gaste mais ${ev().pointsLeft} pontos de habilidade (aba Habilidades da ficha)`}
                </li>
              </Checks>
              <Muted>
                {t`Libera: ${ev()
                  .newSkills.map((s) => s.name)
                  .join(
                    ", ",
                  )}; Potência até ${B.potencyCap(next())}; e mecânicas novas.`}
              </Muted>
              <Confirm
                tone="primary"
                disabled={!ev().ok || cmd.busy()}
                label={t`Evoluir para ${ev().newTitle}`}
                confirm={t`Evoluir agora? Toque de novo`}
                onConfirm={() => void act("evoluir")}
              />
            </Panel>
          )}
        </Show>
      </Section>

      <Section aria-label={t`Proficiência`}>
        <h3>{t`Proficiência (o treino no Dojô)`}</h3>
        <Panel>
          <Bar
            label={t`Efetiva ${num(prof().effective)} de ${num(prof().recommended)} recomendada`}
            color="prof"
            frac={
              prof().recommended > 0 ? prof().effective / prof().recommended : 1
            }
            text={pct(
              prof().recommended > 0
                ? Math.min(9.99, prof().effective / prof().recommended)
                : 1,
            )}
          />
          <Muted>
            {t`Recomendada: 10 × nível = ${num(prof().recommended)}. Guardada: ${num(prof().stored)}.`}
            <Show when={prof().held > 0}>
              {" "}
              {t`${num(prof().held)} estão acima do teto do seu nível e liberam ao subir.`}
            </Show>
          </Muted>
          <Show when={prof().effective < prof().recommended * 0.8}>
            <Muted role="note">
              {t`Abaixo da recomendada: treine no Dojô (o boneco) enquanto conversa; quem treina junto ganha mais.`}
            </Muted>
          </Show>
        </Panel>
      </Section>

      <Section aria-label={t`Resumo da build`}>
        <h3>{t`Resumo da build`}</h3>
        <Panel>
          <Row>
            <strong>
              {CLASSES[h().cls].titles[h().skills.tier - 1]} ·{" "}
              {roleName(role())}
            </strong>
            <Muted>{t`Nível ${h().level} · job ${h().job}`}</Muted>
          </Row>
          <Attrs>
            <For each={panel().rows}>
              {(r) => (
                <span>
                  <b>{r.stat}</b> {Math.round(r.total)}
                </span>
              )}
            </For>
          </Attrs>
          <Nums>
            <For each={DERIVED_MAIN[h().cls]}>
              {(k) => (
                <>
                  <span>{derivedName(k)}</span>
                  <strong>
                    {derivedText(k, panel().derived[k] as number)}
                  </strong>
                </>
              )}
            </For>
          </Nums>
          <Muted>{t`Contra o chefe do nível ${h().level}:`}</Muted>
          <Nums>
            <span>{t`Crítico`}</span>
            <strong>{pct(boss().crit)}</strong>
            <span>{t`Esquiva`}</span>
            <strong>{pct(boss().avoid)}</strong>
            <span>{t`Erro`}</span>
            <strong
              style={{ color: boss().miss > 0.15 ? GAME_DOWN : undefined }}
            >
              {pct(boss().miss)}
            </strong>
            <span>{t`Redução física`}</span>
            <strong
              style={{
                color:
                  role() === "tanque" && boss().physicalReduction >= 0.55
                    ? GAME_UP
                    : undefined,
              }}
            >
              {pct(boss().physicalReduction)}
            </strong>
            <span>{t`Redução mágica`}</span>
            <strong>{pct(boss().magicReduction)}</strong>
          </Nums>
        </Panel>
      </Section>

      <Section aria-label={t`Redistribuir`}>
        <h3>{t`Redistribuir`}</h3>
        <Cards>
          <Panel>
            <strong>{t`Atributos`}</strong>
            <Muted>
              {t`Todos voltam a 1 e os ${pointsSpent(h().attrs) - pointsSpent({ FOR: 1, AGI: 1, VIT: 1, INT: 1, DES: 1, SOR: 1 })} pontos ficam livres para distribuir de novo.`}
            </Muted>
            <Row>
              {costs().attrs === 0 ? (
                <Free>{t`Grátis (a 1ª)`}</Free>
              ) : (
                <Gold n={gold(costs().attrs)} />
              )}
            </Row>
            <Confirm
              disabled={cmd.busy() || costs().attrs > h().gold}
              label={t`Redistribuir atributos`}
              confirm={
                costs().attrs === 0
                  ? t`Zerar os atributos? Toque de novo`
                  : t`Pagar ${gold(costs().attrs)}? Toque de novo`
              }
              onConfirm={() => void act("redistribuir-atributos")}
            />
          </Panel>
          <Panel>
            <strong>{t`Habilidades`}</strong>
            <Muted>
              {t`Potência, Eficiência e Mecânicas voltam ao início e os ${skillPointsSpent(h().skills)} pontos ficam livres. Os slots e a IA ficam.`}
            </Muted>
            <Row>
              {costs().skills === 0 ? (
                <Free>{t`Grátis (a 1ª)`}</Free>
              ) : (
                <Gold n={gold(costs().skills)} />
              )}
            </Row>
            <Confirm
              disabled={
                cmd.busy() ||
                costs().skills > h().gold ||
                skillPointsSpent(h().skills) === 0
              }
              label={t`Redistribuir habilidades`}
              confirm={
                costs().skills === 0
                  ? t`Zerar as habilidades? Toque de novo`
                  : t`Pagar ${gold(costs().skills)}? Toque de novo`
              }
              onConfirm={() => void act("redistribuir-skills")}
            />
          </Panel>
        </Cards>
        <Muted>{t`Depois da 1ª, cada redistribuição custa 5.000 de ouro.`}</Muted>
      </Section>
    </Wrap>
  );
}

const Wrap = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "14px" },
});
const Checks = styled("ul", {
  base: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    "& > li": { color: "#ff8a7a" },
    "& > li[data-ok]": { color: "#7ee08a" },
  },
});
const Attrs = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 12px",
    fontVariantNumeric: "tabular-nums",
  },
});
const Nums = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto 1fr",
    gap: "2px 12px",
    fontSize: "0.92em",
    fontVariantNumeric: "tabular-nums",
    "& > strong": { textAlign: "right" },
    "@container (max-width: 520px)": { gridTemplateColumns: "auto 1fr" },
  },
});
const Cards = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "8px",
  },
});
const Free = styled("strong", { base: { color: "#7ee08a" } });
