import {
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type Condition,
  type HeroV5,
  MAX_SLOTS,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import {
  type ConditionKind,
  CONDITION_KINDS,
  conditionText,
  defaultCondition,
} from "./gameText";
import { GAME_UP } from "./gameTheme";
import {
  type GameLink,
  Badge,
  Btn,
  Delta,
  Muted,
  Notice,
  Panel,
  Row,
  Section,
  useCommands,
} from "./gameUi";
import {
  type SkillRow,
  type SpendTarget,
  derivedOf,
  num,
  skillBudget,
  skillRows,
  stageSpend,
  tierJob,
} from "./heroModel";
import { skillLines } from "./skillText";
import { SkillTip, heroSkillInfo } from "./SkillTip";

/**
 * Habilidades (spec §7): os 4 slots em ordem de prioridade, cada um com a IA que decide quando a
 * skill sai (P39: sempre visível); as 6 skills da classe, as bloqueadas dizendo em que tier abrem.
 * Os pontos (Potência, Eficiência, Mecânicas) se marcam antes, com o número principal, a mana e a
 * recarga antes → depois, e só vão ao servidor no "Confirmar". Trocar slot e IA vale na hora:
 * dá para desfazer a qualquer momento fora da corrida.
 */
export function SkillsPanel(props: {
  link: GameLink;
  hero: HeroV5;
  locked: boolean;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [draft, setDraft] = createSignal(props.hero.skills);
  const [log, setLog] = createSignal<{ skill: string; target: SpendTarget }[]>(
    [],
  );
  const [sel, setSel] = createSignal<string | null>(
    props.hero.skills.slots[0] ?? null,
  );
  const [ok, setOk] = createSignal<string | null>(null);
  const base = () => props.hero.skills;
  // Um estado novo do servidor (trocou um slot, salvou a IA): os pontos marcados são refeitos por
  // cima dele, pela mesma regra (o que não couber mais sai). Durante o "Confirmar" o rascunho só
  // acompanha o servidor, senão os pontos que já chegaram contariam duas vezes.
  let confirming = false;
  const skillsKey = createMemo(() => JSON.stringify(props.hero.skills));
  createEffect(
    on(
      skillsKey,
      () => {
        if (confirming) {
          setDraft(props.hero.skills);
          return;
        }
        let d = props.hero.skills;
        const kept: { skill: string; target: SpendTarget }[] = [];
        for (const x of log()) {
          const r = stageSpend(props.hero, d, x.skill, x.target);
          if (!r.ok) continue;
          d = r.skills;
          kept.push(x);
        }
        setDraft(d);
        setLog(kept);
      },
      { defer: true },
    ),
  );

  const before = createMemo(() => skillRows(props.hero, base()));
  const rows = createMemo(() => skillRows(props.hero, draft()));
  const budget = createMemo(() => skillBudget(props.hero, draft()));
  const row = () => rows().find((r) => r.content.id === sel()) ?? null;
  const old = () => before().find((r) => r.content.id === sel()) ?? null;
  const slots = () => base().slots;

  const spend = (skill: string, target: SpendTarget) => {
    setOk(null);
    const r = stageSpend(props.hero, draft(), skill, target);
    if (!r.ok) {
      cmd.setError(null);
      return;
    }
    setDraft(r.skills);
    setLog([...log(), { skill, target }]);
  };
  const undo = () => {
    setDraft(props.hero.skills);
    setLog([]);
  };
  const confirm = async () => {
    const list = log().map(
      (x) =>
        ["rpg.skill.spend", { skill: x.skill, target: x.target }] as [
          string,
          Record<string, unknown>,
        ],
    );
    confirming = true;
    const r = await cmd.runAll(list);
    confirming = false;
    setLog([]);
    setDraft(props.hero.skills);
    if (r?.ok) setOk(t`Pontos confirmados.`);
  };
  const setSlots = (next: string[]) => {
    setOk(null);
    void cmd.run("rpg.skill.slots", { slots: next });
  };
  const moveSlot = (i: number, d: -1 | 1) => {
    const s = [...slots()];
    const j = i + d;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j]!, s[i]!];
    setSlots(s);
  };

  return (
    <Wrap>
      <Head>
        <strong>
          {t`Pontos de habilidade`}:{" "}
          <Big
            data-has={budget().free > 0 && budget().room > 0 ? "" : undefined}
          >
            {Math.max(0, budget().free)}
          </Big>
          <Muted> {t`de ${budget().total} (1 por nível de job)`}</Muted>
        </strong>
        <Muted>
          {t`Tier ${draft().tier}: Potência até ${budget().potencyCap}; Eficiência e cada Mecânica até ${budget().mechanicMax}.`}
        </Muted>
        <Show when={budget().free > budget().room}>
          <Hold role="note">
            {t`${budget().free - budget().room} pontos não cabem mais neste tier: evolua no Mestre da evolução para abrir mais.`}
          </Hold>
        </Show>
      </Head>

      <Section aria-label={t`Slots da corrida`}>
        <h3>{t`Slots da corrida (em ordem de prioridade)`}</h3>
        <SlotRow>
          <Index each={Array.from({ length: MAX_SLOTS })}>
            {(_, i) => {
              const id = () => slots()[i];
              const r = () => rows().find((x) => x.content.id === id());
              return (
                <SlotCard
                  data-empty={id() ? undefined : ""}
                  aria-current={id() && sel() === id() ? "true" : undefined}
                >
                  <Prio>{i + 1}º</Prio>
                  <Show
                    when={r()}
                    fallback={
                      <Muted>{t`Vazio: escolha uma skill abaixo e "Pôr no slot".`}</Muted>
                    }
                  >
                    {(x) => (
                      <>
                        <SkillTip info={() => heroSkillInfo(props.hero, x())}>
                          {(bind) => (
                            <SlotName
                              {...bind}
                              type="button"
                              onClick={() => setSel(x().content.id)}
                            >
                              {x().content.name}
                            </SlotName>
                          )}
                        </SkillTip>
                        <AiLine>
                          <For each={aiOf(props.hero, x())}>
                            {(c) => <Chip>{conditionText(c)}</Chip>}
                          </For>
                          <Show when={!props.hero.skills.ai[x().content.id]}>
                            <Muted>{t`(padrão)`}</Muted>
                          </Show>
                        </AiLine>
                        <Row>
                          <Btn
                            type="button"
                            data-size="sm"
                            aria-label={t`Subir a prioridade`}
                            disabled={props.locked || cmd.busy() || i === 0}
                            onClick={() => moveSlot(i, -1)}
                          >
                            ↑
                          </Btn>
                          <Btn
                            type="button"
                            data-size="sm"
                            aria-label={t`Descer a prioridade`}
                            disabled={
                              props.locked ||
                              cmd.busy() ||
                              i >= slots().length - 1
                            }
                            onClick={() => moveSlot(i, 1)}
                          >
                            ↓
                          </Btn>
                          <Btn
                            type="button"
                            data-size="sm"
                            data-tone="quiet"
                            aria-label={t`Tirar do slot`}
                            disabled={props.locked || cmd.busy()}
                            onClick={() =>
                              setSlots(slots().filter((s) => s !== id()))
                            }
                          >
                            ×
                          </Btn>
                        </Row>
                      </>
                    )}
                  </Show>
                </SlotCard>
              );
            }}
          </Index>
        </SlotRow>
      </Section>

      <Layout>
        <Section aria-label={t`Skills da classe`}>
          <h3>{t`Skills da classe`}</h3>
          <List>
            <For each={rows()}>
              {(r) => (
                <SkillTip info={() => heroSkillInfo(props.hero, r)}>
                  {(bind) => (
                    <SkillBtn
                      {...bind}
                      type="button"
                      aria-pressed={sel() === r.content.id}
                      data-locked={r.learned ? undefined : ""}
                      onClick={() => setSel(r.content.id)}
                    >
                      <span>
                        <strong>{r.content.name}</strong>
                        <Show when={r.slot >= 0}>
                          <Badge>{r.slot + 1}º</Badge>
                        </Show>
                      </span>
                      <small>
                        {r.learned
                          ? t`T${r.content.tier} · Potência ${r.build.potency} · Eficiência ${r.build.efficiency}`
                          : t`🔒 abre no T${r.content.tier} (job ${tierJob(r.content.tier)})`}
                      </small>
                    </SkillBtn>
                  )}
                </SkillTip>
              )}
            </For>
          </List>
        </Section>

        <Show when={row()}>
          {(r) => (
            <Detail
              row={r()}
              old={old()!}
              hero={props.hero}
              budget={budget()}
              locked={props.locked || cmd.busy()}
              slotted={slots().includes(r().content.id)}
              slotsFull={slots().length >= MAX_SLOTS}
              onSpend={(target) => spend(r().content.id, target)}
              onSlot={() => setSlots([...slots(), r().content.id])}
              onSaveAi={async (conditions) => {
                const res = await cmd.run("rpg.skill.ai", {
                  skill: r().content.id,
                  conditions,
                });
                if (res?.ok) setOk(t`IA salva.`);
              }}
            />
          )}
        </Show>
      </Layout>

      <Notice error={cmd.error()} ok={ok()} />
      <Footer>
        <Btn
          type="button"
          data-tone="primary"
          disabled={props.locked || cmd.busy() || log().length === 0}
          onClick={confirm}
        >
          {log().length > 0
            ? t`Confirmar ${log().length} pontos`
            : t`Confirmar`}
        </Btn>
        <Btn type="button" disabled={log().length === 0} onClick={undo}>
          {t`Desfazer`}
        </Btn>
        <Muted>{t`Os pontos só voltam no Mestre da evolução (a 1ª redistribuição é grátis).`}</Muted>
      </Footer>
    </Wrap>
  );
}

