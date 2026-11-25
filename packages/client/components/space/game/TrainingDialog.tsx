import { Show, createSignal, onCleanup, onMount } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RpgHeroState } from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { ClassPicker } from "./ClassPicker";
import {
  type GameLink,
  Bar,
  Btn,
  GameDialog,
  Muted,
  Notice,
  Panel,
  Row,
  useCommands,
} from "./gameUi";
import { dojoNow, num, serverClock } from "./heroModel";

/**
 * O Dojô (§2): o boneco treina a Proficiência, o nível base que multiplica vida, mana, ATQ, MATQ e
 * as defesas. Sem relógio na tela (D21): o que sobe é a barra de XP e o número, projetados aqui
 * pelo relógio do servidor; o servidor credita ao parar. Treinar junto rende mais (+5% por herói).
 */
export default function TrainingDialog(props: {
  link: GameLink;
  request: { instance: string; title: string };
  rpg: { hero: RpgHeroState | null; serverNow: number; at: number } | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [tick, setTick] = createSignal(0);
  onMount(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    onCleanup(() => clearInterval(id));
  });
  const state = () => props.rpg?.hero ?? null;
  const here = () => state()?.dojo?.instance === props.request.instance;
  const elsewhere = () => !!state()?.dojo && !here();
  const d = () => {
    tick();
    const s = state();
    return s && props.rpg
      ? dojoNow({ hero: s.hero, dojo: s.dojo }, serverClock(props.rpg))
      : null;
  };
  return (
    <GameDialog
      id="rpg-dojo"
      title={props.request.title || t`Boneco de treino`}
      subtitle={t`Dojô · Proficiência`}
      onClose={props.onClose}
    >
      <Show when={state() && d()} fallback={<ClassPicker link={props.link} />}>
        <Panel>
          <Row>
            <Big>{num(d()!.stored)}</Big>
            <Muted>{t`Proficiência guardada`}</Muted>
            <Show when={d()!.gained > 0}>
              <Gain>+{d()!.gained}</Gain>
            </Show>
          </Row>
          <Bar
            label={t`Para a próxima`}
            color="prof"
            frac={d()!.need > 0 ? d()!.into / d()!.need : 1}
            text={`${num(d()!.into)} / ${num(d()!.need)} XP`}
          />
          <Muted>
            {t`Efetiva ${num(d()!.effective)} · recomendada para o seu nível ${num(d()!.recommended)}.`}
          </Muted>
          <Show when={d()!.capped}>
            <Muted role="note">
              {t`Você já passou do teto do seu nível (10 × nível + 250): o que treinar agora fica guardado e vale quando subir de nível na dungeon.`}
            </Muted>
          </Show>
        </Panel>
        <Muted>
          {t`${num(d()!.perSecond)} XP por segundo enquanto o herói bate no boneco; +5% para cada outro herói treinando na mesma sala (até +25%). Só treina aqui, fora da dungeon.`}
        </Muted>
        <Notice error={cmd.error()} />
        <Row>
          <Show
            when={here()}
            fallback={
              <Btn
                type="button"
                data-tone="primary"
                disabled={cmd.busy() || !!state()!.run || elsewhere()}
                onClick={() =>
                  void cmd.run("rpg.dojo.start", {
                    instance: props.request.instance,
                  })
                }
              >
                {t`Treinar aqui`}
              </Btn>
            }
          >
            <Btn
              type="button"
              data-tone="primary"
              disabled={cmd.busy()}
              onClick={() =>
                void cmd
                  .run("rpg.dojo.stop")
                  .then((r) => r?.ok && props.onClose())
              }
            >
              {t`Parar e guardar`}
            </Btn>
          </Show>
          <Show when={elsewhere()}>
            <Btn
              type="button"
              disabled={cmd.busy()}
              onClick={() => void cmd.run("rpg.dojo.stop")}
            >
              {t`Parar o treino no outro boneco`}
            </Btn>
          </Show>
        </Row>
        <Show when={state()!.run}>
          <Muted role="note">{t`Seu herói está numa dungeon agora.`}</Muted>
        </Show>
      </Show>
    </GameDialog>
  );
}

const Big = styled("strong", {
  base: {
    fontSize: "1.8rem",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
  },
});
const Gain = styled("strong", {
  base: {
    color: "#7ee08a",
    fontVariantNumeric: "tabular-nums",
    "@media (prefers-reduced-motion: no-preference)": {
      animation: "gamePop 380ms ease-out",
    },
  },
});
