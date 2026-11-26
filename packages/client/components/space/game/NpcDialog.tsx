import { Match, Show, Switch } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { NpcKind } from "@muchat/space-core";
import type { RpgHeroState } from "@muchat/space-core/game/ot/balance";

import { BankPanel } from "./BankPanel";
import { ClassPicker } from "./ClassPicker";
import { MasterPanel } from "./MasterPanel";
import { MerchantPanel } from "./MerchantPanel";
import { SmithPanel } from "./SmithPanel";
import { type GameLink, GameDialog, Muted } from "./gameUi";

/**
 * Os NPCs do Idle Hunt (§10): Mercador, Ferreiro, Banqueiro e Mestre da evolução, cada um no seu
 * painel. O servidor confere que o herói está perto (`not_near`) e fora da corrida.
 */
export default function NpcDialog(props: {
  link: GameLink;
  request: { instance: string; title: string; npc: NpcKind };
  rpg: { hero: RpgHeroState | null } | null;
  people: { id: string; name: string }[];
  /** Estou num grupo: a janela aberta segura a largada (menos a do Mercador). */
  inGroup?: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const state = () => props.rpg?.hero ?? null;
  const role = () => {
    switch (props.request.npc) {
      case "mercador":
        return t`Mercador`;
      case "ferreiro":
        return t`Ferreiro`;
      case "banqueiro":
        return t`Banqueiro`;
      case "mestre":
        return t`Mestre da evolução`;
    }
  };
  return (
    <GameDialog
      id={`rpg-npc-${props.request.npc}`}
      title={props.request.title || role()}
      subtitle={props.request.title ? role() : undefined}
      onClose={props.onClose}
    >
      <Show when={state()} fallback={<ClassPicker link={props.link} />}>
        {(s) => (
          <>
            <Show when={s().run}>
              <Muted role="note">
                {props.request.npc === "mercador"
                  ? t`Seu herói está numa dungeon. Dá para vender da mochila (abre espaço para o loot) e comprar poção e munição: elas valem a partir da próxima corrida, porque esta já saiu calculada.`
                  : t`Seu herói está numa dungeon: volte quando a corrida acabar.`}
              </Muted>
            </Show>
            <Show when={!s().run && props.request.npc !== "mercador" && props.inGroup}>
              <Muted role="note">
                {t`Enquanto esta janela estiver aberta, a próxima corrida do seu grupo espera por você.`}
              </Muted>
            </Show>
            <Switch>
              <Match when={props.request.npc === "mercador"}>
                <MerchantPanel
                  link={props.link}
                  npc={props.request.instance}
                  state={s()}
                />
              </Match>
              <Match when={props.request.npc === "ferreiro"}>
                <SmithPanel
                  link={props.link}
                  npc={props.request.instance}
                  state={s()}
                />
              </Match>
              <Match when={props.request.npc === "banqueiro"}>
                <BankPanel
                  link={props.link}
                  npc={props.request.instance}
                  state={s()}
                  people={props.people}
                />
              </Match>
              <Match when={props.request.npc === "mestre"}>
                <MasterPanel
                  link={props.link}
                  npc={props.request.instance}
                  state={s()}
                />
              </Match>
            </Switch>
          </>
        )}
      </Show>
    </GameDialog>
  );
}
