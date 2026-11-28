import {
  type ClassId,
  type Effect,
  type FrameStatus,
  skillOf,
} from "@muchat/space-core/game/ot/balance";

/**
 * Os efeitos ativos da corrida (26/11/2026) no jeito que a tela lê: o tom (a cor e o ícone da marca
 * na cena e do ícone no HUD) e se é bom ou ruim para quem carrega. A cena (Pixi) e as telas (Solid)
 * usam a mesma tabela, para a marca no monstro e o ícone no alvo terem a mesma cor.
 */
export type StatusTone =
  | "buff"
  | "hot"
  | "shield"
  | "mana"
  | "poison"
  | "burn"
  | "magic"
  | "bleed"
  | "holy"
  | "debuff"
  | "curse"
  | "stun"
  | "taunt";

/** Cores das marcas (sobre o fundo escuro da dungeon; cada uma com borda escura). */
export const STATUS_COLOR: Record<StatusTone, number> = {
  buff: 0xf3c04b,
  hot: 0x6ee07a,
  shield: 0xe6f2ff,
  mana: 0x6aa8ff,
  poison: 0x9be542,
  burn: 0xff8a3a,
  /** DoT mágico sem tipo (Nevasca, Espinhos): o magenta do número de dano mágico. */
  magic: 0xe05cff,
  bleed: 0xe0453c,
  holy: 0xfff0a0,
  debuff: 0xc27bff,
  curse: 0xff5a8a,
  stun: 0xffe14a,
  taunt: 0xff9d3a,
};

/** Bom para quem carrega (herói com buff, cura, escudo); o resto é ruim. */
export function statusGood(tone: StatusTone): boolean {
  return (
    tone === "buff" || tone === "hot" || tone === "shield" || tone === "mana"
  );
}

function dotOf(
  effects: readonly Effect[] | undefined,
): Extract<Effect, { type: "dot" }> | null {
  for (const e of effects ?? []) if (e.type === "dot") return e;
  return null;
}

/** O tom do efeito; `author` é a classe de quem pôs (o DoT diz se é veneno, fogo ou sangramento). */
export function statusTone(
  st: FrameStatus,
  author: ClassId | null,
): StatusTone {
  switch (st.k) {
    case "buff":
      return "buff";
    case "hot":
      return "hot";
    case "escudo":
      return "shield";
    case "mana":
      return "mana";
    case "atordoado":
      return "stun";
    case "provocado":
      return "taunt";
    case "debuff":
      // D71: os DoTs do chefe físico com o ícone do tipo; a Maldição e o Drenar com o de maldição.
      if (st.s === "sangramento") return "bleed";
      if (st.s === "veneno") return "poison";
      return st.s === "maldicao" || st.s === "drenar" ? "curse" : "debuff";
    case "dot": {
      // O tipo que o motor manda (o mesmo do número) decide; o elemento da skill só no DoT sem tipo.
      if (st.dk === "veneno") return "poison";
      if (st.dk === "queimadura") return "burn";
      if (st.dk === "sangramento") return "bleed";
      const dot = author ? dotOf(skillOf(author, st.s)?.effects) : null;
      if (!dot) return st.dk ? "magic" : "poison";
      if (dot.poison) return "poison";
      if (dot.element === "fisico") return "bleed";
      if (dot.element === "sagrado") return "holy";
      return st.dk ? "magic" : "burn";
    }
  }
}

/** A ordem das marcas: o que é ruim primeiro (é o que o jogador procura), depois o mais longo. */
export function sortStatuses<T extends { st: FrameStatus; tone: StatusTone }>(
  xs: T[],
): T[] {
  return [...xs].sort(
    (a, b) =>
      Number(statusGood(a.tone)) - Number(statusGood(b.tone)) ||
      b.st.t - a.st.t,
  );
}
