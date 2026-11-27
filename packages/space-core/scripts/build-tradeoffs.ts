// A troca de cada build (27/11/2026, a ótica do dono): o druida e o paladino de força caçam com mais
// autonomia, mas não seguram a PT na Masmorra; o assassino mais "tanque" fica mais vivo, mas o grupo
// sente a falta do dano. Toda build ganha de um lado e paga do outro. Anomalia é a que ganha sem pagar.
//
//   node scripts/build-tradeoffs.ts <varredura.json>   (de scripts/build-sweep.ts)
//
// Para cada build da passada itens × atributos:
//   solo  = tempo da referência ÷ tempo da build no chefe menor da Caçada (> 1: caça mais rápido);
//   grupo = a Masmorra do nível com a PT do limite em que a classe é a única do papel (vence? em quanto).
// Categorias:
//   sem-troca  — caça melhor (solo ≥ 1,15) e a PT vence no mesmo ritmo (até +3% de tempo);
//   troca      — caça melhor e a PT perde ou fica bem mais lenta (+10%): o que o dono quer;
//   inutil     — caça pior (solo < 0,9) e a PT perde;
//   papel-sem-custo — tanque ou suporte fraco no papel (nota < 0,8 no estresse) e a PT vence igual.
import { readFileSync } from "node:fs";

import { CLASSES, type ClassId } from "../src/game/ot/balance/content.ts";

interface G {
  won: boolean;
  seconds: number;
  deaths: number;
}
interface Row {
  cls: ClassId;
  level: number;
  pass: string;
  weapon: string;
  off: string | null;
  weight: string;
  fit: string;
  attrs: string;
  score: number;
  m: { killS: number; won: boolean; alive: boolean; dps: number; stressS: number };
  g?: G | null;
}
const data = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as {
  levels: number[];
  refs: Record<string, { killS: number }>;
  groupRefs: Record<string, G | null>;
  groupWithout: Record<string, G | null>;
  rows: Row[];
};

const label = (r: Row) =>
  `${r.weapon}${r.off ? `+${r.off}` : ""}, ${r.weight}${r.fit === "acima" ? "*" : ""}, ${r.attrs}`;
type Cat = "sem-troca" | "troca" | "inutil" | "papel-sem-custo" | "neutra";

const summary: Record<string, Record<Cat, Row[]>> = {};
for (const r of data.rows) {
  if (r.pass !== "itens" || !r.g) continue;
  const k = `${r.cls}@${r.level}`;
  const ref = data.refs[k]!;
  const gref = data.groupRefs[k]!;
  if (!gref) continue;
  const solo = ref.killS / Math.max(1, r.m.killS);
  const slower = r.g.won ? r.g.seconds / gref.seconds : Infinity;
  const role = CLASSES[r.cls].role;
  let cat: Cat = "neutra";
  if (solo >= 1.15 && r.g.won && slower <= 1.03) cat = "sem-troca";
  else if (solo >= 1.1 && (!r.g.won || slower > 1.1)) cat = "troca";
  else if (solo < 0.9 && !r.g.won) cat = "inutil";
  if (cat === "neutra" && role !== "dps" && r.score < 0.8 && r.g.won && slower <= 1.03)
    cat = "papel-sem-custo";
  summary[k] ??= { "sem-troca": [], troca: [], inutil: [], "papel-sem-custo": [], neutra: [] };
  summary[k][cat].push(r);
}

console.log("classe@nível      | sem-troca | troca | inútil | papel-sem-custo | neutras | sem o papel a PT…");
for (const [k, s] of Object.entries(summary)) {
  const w = data.groupWithout[k];
  console.log(
    `${k.padEnd(17)} | ${String(s["sem-troca"].length).padStart(9)} | ${String(s.troca.length).padStart(5)} | ${String(s.inutil.length).padStart(6)} | ${String(s["papel-sem-custo"].length).padStart(15)} | ${String(s.neutra.length).padStart(7)} | ${w ? (w.won ? "vence" : "perde") : "-"}`,
  );
}

for (const cat of ["sem-troca", "papel-sem-custo", "troca", "inutil"] as Cat[]) {
  console.log(`\n## ${cat}`);
  for (const [k, s] of Object.entries(summary)) {
    const list = s[cat];
    if (!list.length) continue;
    const ref = data.refs[k]!;
    const gref = data.groupRefs[k]!;
    const best = [...list].sort((a, b) => a.m.killS - b.m.killS).slice(0, 3);
    console.log(
      `- ${k}: ${list.length} builds; ex.: ${best
        .map(
          (r) =>
            `${label(r)} (solo ${Math.round(r.m.killS)}s vs ${Math.round(ref.killS)}s; PT ${r.g!.won ? `vence ${Math.round(r.g!.seconds)}s vs ${Math.round(gref.seconds)}s` : "perde"})`,
        )
        .join("; ")}`,
    );
  }
}
