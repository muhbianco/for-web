// Relatório da §14 do rebalanceamento do Idle Hunt (Fase 7): as invariantes do spec na engine nova,
// com o Monte Carlo do §14.9, o ritmo do §14.7 e a meta de economia do §13.
//   node scripts/balance-report.ts            imprime o relatório (200 corridas por cenário no Monte Carlo)
//   node scripts/balance-report.ts --mc 50    menos corridas, para rodar rápido
//   node scripts/balance-report.ts --check    sai com erro se alguma linha falhar (o CI passa a usar depois
//                                             da revisão da Fase 7; por ora ele só imprime)
import {
  balanceReport,
  formatReport,
} from "../src/game/ot/balance/sim/report.ts";

const args = process.argv.slice(2);
const mcAt = args.indexOf("--mc");
const mcRuns = mcAt >= 0 ? Number(args[mcAt + 1]) : 200;
if (!Number.isInteger(mcRuns) || mcRuns < 1) {
  console.error("--mc precisa de um número inteiro positivo");
  process.exit(2);
}

const started = Date.now();
const lines = balanceReport({ mcRuns });
console.log(formatReport(lines));
console.log(`(${((Date.now() - started) / 1000).toFixed(1)} s)`);
if (args.includes("--check") && lines.some((l) => l.status === "falha"))
  process.exit(1);