const aiOf = (h: HeroV5, r: SkillRow): Condition[] =>
  h.skills.ai[r.content.id] ?? r.content.ai;

function Detail(props: {
  row: SkillRow;
  old: SkillRow;
  hero: HeroV5;
  budget: ReturnType<typeof skillBudget>;
  locked: boolean;
  slotted: boolean;
  slotsFull: boolean;
  onSpend: (t: SpendTarget) => void;
  onSlot: () => void;
  onSaveAi: (c: Condition[] | null) => void;
}) {
  const { t } = useLingui();
  const [editing, setEditing] = createSignal(false);
  const s = () => props.row.content;
  const n = () => props.row.numbers;
  const o = () => props.old.numbers;
  const canSpend = () =>
    !props.locked && props.row.learned && props.budget.free > 0;
  const mainLabel = () =>
    n().main.kind === "dano"
      ? t`Dano esperado`
      : n().main.kind === "cura"
        ? t`Cura esperada`
        : n().main.kind === "escudo"
          ? t`Escudo`
          : t`Efeito de apoio (a Potência tira recarga)`;
  return (
    <Panel aria-live="polite">
      <Row>
        <strong>{s().name}</strong>
        <Muted>
          T{s().tier} · {s().target}
        </Muted>
      </Row>
      <Show when={!props.row.learned}>
        <Muted>{t`Abre no T${s().tier}: evolua no Mestre da evolução.`}</Muted>
      </Show>
      <Does aria-label={t`O que faz`}>
        <For each={skillLines(n().def, derivedOf(props.hero))}>
          {(l) => <li>{l}</li>}
        </For>
      </Does>
      <Nums>
        <Show
          when={n().main.kind !== "apoio"}
          fallback={<span>{mainLabel()}</span>}
        >
          <span>{mainLabel()}</span>
          <Delta
            a={o().main.value}
            b={n().main.value}
            fmt={num}
            compact={o().main.value === n().main.value}
          />
        </Show>
        <span>{t`Mana`}</span>
        <Delta
          a={o().mana}
          b={n().mana}
          fmt={num}
          dir={n().mana < o().mana - 0.5 ? 1 : 0}
          compact={Math.abs(o().mana - n().mana) < 0.5}
        />
        <span>{t`Recarga`}</span>
        <Delta
          a={o().cooldownS}
          b={n().cooldownS}
          fmt={(x) => `${x.toFixed(1).replace(".", ",")} s`}
          dir={n().cooldownS < o().cooldownS - 0.01 ? 1 : 0}
          compact={Math.abs(o().cooldownS - n().cooldownS) < 0.01}
        />
      </Nums>

      <Show when={props.row.learned}>
        <Ups>
          <Up
            label={t`Potência`}
            hint={t`+5% no número principal por ponto (na skill de apoio, −1% de recarga).`}
            value={props.row.build.potency}
            max={props.budget.potencyCap}
            staged={props.row.build.potency - props.old.build.potency}
            disabled={
              !canSpend() || props.row.build.potency >= props.budget.potencyCap
            }
            onAdd={() => props.onSpend("potencia")}
          />
          <Up
            label={t`Eficiência`}
            hint={t`−4% de mana e −3% de recarga por ponto.`}
            value={props.row.build.efficiency}
            max={props.budget.efficiencyMax}
            staged={props.row.build.efficiency - props.old.build.efficiency}
            disabled={
              !canSpend() ||
              props.row.build.efficiency >= props.budget.efficiencyMax
            }
            onAdd={() => props.onSpend("eficiencia")}
          />
          <For each={props.row.mechanics}>
            {(m) => (
              <Up
                label={m.name}
                hint={
                  m.locked ? t`Abre no T${m.unlockTier}. ${m.text}` : m.text
                }
                value={m.ups}
                max={props.budget.mechanicMax}
                staged={
                  m.ups -
                  (props.old.mechanics.find((x) => x.id === m.id)?.ups ?? 0)
                }
                locked={m.locked ? m.unlockTier : undefined}
                disabled={
                  !canSpend() || m.locked || m.ups >= props.budget.mechanicMax
                }
                onAdd={() => props.onSpend({ mechanic: m.id })}
              />
            )}
          </For>
        </Ups>
      </Show>

      <Show when={props.row.learned && !props.slotted}>
        <Btn
          type="button"
          disabled={props.locked || props.slotsFull}
          onClick={props.onSlot}
        >
          {props.slotsFull
            ? t`Slots cheios: tire uma skill antes`
            : t`Pôr no slot`}
        </Btn>
      </Show>

      <Show when={props.row.learned}>
        <AiBox>
          <Row>
            <strong>{t`Quando usar (IA)`}</strong>
            <Show when={!editing()}>
              <Btn
                type="button"
                data-size="sm"
                disabled={props.locked}
                onClick={() => setEditing(true)}
              >
                {t`Editar`}
              </Btn>
            </Show>
          </Row>
          <Show
            when={editing()}
            fallback={
              <AiLine>
                <For each={aiOf(props.hero, props.row)}>
                  {(c, i) => (
                    <>
                      <Show when={i() > 0}>
                        <Muted>{t`ou`}</Muted>
                      </Show>
                      <Chip>{conditionText(c)}</Chip>
                    </>
                  )}
                </For>
                <Show when={!props.hero.skills.ai[s().id]}>
                  <Muted>{t`(a padrão da skill)`}</Muted>
                </Show>
              </AiLine>
            }
          >
            <AiEditor
              start={aiOf(props.hero, props.row)}
              fallback={s().ai}
              onCancel={() => setEditing(false)}
              onSave={(c) => {
                props.onSaveAi(c);
                setEditing(false);
              }}
            />
          </Show>
        </AiBox>
      </Show>
    </Panel>
  );
}

