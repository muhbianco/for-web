import { For, Show, createSignal, onCleanup } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { GameWireEvent, SpaceView } from "@muchat/space-client";
import {
  type RpgHeroView,
  type TrainingSkill,
  TRAINING_SKILLS,
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
 * (definitiva); depois, a skill: as armas e a magia. Os pontos da árvore vêm do nível de job
 * (24/11/2026; o dummy de habilidade saiu). O servidor confere a distância e o saldo.
 */
export default function TrainingDialog(props: {
  view: SpaceView;
  request: { instance: string; title: string };
  rpg: { hero: RpgHeroView | null; serverNow: number; at: number } | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const L = rpgLabels();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // "Mudar o treino" com um já aberto aqui.
  const [changing, setChanging] = createSignal(false);
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
      setError(L.error(d.code ?? "internal", d.reason));
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
      { instance: props.request.instance, skill },
      props.onClose,
    );
  const stop = () => send("rpg.train.stop", {}, props.onClose);

  const trainingHere = () => {
    const tr = hero()?.training;
    return tr && tr.instance === props.request.instance ? tr : null;
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
                <Skills>
                  <For each={TRAINING_SKILLS}>
                    {(skill) => {
                      const main = () => mainSkills(vocation()).includes(skill);
                      const level = () =>
                        skill === "magia"
                          ? hero()!.magic.level
                          : hero()!.skills[skill].level;
                      const pct = () =>
                        skill === "magia"
                          ? percent(
                              hero()!.magic.mana_spent,
                              hero()!.magic.next,
                            )
                          : percent(
                              hero()!.skills[skill].tries,
                              hero()!.skills[skill].next,
                            );
                      const eta = () =>
                        hoursToNext(hero()!, skill) * 3_600_000;
                      return (
                        <SkillRow data-main={main() ? "" : undefined}>
                          <span>
                            <strong>{L.skill[skill]}</strong>{" "}
                            {t`${level()} (${pct()}%)`}
                          </span>
                          <Muted>
                            {main()
                              ? t`≈ ${duration(eta())} para o próximo nível`
                              : t`Lento para a sua vocação`}
                          </Muted>
                          <Button
                            size="xs"
                            variant={main() ? "filled" : "tonal"}
                            isDisabled={busy()}
                            onPress={() => train(skill)}
                          >
                            {t`Treinar`}
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
                  {t`Treinando ${L.skill[tr().skill]} aqui há ${duration(Math.max(0, now() - tr().started_at))}.`}
                </p>
                <Row>
                  <Button variant="filled" isDisabled={busy()} onPress={stop}>
                    {t`Parar de treinar`}
                  </Button>
                  <Button
                    variant="tonal"
                    isDisabled={busy()}
                    onPress={() => setChanging(true)}
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
    "& > button": { gridRow: "1 / 3", gridColumn: 2 },
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
