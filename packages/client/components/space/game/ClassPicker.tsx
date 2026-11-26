import { For, Show, createSignal } from "solid-js";

import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/solid/macro";
import {
  type ClassId,
  CLASSES,
  CLASS_IDS,
  FAMILIES,
  balanceHero,
  createHero,
  heroDerived,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { classBlurb, rarityName, roleName, weightName } from "./gameText";
import {
  type GameLink,
  Btn,
  Confirm,
  Muted,
  Notice,
  useCommands,
} from "./gameUi";

const ROLES = ["tanque", "suporte", "dps"] as const;

/** O kit que o núcleo dá ao jogador novo, em uma linha (lido do createHero: muda junto com ele). */
function kitText(h: ReturnType<typeof createHero>): string {
  const eq = Object.values(h.equipment).filter(Boolean);
  const arma = h.equipment.arma;
  const pieces = eq.length;
  const hp = h.potions.hp.pequena + h.potions.hp.media + h.potions.hp.grande;
  const mp = h.potions.mp.pequena + h.potions.mp.media + h.potions.mp.grande;
  const ammo = Object.values(h.ammo).reduce((a, n) => a + (n ?? 0), 0);
  const rarity = arma ? rarityName(arma.rarity) : "";
  const refine = arma && arma.refine > 0 ? ` +${arma.refine}` : "";
  const parts = [
    t`${pieces} peças ${rarity}${refine} (arma: ${arma ? FAMILIES[arma.family].name : "—"})`,
    t`${hp} poções de vida`,
  ];
  if (mp > 0) parts.push(t`${mp} de mana`);
  if (ammo > 0) parts.push(t`${ammo} flechas`);
  return parts.join(" · ");
}

/**
 * O jogador novo (D34, wipe geral; §15.7): o aviso de que o jogo recomeçou e as 7 classes agrupadas
 * pelo papel no grupo (a decisão que importa: tanque, suporte ou dano). Escolher mostra o detalhe;
 * começar pede um 2º toque. Trocar depois é no Mestre, ao preço do job e da Proficiência.
 */
export function ClassPicker(props: { link: GameLink; onDone?: () => void }) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [pick, setPick] = createSignal<ClassId | null>(null);
  const kit = (cls: ClassId) => {
    const h = createHero(cls, () => "x");
    const d = heroDerived(balanceHero(h));
    return { h, d };
  };
  const start = async () => {
    const cls = pick();
    if (!cls) return;
    const r = await cmd.run("rpg.class", { cls });
    if (r?.ok) props.onDone?.();
  };
  return (
    <Wrap>
      <Reset role="note">
        <strong>{t`O Idle Hunt recomeçou`}</strong>
        <span>
          {t`As regras mudaram (atributos, habilidades, itens e dungeons novas) e todo mundo começa do zero: nível 1, o mesmo kit inicial e nenhum ouro. Escolha a classe para começar.`}
        </span>
      </Reset>
      <For each={ROLES}>
        {(role) => (
          <Group aria-label={roleName(role)}>
            <h3>{roleName(role)}</h3>
            <Cards>
              <For each={CLASS_IDS.filter((c) => CLASSES[c].role === role)}>
                {(cls) => (
                  <ClassCard
                    type="button"
                    aria-pressed={pick() === cls}
                    onClick={() => setPick(cls)}
                  >
                    <strong>{CLASSES[cls].titles[1]}</strong>
                    <span>{classBlurb(cls)}</span>
                  </ClassCard>
                )}
              </For>
            </Cards>
          </Group>
        )}
      </For>
      <Show when={pick()}>
        {(cls) => {
          const c = () => CLASSES[cls()];
          const k = () => kit(cls());
          return (
            <Detail aria-live="polite">
              <strong>
                {c().titles[1]} · {roleName(c().role)}
              </strong>
              <Muted>
                {t`Começa como ${c().titles[0]}; evolui para ${c().titles[1]} (job 20), ${c().titles[2]} (job 40) e ${c().titles[3]} (job 70).`}
              </Muted>
              <Facts>
                <span>
                  {t`Armas`}:{" "}
                  {c()
                    .weapons.map((w) => FAMILIES[w].name)
                    .join(", ")}
                </span>
                <span>
                  {t`Armadura`}: {weightName(c().armor)}
                </span>
                <span>
                  {t`Traço`}: {c().trait.name}
                </span>
                <span>
                  {t`No nível 1`}:{" "}
                  {t`vida ${Math.round(k().d.hp)} · mana ${Math.round(k().d.mp)}`}
                </span>
              </Facts>
              <Muted>
                {t`Kit inicial`}: {kitText(k().h)}
              </Muted>
              <Notice error={cmd.error()} />
              <div>
                <Confirm
                  tone="primary"
                  disabled={cmd.busy()}
                  label={t`Começar como ${c().titles[1]}`}
                  confirm={t`Toque de novo para começar`}
                  onConfirm={start}
                />
                <Btn
                  type="button"
                  data-tone="quiet"
                  onClick={() => setPick(null)}
                >
                  {t`Ver outra`}
                </Btn>
              </div>
            </Detail>
          );
        }}
      </Show>
    </Wrap>
  );
}

const Wrap = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "14px" },
});
const Reset = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "12px 14px",
    borderRadius: "12px",
    background:
      "linear-gradient(90deg, rgba(217,180,90,0.18), rgba(217,180,90,0.04))",
    border: "1px solid rgba(217,180,90,0.45)",
    "& > strong": { color: "#ffe7a8" },
  },
});
const Group = styled("section", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    "& > h3": {
      margin: 0,
      fontSize: "0.8rem",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "var(--md-sys-color-on-surface-variant)",
    },
  },
});
const Cards = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "8px",
  },
});
const ClassCard = styled("button", {
  base: {
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minHeight: "72px",
    padding: "10px 12px",
    borderRadius: "12px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container)",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    "& > span": {
      fontSize: "0.85em",
      color: "var(--md-sys-color-on-surface-variant)",
    },
    "&[aria-pressed=true]": {
      borderColor: "var(--md-sys-color-primary)",
      boxShadow: "inset 0 0 0 1px var(--md-sys-color-primary)",
      background: "var(--md-sys-color-primary-container)",
    },
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
  },
});
const Detail = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid var(--md-sys-color-primary)",
    background: "var(--md-sys-color-surface-container)",
    "& > div:last-child": { display: "flex", flexWrap: "wrap", gap: "8px" },
  },
});
const Facts = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 14px",
    fontSize: "0.9em",
  },
});
