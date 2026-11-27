/**
 * O que o perk lendário muda na skill, frase por frase (27/11/2026, pedido do dono: "nos pop-ups das
 * skills, deixar evidente quando existir um perk fortalecendo a skill, e mostrar os valores").
 *
 * A skill é compilada duas vezes, com e sem os perks vestidos, e as duas listas de frases
 * (skillText.skillLines) são alinhadas por LCS sobre o "molde" de cada frase (o texto com os números
 * trocados por #). Assim nada é marcado à mão e qualquer perk novo aparece sozinho:
 * - molde igual e números iguais: a frase não mudou;
 * - molde igual e algum número diferente: a frase foi fortalecida, e cada número que mudou leva a
 *   diferença ("≈ 740" com "+90");
 * - frase só na versão com perk: o perk acrescentou (o 2º disparo, a cura extra…);
 * - frase só na versão sem perk: o perk tirou (raro; aparece riscada).
 */

/** Um pedaço da frase: texto corrido ou um número (com a diferença para a versão sem perk). */
export interface DiffPart {
  text: string;
  /** Só nos números que mudaram: "+90", "−1,5", "+0,6%". */
  delta?: string;
  /** O número subiu (melhor na leitura comum) ou desceu. */
  up?: boolean;
}

export interface PerkLine {
  kind: "same" | "changed" | "added" | "removed";
  text: string;
  parts: DiffPart[];
}

/** Número como a ficha escreve: milhar com ponto e decimal com vírgula ("1.211", "0,6", "9,5"). */
const NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;

interface Token {
  text: string;
  value: number;
  decimals: number;
  /** O que vem logo depois do número e entra na diferença ("%" ou " s"). */
  unit: string;
}

function tokenize(line: string): {
  template: string;
  tokens: Token[];
  pieces: string[];
} {
  const tokens: Token[] = [];
  const pieces: string[] = [];
  let last = 0;
  for (const m of line.matchAll(NUMBER)) {
    const at = m.index ?? 0;
    pieces.push(line.slice(last, at));
    const raw = m[0];
    const [int, frac = ""] = raw.split(",");
    const after = line.slice(at + raw.length);
    tokens.push({
      text: raw,
      value: Number(`${int!.replace(/\./g, "")}${frac ? `.${frac}` : ""}`),
      decimals: frac.length,
      unit: after.startsWith("%")
        ? "%"
        : after.startsWith(" s") && !/^ s\w/.test(after)
          ? " s"
          : "",
    });
    last = at + raw.length;
  }
  pieces.push(line.slice(last));
  return { template: pieces.join("#"), tokens, pieces };
}

const fmt = (v: number, decimals: number) =>
  v.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** A diferença de um número para outro no formato da ficha, com sinal ("+90", "−1,5 s", "+0,6%"). */
export function numberDelta(before: Token, after: Token): string | null {
  const decimals = Math.max(before.decimals, after.decimals);
  const d = after.value - before.value;
  if (Math.abs(d) < 10 ** -(decimals + 1)) return null;
  const sign = d > 0 ? "+" : "−";
  return `${sign}${fmt(Math.abs(d), decimals)}${after.unit}`;
}

/** LCS pelos moldes: os pares (i da lista sem perk, j da lista com perk) que casam, em ordem. */
function align(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] =
        a[i] === b[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/** As frases da skill com perk, cada uma marcada contra a versão sem perk (ver o topo do arquivo). */
export function diffSkillLines(
  base: string[],
  withPerks: string[],
): PerkLine[] {
  const A = base.map(tokenize);
  const Bt = withPerks.map(tokenize);
  const pairs = align(
    A.map((x) => x.template),
    Bt.map((x) => x.template),
  );
  const out: PerkLine[] = [];
  let i = 0;
  let j = 0;
  const plain = (s: string): PerkLine["parts"] => [{ text: s }];
  for (const [pi, pj] of [
    ...pairs,
    [A.length, Bt.length] as [number, number],
  ]) {
    // O que sobrou sem par entre um casamento e outro: tirado (sem perk) e acrescentado (com perk).
    for (; i < pi; i++)
      out.push({ kind: "removed", text: base[i]!, parts: plain(base[i]!) });
    for (; j < pj; j++)
      out.push({
        kind: "added",
        text: withPerks[j]!,
        parts: plain(withPerks[j]!),
      });
    if (pi >= A.length || pj >= Bt.length) break;
    const a = A[pi]!;
    const b = Bt[pj]!;
    const parts: DiffPart[] = [];
    let changed = false;
    // A unidade do número que mudou ("%", " s") vai junto dele, antes da diferença: "52%" e "+12%",
    // não "52" "+12%" "%".
    let skip = 0;
    b.pieces.forEach((piece, k) => {
      const rest = piece.slice(skip);
      skip = 0;
      if (rest) parts.push({ text: rest });
      const tb = b.tokens[k];
      if (!tb) return;
      const delta = numberDelta(a.tokens[k]!, tb);
      if (delta) {
        changed = true;
        skip = tb.unit.length;
        parts.push({
          text: tb.text + tb.unit,
          delta,
          up: tb.value > a.tokens[k]!.value,
        });
      } else parts.push({ text: tb.text });
    });
    out.push({
      kind: changed ? "changed" : "same",
      text: withPerks[pj]!,
      parts,
    });
    i = pi + 1;
    j = pj + 1;
  }
  return out;
}

/** A diferença de dois valores de cabeçalho (mana, recarga em s), no formato da ficha; null se igual. */
export function factDelta(
  before: number,
  after: number,
  decimals: number,
  unit = "",
): string | null {
  const t = (v: number): Token => ({ text: "", value: v, decimals, unit });
  return numberDelta(t(before), t(after));
}
