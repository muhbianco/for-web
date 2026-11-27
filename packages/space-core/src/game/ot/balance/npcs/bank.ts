import type { ItemInstance } from "../equipment.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";

/**
 * O Banqueiro (spec §10): cofre de ouro e de itens, os dois sem limite (o de itens desde 27/11/2026:
 * o que não cabe na mochila no fim da corrida vai para ele; antes eram 60 espaços, +20 por expansão), e a
 * transferência de ouro e itens para outro jogador, com taxa e log. Só as regras: quem guarda o saldo,
 * o cofre e o log é o servidor (virada da Fase 8).
 */

export function goldTransferFee(
  amount: number,
  B: Balance = gameBalance,
): number {
  const b = B.cfg.bank;
  return Math.max(b.goldFeeMin, Math.ceil(b.goldFeePct * amount));
}

export function itemTransferFee(
  item: ItemInstance,
  B: Balance = gameBalance,
): number {
  return B.cfg.bank.itemFeeOfGold * B.lacaioGold(item.ilvl);
}

export type TransferError =
  | "para-si-mesmo"
  | "valor-invalido"
  | "sem-ouro"
  | "confirmacao-dupla";

export interface TransferPlan {
  /** Ouro que sai de quem manda (valor + taxas). */
  debit: number;
  /** Ouro que chega em quem recebe. */
  credit: number;
  fee: number;
}

/**
 * Confere e calcula uma transferência. `confirmations` = quantas vezes quem manda confirmou; item com
 * refino a partir do +7 pede duas.
 */
export function planTransfer(
  req: {
    from: string;
    to: string;
    gold: number;
    items: ItemInstance[];
    balance: number;
    confirmations: number;
  },
  B: Balance = gameBalance,
): { ok: true; plan: TransferPlan } | { ok: false; error: TransferError } {
  if (req.from === req.to) return { ok: false, error: "para-si-mesmo" };
  if (
    !Number.isInteger(req.gold) ||
    req.gold < 0 ||
    (req.gold === 0 && req.items.length === 0)
  )
    return { ok: false, error: "valor-invalido" };
  const risky = req.items.some((i) => i.refine >= B.cfg.bank.confirmRefineFrom);
  if (risky && req.confirmations < 2)
    return { ok: false, error: "confirmacao-dupla" };
  const fee =
    (req.gold > 0 ? goldTransferFee(req.gold, B) : 0) +
    req.items.reduce((a, i) => a + itemTransferFee(i, B), 0);
  const debit = req.gold + fee;
  if (debit > req.balance) return { ok: false, error: "sem-ouro" };
  return { ok: true, plan: { debit, credit: req.gold, fee } };
}

/** Uma linha do log de transferências. */
export interface TransferLogEntry {
  at: string;
  from: string;
  to: string;
  gold: number;
  /** Ids dos itens (o servidor guarda o item inteiro). */
  items: string[];
  fee: number;
}