function Up(props: {
  label: string;
  hint: string;
  value: number;
  max: number;
  staged: number;
  locked?: number;
  disabled: boolean;
  onAdd: () => void;
}) {
  const { t } = useLingui();
  return (
    <UpRow
      data-locked={props.locked ? "" : undefined}
      data-staged={props.staged > 0 ? "" : undefined}
    >
      <div>
        <strong>{props.label}</strong>
        <small>{props.hint}</small>
      </div>
      <Pips aria-label={t`${props.value} de ${props.max}`}>
        {props.locked ? (
          t`🔒 T${props.locked}`
        ) : (
          <>
            {props.value}/{props.max}
            <Show when={props.staged > 0}>
              <span style={{ color: GAME_UP }}> (+{props.staged})</span>
            </Show>
          </>
        )}
      </Pips>
      <Btn
        type="button"
        data-size="sm"
        data-tone={props.disabled ? undefined : "primary"}
        aria-label={t`Marcar 1 ponto em ${props.label}`}
        disabled={props.disabled}
        onClick={props.onAdd}
      >
        +1
      </Btn>
    </UpRow>
  );
}

/** Até 3 condições (vale se qualquer uma valer), com os números de cada uma. */
function AiEditor(props: {
  start: Condition[];
  fallback: Condition[];
  onSave: (c: Condition[] | null) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [list, setList] = createSignal<Condition[]>(
    props.start.map((c) => ({ ...c })),
  );
  const set = (i: number, c: Condition) =>
    setList(list().map((x, j) => (j === i ? c : x)));
  return (
    <EditBox>
      <Index each={list()}>
        {(c, i) => (
          <EditRow>
            <Show when={i > 0}>
              <Muted>{t`ou`}</Muted>
            </Show>
            <select
              aria-label={t`Condição ${i + 1}`}
              value={c().kind}
              onChange={(e) =>
                set(i, defaultCondition(e.currentTarget.value as ConditionKind))
              }
            >
              <For each={CONDITION_KINDS}>
                {(k) => (
                  <option value={k}>
                    {conditionText(defaultCondition(k))}
                  </option>
                )}
              </For>
            </select>
            <Show when={"pct" in c()}>
              <label>
                <span>{Math.round((c() as { pct: number }).pct * 100)}%</span>
                <input
                  type="range"
                  min={0.1}
                  max={0.9}
                  step={0.05}
                  value={(c() as { pct: number }).pct}
                  aria-label={t`Porcentagem`}
                  onInput={(e) =>
                    set(i, {
                      ...c(),
                      pct: Number(e.currentTarget.value),
                    } as Condition)
                  }
                />
              </label>
            </Show>
            <Show when={"min" in c()}>
              <label>
                <span>{t`mín.`}</span>
                <input
                  type="number"
                  min={1}
                  max={c().kind === "inimigos" ? 20 : 4}
                  value={(c() as { min: number }).min}
                  aria-label={t`Quantos no mínimo`}
                  onChange={(e) =>
                    set(i, {
                      ...c(),
                      min: Math.max(
                        1,
                        Math.floor(Number(e.currentTarget.value)) || 1,
                      ),
                    } as Condition)
                  }
                />
              </label>
            </Show>
            <Btn
              type="button"
              data-size="sm"
              data-tone="quiet"
              aria-label={t`Tirar a condição`}
              disabled={list().length <= 1}
              onClick={() => setList(list().filter((_, j) => j !== i))}
            >
              ×
            </Btn>
          </EditRow>
        )}
      </Index>
      <Row>
        <Btn
          type="button"
          data-size="sm"
          disabled={list().length >= 3}
          onClick={() => setList([...list(), { kind: "sempre" }])}
        >
          {t`+ condição`}
        </Btn>
        <Btn
          type="button"
          data-size="sm"
          data-tone="primary"
          onClick={() => props.onSave(list())}
        >
          {t`Salvar IA`}
        </Btn>
        <Btn type="button" data-size="sm" onClick={() => props.onSave(null)}>
          {t`Voltar à padrão`}
        </Btn>
        <Btn
          type="button"
          data-size="sm"
          data-tone="quiet"
          onClick={props.onCancel}
        >
          {t`Cancelar`}
        </Btn>
      </Row>
      <Muted>
        {t`Padrão desta skill`}:{" "}
        {props.fallback.map((c) => conditionText(c)).join(" ou ")}
      </Muted>
    </EditBox>
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
    "&[data-has]": { color: "var(--md-sys-color-primary)" },
  },
});
const Hold = styled("div", {
  base: {
    marginTop: "4px",
    padding: "6px 10px",
    borderRadius: "8px",
    background: "rgba(217,180,90,0.12)",
    border: "1px solid rgba(217,180,90,0.4)",
    fontSize: "0.88em",
  },
});
const SlotRow = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "8px",
    "@container (max-width: 640px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
  },
});
const SlotCard = styled("div", {
  base: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "8px 10px 8px",
    borderRadius: "12px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container)",
    minHeight: "92px",
    "&[data-empty]": { borderStyle: "dashed" },
    "&[aria-current=true]": { borderColor: "var(--md-sys-color-primary)" },
  },
});
const Prio = styled("span", {
  base: {
    fontSize: "0.75rem",
    fontWeight: 800,
    color: "var(--md-sys-color-primary)",
  },
});
const SlotName = styled("button", {
  base: {
    textAlign: "left",
    border: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontWeight: 700,
    padding: 0,
    cursor: "pointer",
    minHeight: "28px",
  },
});
const AiLine = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" },
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
const Layout = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "minmax(200px, 260px) minmax(0, 1fr)",
    gap: "14px",
    alignItems: "start",
    "@container (max-width: 640px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
});
const List = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "4px" },
});
const SkillBtn = styled("button", {
  base: {
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minHeight: "48px",
    padding: "6px 10px",
    borderRadius: "10px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container)",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    "& > span": { display: "flex", gap: "6px", alignItems: "center" },
    "& > small": {
      color: "var(--md-sys-color-on-surface-variant)",
      fontSize: "0.78em",
    },
    "&[data-locked]": { opacity: 0.65 },
    "&[aria-pressed=true]": {
      borderColor: "var(--md-sys-color-primary)",
      background: "var(--md-sys-color-primary-container)",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});
const Does = styled("ul", {
  base: {
    margin: 0,
    paddingInlineStart: "18px",
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    fontSize: "0.9em",
    "& li::marker": { color: "var(--md-sys-color-primary)" },
  },
});
const Nums = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "2px 12px",
    fontSize: "0.92em",
    "& > :nth-child(even)": { textAlign: "right" },
  },
});
const Ups = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "6px" },
});
const UpRow = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    gap: "8px",
    alignItems: "center",
    padding: "6px 8px",
    borderRadius: "8px",
    background: "rgba(0,0,0,0.2)",
    "& > div": {
      display: "flex",
      flexDirection: "column",
      gap: "1px",
      minWidth: 0,
    },
    "& small": {
      fontSize: "0.75em",
      color: "var(--md-sys-color-on-surface-variant)",
    },
    "&[data-locked]": { opacity: 0.6 },
    "&[data-staged]": { outline: "1px solid var(--md-sys-color-primary)" },
  },
});
const Pips = styled("span", {
  base: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
});
const AiBox = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    paddingTop: "8px",
    borderTop: "1px solid var(--md-sys-color-outline-variant)",
  },
});
const EditBox = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "6px" },
});
const EditRow = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    "& select, & input[type=number]": {
      minHeight: "36px",
      borderRadius: "8px",
      background: "var(--md-sys-color-surface)",
      color: "inherit",
      border: "1px solid var(--md-sys-color-outline)",
      font: "inherit",
    },
    "& input[type=number]": { width: "4em" },
    "& label": { display: "inline-flex", alignItems: "center", gap: "4px" },
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
