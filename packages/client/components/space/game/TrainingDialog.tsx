import { For, Show, createSignal, onCleanup } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { GameWireEvent, SpaceView } from "@muchat/space-client";
import {
  type RpgHeroView,
  type TrainingSkill,
  DUAL_EFFICIENCY,
  TRAINING_SKILLS,
  dummyTrains,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { Button } from "@revolt/ui";

import { gameFrame } from "./gameTheme";
import { useModalKeys } from "./modalKeys";
import {
  duration,
  hoursToNext,
  mainSkills,
  percent,
  rpgLabels,
  serverNow,
} from "./rpgUi";
import { VocationPicker } from "./VocationPicker";

/**
 * Usar um dummy de treino (docs/espaco/jogo/ot): na primeira vez escolhe a vocação
 * (definitiva); depois, a skill. O dummy de vocação treina as armas e a magia; o de habilidade
 * (24/11/2026), os pontos da árvore. Com os dois perto, dá para treinar nos dois ao mesmo tempo,
 * com 50% de cada (DUAL_EFFICIENCY). O servidor confere a distância, os dummies e o saldo.
 */
export default function TrainingDialog(props: {
  view: SpaceView;
  request: {
    instance: string;
    title: string;
    dummy?: "vocacao" | "habilidade";
    /** O dummy do outro tipo perto (space-client dummyPartner): treinar nos dois. */
    partner?: {
      instance: string;
      title: string;
      dummy: "vocacao" | "habilidade";
    } | null;
  };
  rpg: { hero: RpgHeroView | null; serverNow: number; at: number } | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const L = rpgLabels();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Treinar nos dois dummies (24/11/2026) e "mudar o treino" com um já aberto aqui.
  const [both, setBoth] = createSignal(false);
  const [changing, setChanging] = createSignal(false);
  const partner = () => props.request.partner ?? null;
  const dual = () => both() && partner() !== null;
  const pct = Math.round(DUAL_EFFICIENCY * 100);
  let card: HTMLDivElement | undefined;
  let title: HTMLHeadingElement | undefined;
  const refocus = useModalKeys(
    () => card,
    () => title,
    () => props.onClose(),
  );
  const hero = () => props.rpg?.hero ?? null;
  const vocation = () => hero()?.vocation ?? 0;
  const now = () =>
    props.rpg ? serverNow(props.rpg.serverNow, props.rpg.at) : Date.now();

  // Uma resposta por comando: estado (sucesso) ou erro, pelo `re`.
  let pending: { id: string; done: () => void } | null = null;
  const off = props.view.onGame((e: GameWireEvent) => {
    if (!pending || e.re !== pending.id) return;
    const p = pending;
    pending = null;
    setBusy(false);
    queueMicrotask(refocus);
    if (e.t === "error") {
      const d = e.d as { code?: string; reason?: string };
      setError(
        dual() && d.code === "not_allowed" && d.reason === "too_far"
          ? t`Fique perto dos dois dummies para treinar nos dois.`
          : L.error(d.code ?? "internal", d.reason),
      );
      return;
    }
    p.done();
  });
  onCleanup(off);

  function send(type: string, d: Record<string, unknown>, done: () => void) {
    if (busy()) return;
    setBusy(true);
    setError(null);
    pending = { id: props.view.gameSend(type, d), done };
  }

  const chooseVocation = (v: 1 | 2 | 3 | 4) =>
    send("rpg.vocation", { vocation: v }, () => undefined);
  const train = (skill: TrainingSkill) =>
    send(
      "rpg.train.start",
      dual()
        ? { instance: props.request.instance, skill, with: partner()!.instance }
        : { instance: props.request.instance, skill },
      props.onClose,
    );
  const stop = () => send("rpg.train.stop", {}, props.onClose);

  const kind = () => props.request.dummy ?? "vocacao";
  // Nos dois, escolhe-se a skill do dummy de vocação; os pontos de habilidade vêm junto.
  const choices = () =>
    dual()
      ? TRAINING_SKILLS.filter((s) => s !== "habilidade")
      : TRAINING_SKILLS.filter((s) => dummyTrains(kind(), s));
  const trainingHere = () => {
    const tr = hero()?.training;
    if (!tr) return null;
    return tr.instance === props.request.instance ||
      tr.also === props.request.instance
      ? tr
      : null;
  };
  const pointsEta = () => {
    const h = hero()!;
    return hoursToNext(h, "habilidade", DUAL_EFFICIENCY) * 3_600_000;
  };

  return (
    <Backdrop
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") props.onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <Card
        style={gameFrame}
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rpg-train-title"
      >
        <h2 id="rpg-train-title" tabIndex={-1} ref={title}>
          {props.request.title}
        </h2>
        <Show
          when={vocation() !== 0}
          fallback={<VocationPicker busy={busy()} onChoose={chooseVocation} />}
        >
          <Show
            when={!changing() && trainingHere()}
            fallback={
              <>
                <p>
                  {t`O herói treina sozinho enquanto você fica ao lado do dummy, sem limite de tempo. Sair de perto encerra; desconectar não: ele segue treinando.`}
                </p>
                <Show when={kind() === "habilidade" && !dual()}>
                  <Muted>
                    {t`Este é o dummy de habilidade: cada ponto ganho vai para a árvore das suas 4 habilidades (ficha do herói, aba Habilidades). As armas e a magia treinam no dummy de vocação.`}
                  </Muted>
                </Show>
                <Show
                  when={partner()}
                  fallback={
                    <Muted>
                      {t`Com um dummy de vocação e um de habilidade perto, dá para treinar nos dois ao mesmo tempo (${pct}% de cada).`}
                    </Muted>
                  }
                >
                  {(other) => (
                    <Modes role="radiogroup" aria-label={t`Como treinar`}>
                      <label data-on={!both() ? "" : undefined}>
                        <input
                          type="radio"
                          name="rpg-train-mode"
                          checked={!both()}
                          onChange={() => setBoth(false)}
                        />
                        <span>
                          <strong>{t`Só neste dummy`}</strong>
                          <Muted>{t`100% do treino dele`}</Muted>
                        </span>
                      </label>
                      <label data-on={both() ? "" : undefined}>
                        <input
                          type="radio"
                          name="rpg-train-mode"
                          checked={both()}
                          onChange={() => setBoth(true)}
                        />
                        <span>
                          <strong>{t`Nos dois dummies`}</strong>
                          <Muted>
                            {t`Este e o ${other().title}: ${pct}% de cada`}
                          </Muted>
                        </span>
                      </label>
                    </Modes>
                  )}
                </Show>
                <Show when={dual()}>
                  <SkillRow data-main="" data-info="">
                    <span>
                      <strong>{L.skill.habilidade}</strong>{" "}
                      {t`${hero()!.skill_points.earned} (${percent(hero()!.skill_points.tries, hero()!.skill_points.next)}%)`}
                    </span>
                    <Muted>
                      {t`Vem junto: ≈ ${duration(pointsEta())} para o próximo ponto`}
                    </Muted>
                  </SkillRow>
                </Show>
                <Skills>
                  <For each={choices()}>
                    {(skill) => {
                      const main = () =>
                        skill === "habilidade" ||
                        mainSkills(vocation()).includes(skill);
                      const level = () =>
                        skill === "habilidade"
                          ? hero()!.skill_points.earned
                          : skill === "magia"
                            ? hero()!.magic.level
                            : hero()!.skills[skill].level;
                      const pct = () =>
                        skill === "habilidade"
                          ? percent(
                              hero()!.skill_points.tries,
                              hero()!.skill_points.next,
                            )
                          : skill === "magia"
                            ? percent(
                                hero()!.magic.mana_spent,
                                hero()!.magic.next,
                              )
                            : percent(
                                hero()!.skills[skill].tries,
                                hero()!.skills[skill].next,
                              );
                      const eta = () =>
                        hoursToNext(
                          hero()!,
                          skill,
                          dual() ? DUAL_EFFICIENCY : 1,
                        ) * 3_600_000;
                      return (
                        <SkillRow data-main={main() ? "" : undefined}>
                          <span>
                            <strong>{L.skill[skill]}</strong>{" "}
                            {t`${level()} (${pct()}%)`}
                          </span>
                          <Muted>
                            {skill === "habilidade"
                              ? t`≈ ${duration(eta())} para o próximo ponto`
                              : main()
                                ? t`≈ ${duration(eta())} para o próximo nível`
                                : t`Lento para a sua vocação`}
                          </Muted>
                          <Button
                            size="xs"
                            variant={main() ? "filled" : "tonal"}
                            isDisabled={busy()}
                            onPress={() => train(skill)}
                          >
                            {dual() ? t`Treinar nos dois` : t`Treinar`}
                          </Button>
                        </SkillRow>
                      );
                    }}
                  </For>
                </Skills>
              </>
            }
          >
            {(tr) => (
              <>
                <p>
                  {tr().also
                    ? t`Treinando ${L.skill[tr().skill]} e ${L.skill.habilidade} nos dois dummies (${pct}% de cada) há ${duration(Math.max(0, now() - tr().started_at))}.`
                    : t`Treinando ${L.skill[tr().skill]} aqui há ${duration(Math.max(0, now() - tr().started_at))}.`}
                </p>
                <Row>
                  <Button variant="filled" isDisabled={busy()} onPress={stop}>
                    {t`Parar de treinar`}
                  </Button>
                  <Button
                    variant="tonal"
                    isDisabled={busy()}
                    onPress={() => {
                      setBoth(!!tr().also && partner() !== null);
                      setChanging(true);
                    }}
                  >
                    {t`Mudar o treino`}
                  </Button>
                </Row>
              </>
            )}
          </Show>
        </Show>
        <Show when={error()}>
          {(msg) => <ErrorText role="alert">{msg()}</ErrorText>}
        </Show>
        <Row>
          <Button variant="text" onPress={props.onClose}>
            {t`Fechar`}
          </Button>
        </Row>
      </Card>
    </Backdrop>
  );
}

const Backdrop = styled("div", {
  base: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    background: "rgba(0, 0, 0, 0.55)",
    zIndex: 6,
    padding: "var(--gap-lg)",
  },
});

const Card = styled("div", {
  base: {
    maxWidth: "480px",
    width: "100%",
    maxHeight: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-md)",
    padding: "var(--gap-xl, 24px)",
    borderRadius: "var(--borderRadius-lg, 16px)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    overflow: "auto",
    "& h2": { margin: 0, fontSize: "1.15rem", outline: "none" },
    "& p": { margin: 0, lineHeight: 1.5 },
  },
});

const Skills = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "6px" },
});

const SkillRow = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gridTemplateRows: "auto auto",
    alignItems: "center",
    columnGap: "8px",
    padding: "6px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
    opacity: 0.75,
    "&[data-main]": { opacity: 1 },
    "&[data-info]": { gridTemplateColumns: "1fr" },
    "& > button": { gridRow: "1 / 3", gridColumn: 2 },
  },
});

const Modes = styled("div", {
  base: {
    display: "grid",
    gap: "6px",
    "& label": {
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      gap: "10px",
      alignItems: "start",
      padding: "8px 10px",
      borderRadius: "10px",
      cursor: "pointer",
      background: "var(--md-sys-color-surface-container)",
      border: "1px solid transparent",
    },
    "& label[data-on]": {
      borderColor: "var(--md-sys-color-primary)",
    },
    "& label > span": { display: "grid", gap: "2px" },
    "& input": { marginTop: "3px", accentColor: "var(--md-sys-color-primary)" },
    "& input:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
  },
});

const Row = styled("div", {
  base: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.85em" },
});

const ErrorText = styled("p", {
  base: { color: "var(--md-sys-color-error)" },
});
