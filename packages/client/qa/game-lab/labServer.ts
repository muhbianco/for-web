import type { GameWireEvent } from "@muchat/space-client";
import { type RunState, applyFrames, runStateFrom } from "@muchat/space-client";
import {
  type ClassId,
  type HeroV5,
  type OwnedItem,
  type RpgHeroState,
  type RpgLobbyView,
  type RpgRunEndView,
  type RpgRunView,
  type RunFrame,
  type RunResult,
  applyRun,
  autoEquipBag,
  balanceHero,
  bankGold,
  bossMissing,
  bossRegions,
  buyAmmo,
  buyCommonItem,
  buyPotions,
  changeClass,
  createHero,
  discardItem,
  dismantleItem,
  dismantleItems,
  dungeonById,
  equipItem,
  evolveTier,
  heroDerived,
  heroRunFighter,
  imbuePerk,
  jobXpOf,
  planTransfer,
  raiseAttributes,
  refineItem,
  reforgeItem,
  rerollPerk,
  respecAttributes,
  respecSkills,
  runLoot,
  runRewards,
  sellItem,
  sellItems,
  setBelt,
  setSkillAi,
  setSkillSlots,
  simulateRun,
  skillCooldownMs,
  spendSkillPoint,
  startDojo,
  stopDojo,
  unequipItem,
  vaultExpand,
  vaultPut,
  vaultTake,
  withCleared,
} from "@muchat/space-core/game/ot/balance";

import type { TvLink } from "../../components/space/game/TvMenu";
import { grow, newUid, seeded } from "./scenarios";

/** O que o laboratório guarda e a página desenha (o lugar do SpaceUiState do app). */
export interface LabWorld {
  rpg: {
    hero: RpgHeroState | null;
    serverNow: number;
    at: number;
    rev: number;
  };
  lobbies: Record<string, RpgLobbyView>;
  runs: Record<string, RunState>;
  runOpen: string | null;
  notice: string | null;
  /** Só do laboratório: o kit fixo de cada pessoa (todas soltando sempre), para a vitrine de efeitos. */
  kits?: Record<string, string[]>;
}

type Fail = { ok: false; error: string };
type Done = { ok: true; hero: HeroV5 };

/**
 * O servidor de mentira do laboratório das telas: recebe os comandos `rpg.*` do protocolo v5 e os
 * aplica com as funções puras do núcleo (balance/hero.ts), exatamente como o servidor de verdade vai
 * fazer; responde com `rpg.state` (com o `re`) ou `error` (code "refused" e o motivo do núcleo). A
 * corrida roda no simulador com `record` e solta um quadro por "segundo" (acelerável).
 */
export class LabServer implements TvLink {
  private seq = 0;
  private readonly listeners = new Set<(e: GameWireEvent) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private rng = seeded(42);
  constructor(
    private world: LabWorld,
    private readonly onChange: (w: LabWorld) => void,
    public speed = 1,
  ) {}

  /** O mundo agora (para a página do laboratório). */
  get current(): LabWorld {
    return this.world;
  }

  get me(): string {
    return "u-ana";
  }

  gameSend(t: string, d: Record<string, unknown> = {}): string {
    const id = `lab${++this.seq}`;
    setTimeout(() => this.handle(id, t, d), 120);
    return id;
  }
  onGame(listener: (e: GameWireEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  requestBoard() {}
  knowsRun(id: string) {
    return !!this.world.runs[id];
  }
  watchRun(id: string) {
    this.set({ runOpen: id });
  }
  watchTv() {
    this.set({
      notice: "A TV abriria o player da sala (fora do laboratório).",
    });
  }

  /** Troca o mundo inteiro (o cenário escolhido na página). */
  load(w: LabWorld) {
    clearInterval(this.timer);
    this.world = w;
    this.onChange(w);
  }

  private set(p: Partial<LabWorld>) {
    this.world = { ...this.world, ...p };
    this.onChange(this.world);
  }
  private emit(e: GameWireEvent) {
    for (const l of [...this.listeners]) l(e);
  }
  private hero(): HeroV5 | null {
    return this.world.rpg.hero?.hero ?? null;
  }
  /** As DGs concluídas do herói (o servidor manda no estado; 26/11/2026). */
  private cleared(): string[] {
    return this.world.rpg.hero?.cleared ?? [];
  }
  private save(
    re: string,
    hero: HeroV5 | null,
    extra: Partial<RpgHeroState> = {},
  ) {
    const cur = this.world.rpg.hero;
    const next = hero
      ? {
          ...(cur ?? {
            dojo: null,
            run: null,
            rates: { exp: 1 },
          }),
          ...extra,
          hero,
        }
      : null;
    const rev = this.world.rpg.rev + 1;
    this.set({
      rpg: { hero: next, serverNow: Date.now(), at: Date.now(), rev },
    });
    this.emit({
      t: "rpg.state",
      re,
      d: { server_now: Date.now(), rev, hero: next },
    });
  }
  private refuse(re: string, reason: string, code = "refused") {
    this.emit({ t: "error", re, d: { code, reason } });
  }
  private apply(
    re: string,
    r: Done | Fail | { ok: boolean; hero?: HeroV5; error?: string },
  ) {
    if (!r.ok) return this.refuse(re, (r as Fail).error);
    this.save(re, (r as Done).hero);
  }

  private handle(re: string, t: string, d: Record<string, unknown>) {
    const h = this.hero();
    if (t === "rpg.open") return this.save(re, h);
    if (t === "rpg.class") {
      if (h) return this.refuse(re, "has_hero", "has_hero");
      return this.save(re, createHero(d.cls as ClassId, newUid));
    }
    if (!h) return this.refuse(re, "no_hero", "no_hero");
    const inRun = !!this.world.rpg.hero?.run;
    const free = [
      "rpg.run.leave",
      "rpg.board",
      "rpg.stats",
      "rpg.lobby.leave",
      "rpg.lobby.loop",
      "rpg.run.watch",
    ];
    // O que o servidor libera na corrida (26/11/2026): vender e comprar consumível no Mercador,
    // desmontar no Ferreiro.
    const duringRun =
      t === "rpg.shop.sell" ||
      t === "rpg.shop.sell.many" ||
      (t === "rpg.shop.buy" &&
        (d.buy as { kind?: string } | undefined)?.kind !== "item") ||
      t === "rpg.smith.dismantle.many" ||
      (t === "rpg.smith" && d.action === "desmontar");
    if (inRun && !free.includes(t) && !duringRun)
      return this.refuse(re, "in_run", "in_run");
    const rng = this.rng;
    switch (t) {
      case "rpg.dojo.start": {
        const r = startDojo(h, Date.now());
        if (!r.ok) return this.refuse(re, r.error);
        return this.save(re, r.hero, {
          dojo: { instance: String(d.instance), since: Date.now() },
        });
      }
      case "rpg.dojo.stop": {
        const r = stopDojo(h, Date.now(), 0);
        if (!r.ok) return this.refuse(re, r.error);
        return this.save(re, r.hero, { dojo: null });
      }
      case "rpg.attrs":
        return this.apply(re, raiseAttributes(h, d.add as never));
      case "rpg.skill.spend":
        return this.apply(
          re,
          spendSkillPoint(h, String(d.skill), d.target as never),
        );
      case "rpg.skill.slots":
        return this.apply(re, setSkillSlots(h, d.slots as string[]));
      case "rpg.skill.ai":
        return this.apply(
          re,
          setSkillAi(h, String(d.skill), d.conditions as never),
        );
      case "rpg.master":
        return this.apply(
          re,
          d.action === "evoluir"
            ? evolveTier(h)
            : d.action === "redistribuir-atributos"
              ? respecAttributes(h)
              : respecSkills(h),
        );
      case "rpg.master.class":
        return this.apply(re, changeClass(h, d.cls as ClassId));
      case "rpg.equip":
        return this.apply(re, equipItem(h, String(d.uid)));
      case "rpg.unequip":
        return this.apply(re, unequipItem(h, d.slot as never));
      case "rpg.autoequip": {
        let next = h;
        if (typeof d.on === "boolean") next = { ...next, autoEquip: d.on };
        if (d.apply) {
          const r = autoEquipBag(next);
          if (!r.ok) return this.refuse(re, r.error);
          next = r.hero;
        }
        return this.save(re, next);
      }
      case "rpg.discard":
        return this.apply(re, discardItem(h, String(d.uid)));
      case "rpg.supplies":
        return this.save(re, {
          ...h,
          supplies: { hp: Number(d.hp), mp: Number(d.mp) },
        });
      case "rpg.belt":
        return this.apply(
          re,
          setBelt(h, d.kind as "hp" | "mp", d.size as never),
        );
      case "rpg.shop.buy": {
        const b = d.buy as Record<string, unknown>;
        if (b.kind === "pocao")
          return this.apply(
            re,
            buyPotions(
              h,
              b.type as "hp" | "mp",
              b.size as never,
              Number(b.count),
            ),
          );
        if (b.kind === "municao")
          return this.apply(re, buyAmmo(h, b.grade as never, Number(b.packs)));
        return this.apply(re, buyCommonItem(h, b.base as never, newUid, rng));
      }
      case "rpg.shop.sell":
        return this.apply(re, sellItem(h, String(d.uid), d.confirm === true));
      case "rpg.shop.sell.many":
        return this.apply(
          re,
          sellItems(h, d.uids as string[], d.confirm === true),
        );
      case "rpg.smith.dismantle.many":
        return this.apply(re, dismantleItems(h, d.uids as string[]));
      case "rpg.smith":
        return this.apply(
          re,
          d.action === "refinar"
            ? refineItem(
                h,
                String(d.uid),
                { next: Math.random },
                d.protect === true,
              )
            : d.action === "reforjar"
              ? reforgeItem(h, String(d.uid), { next: Math.random })
              : dismantleItem(h, String(d.uid)),
        );
      case "rpg.smith.perk":
        return this.apply(
          re,
          d.action === "rolar"
            ? rerollPerk(h, String(d.uid), Number(d.slot ?? 0), {
                next: Math.random,
              })
            : imbuePerk(h, String(d.uid), { next: Math.random }),
        );
      case "rpg.bank":
        return this.apply(re, bankGold(h, Number(d.gold)));
      case "rpg.vault":
        return this.apply(
          re,
          d.action === "guardar"
            ? vaultPut(h, String(d.uid))
            : vaultTake(h, String(d.uid)),
        );
      case "rpg.vault.expand":
        return this.apply(re, vaultExpand(h));
      case "rpg.bank.transfer": {
        const uids = (d.uids as string[]) ?? [];
        const items = h.bag.filter((x) => uids.includes(x.uid));
        const p = planTransfer({
          from: this.me,
          to: String(d.to),
          gold: Number(d.gold),
          items,
          balance: h.gold,
          confirmations: Number(d.confirmations),
        });
        if (!p.ok) return this.refuse(re, p.error);
        return this.save(re, {
          ...h,
          gold: h.gold - p.plan.debit,
          bag: h.bag.filter((x) => !uids.includes(x.uid)),
        });
      }
      case "rpg.lobby.create": {
        const dg = dungeonById(String(d.dungeon));
        if (dg && bossMissing(dg, this.cleared()).length > 0)
          return this.refuse(re, "region", "rpg_invalid");
        const l = this.lobby(String(d.dungeon), String(d.tv));
        this.set({ lobbies: { [l.id]: l } });
        return this.emit({
          t: "rpg.lobby",
          re,
          d: { tv: l.tv, id: l.id, lobby: l },
        });
      }
      case "rpg.lobby.dungeon": {
        const cur = Object.values(this.world.lobbies)[0];
        if (!cur) return this.refuse(re, "no_lobby");
        const d2 = dungeonById(String(d.dungeon));
        // Como o servidor: o chefe pede a região de todos do grupo (26/11/2026).
        if (
          d2?.kind === "regional" &&
          cur.members.some((m) => !(m.regions ?? []).includes(d2.region.index))
        )
          return this.refuse(re, "region", "rpg_invalid");
        const l = {
          ...cur,
          dungeon: String(d.dungeon),
          max: d2?.party.max ?? cur.max,
        };
        this.set({ lobbies: { [l.id]: l } });
        return this.emit({
          t: "rpg.lobby",
          re,
          d: { tv: l.tv, id: l.id, lobby: l },
        });
      }
      case "rpg.lobby.loop": {
        const cur = Object.values(this.world.lobbies)[0];
        if (!cur) return this.refuse(re, "no_lobby");
        const l = { ...cur, loop: d.on === true, stopped: null };
        this.set({ lobbies: { [l.id]: l } });
        return this.emit({
          t: "rpg.lobby",
          re,
          d: { tv: l.tv, id: l.id, lobby: l },
        });
      }
      case "rpg.lobby.leave":
        this.set({ lobbies: {} });
        return this.emit({ t: "rpg.lobby", re, d: { tv: "", lobby: null } });
      case "rpg.lobby.start": {
        const cur = Object.values(this.world.lobbies)[0];
        if (!cur) return this.refuse(re, "no_lobby");
        this.emit({
          t: "rpg.lobby",
          re,
          d: { tv: cur.tv, id: cur.id, lobby: { ...cur, state: "running" } },
        });
        this.startRun(cur);
        return;
      }
      case "rpg.run.leave": {
        const open = this.world.runOpen && this.world.runs[this.world.runOpen];
        clearInterval(this.timer);
        if (open)
          this.set({
            runs: {
              ...this.world.runs,
              [open.run.id]: {
                ...open,
                end: {
                  outcome: "retirada" as never,
                  members: open.run.members.map((m) => ({
                    user_id: m.user_id,
                    dead: false,
                    retreated: m.user_id === this.me,
                    reward: null,
                    left: [],
                    potions_used: { hp: 0, mp: 0 },
                    ammo_used: 0,
                    levels_gained: 0,
                    jobs_gained: 0,
                  })),
                },
              },
            },
          });
        return this.save(re, h, { run: null });
      }
      case "rpg.run.watch":
        return this.emit({ t: "rpg.run", re, d: {} });
      case "rpg.stats": {
        // Um histórico de exemplo (a aba Ganho do medidor): três DGs, uma com quedas.
        const days = d.days === 7 ? 7 : 1;
        const k = days === 7 ? 6 : 1;
        const g = (
          dungeon: string,
          runs: number,
          runS: number,
          xp: number,
          goldPer: number,
          wins = runs,
          deaths = 0,
        ) => ({
          dungeon,
          runs: runs * k,
          wins: wins * k,
          deaths: deaths * k,
          run_s: runs * k * runS,
          cycle_s: runs * k * (runS + 12),
          xp: runs * k * xp,
          job_xp: Math.round(runs * k * xp * 0.3),
          gold: runs * k * goldPer,
        });
        return this.emit({
          t: "rpg.stats",
          re,
          d: {
            days,
            since: Date.now() - days * 86_400_000,
            runs: 101 * k,
            capped: false,
            lead_s: 12.3,
            dungeons: [
              g("masmorra-60", 48, 128, 33567, 4538),
              g("regiao-1", 22, 92, 18000, 2600),
              g("cacada-60", 31, 75, 9000, 1200, 29, 2),
            ],
          },
        });
      }
      default:
        return this.refuse(re, "invalid_message", "invalid_message");
    }
  }

  private lobby(dungeon: string, tv: string): RpgLobbyView {
    const h = this.hero()!;
    const d = dungeonById(dungeon);
    return {
      id: `lb-${dungeon}`,
      tv,
      room: "sala-lab",
      dungeon,
      leader: this.me,
      members: [
        {
          user_id: this.me,
          name: "Ana",
          cls: h.cls,
          level: h.level,
          regions: bossRegions(this.cleared()),
        },
      ],
      max: d?.party.max ?? 4,
      expires_at: Date.now() + 600_000,
      state: "forming",
      run_id: null,
      runs: 0,
      loop: false,
      next_at: null,
      last: null,
      stopped: null,
      stopped_detail: null,
    };
  }

  /**
   * Uma corrida de verdade no simulador: eu e os bots do grupo, `record: true`, um quadro por
   * segundo (÷ `speed`). No fim, a recompensa e o loot pelas mesmas funções do núcleo.
   */
  startRun(
    lobby: RpgLobbyView,
    opts: { seek?: number | "chefe" | "fim"; open?: boolean } = {},
  ) {
    const me = this.hero()!;
    const d = dungeonById(lobby.dungeon)!;
    // A vitrine fixa o kit (e a IA "sempre") de cada um, para todas as skills aparecerem.
    const withKit = (h: HeroV5, uid: string): HeroV5 => {
      const kit = this.world.kits?.[uid];
      if (!kit) return h;
      const builds = { ...h.skills.builds };
      for (const id of kit)
        builds[id] ??= { potency: 5, efficiency: 0, mechanics: {} };
      return {
        ...h,
        skills: {
          ...h.skills,
          slots: kit,
          builds,
          ai: Object.fromEntries(kit.map((id) => [id, [{ kind: "sempre" }]])),
        },
      };
    };
    const heroes = lobby.members.map((m) =>
      withKit(
        m.user_id === this.me
          ? me
          : {
              ...grow(m.cls, m.level, Math.max(1, Math.round(m.level * 0.62))),
              potions: {
                hp: { pequena: 100, media: 0, grande: 0 },
                mp: { pequena: 100, media: 0, grande: 0 },
              },
            },
        m.user_id,
      ),
    );
    const res: RunResult = simulateRun(
      d,
      heroes.map((x) => heroRunFighter(x)),
      {
        mode: "aleatorio",
        random: seeded(7),
        record: true,
      },
    );
    const view: RpgRunView = {
      id: `run-${Date.now()}`,
      tv: lobby.tv,
      room: lobby.room,
      dungeon: d.id,
      started_at: Date.now(),
      ends_at: Date.now() + res.seconds * 1000,
      auto: false,
      members: lobby.members.map((m, i) => {
        const x = heroes[i]!;
        const dv = heroDerived(balanceHero(x));
        return {
          user_id: m.user_id,
          name: m.name,
          cls: x.cls,
          level: x.level,
          hp_max: Math.round(dv.hp),
          mp_max: Math.round(dv.mp),
          equipment: x.equipment,
          job: x.job,
          proficiency: x.proficiency,
          // Como o servidor (service.ts runView): mana e recarga final de cada skill.
          skills: heroRunFighter(x).skills.map((s) => ({
            id: s.id,
            mana: Math.round(s.manaPct * dv.manaBase),
            cd_ms: Math.round(skillCooldownMs(s, dv.cooldownCut)),
          })),
          supplies: x.supplies,
          belt: x.belt,
          potions: { hp: x.potions.hp[x.belt.hp], mp: x.potions.mp[x.belt.mp] },
        };
      }),
    };
    const frames = res.frames ?? [];
    let st = runStateFrom({ run: view, frame: null, feed: [] });
    let i = 0;
    // "chefe": uns segundos depois do 2º pulso do Cataclismo (ou da entrada do chefe); "fim": tudo.
    const cata = frames.findIndex((f) =>
      f.e.some((e) => e.k === "cataclismo" && e.n >= 2),
    );
    const boss = frames.findIndex((f) => f.st === 3);
    const seek =
      opts.seek === "fim"
        ? frames.length
        : opts.seek === "chefe"
          ? Math.min(
              frames.length - 1,
              cata >= 0 ? cata + 1 : Math.max(0, boss) + 12,
            )
          : Math.min(frames.length, opts.seek ?? 0);
    if (seek > 0) {
      st = applyFrames(st, frames.slice(0, seek));
      i = seek;
    }
    this.set({
      runs: { ...this.world.runs, [view.id]: st },
      runOpen: opts.open === false ? this.world.runOpen : view.id,
      lobbies: Object.fromEntries(
        Object.entries(this.world.lobbies).map(([k, l]) => [
          k,
          { ...l, state: "running" as const, run_id: view.id },
        ]),
      ),
    });
    this.save("", me, {
      run: { id: view.id, dungeon: d.id, ends_at: view.ends_at },
    });
    const finish = () => {
      clearInterval(this.timer);
      this.endRun(view, res, heroes, frames);
    };
    if (i >= frames.length) return finish();
    clearInterval(this.timer);
    // speed 0: o quadro fica parado (as capturas).
    if (this.speed <= 0) return;
    this.timer = setInterval(() => {
      const cur = this.world.runs[view.id];
      if (!cur) return clearInterval(this.timer);
      const f: RunFrame | undefined = frames[i++];
      if (!f) return finish();
      this.set({
        runs: { ...this.world.runs, [view.id]: applyFrames(cur, [f]) },
      });
    }, 1000 / this.speed);
  }

  private endRun(
    view: RpgRunView,
    res: RunResult,
    heroes: HeroV5[],
    frames: RunFrame[],
  ) {
    const d = dungeonById(view.dungeon)!;
    const rewards = runRewards(
      d,
      heroes.map((h) => h.level),
      res,
    );
    const loot = runLoot(
      d,
      heroes.map((h) => h.cls),
      res,
      seeded(5),
    );
    const end: RpgRunEndView = {
      outcome: res.outcome,
      members: view.members.map((m, i) => {
        const items: OwnedItem[] = loot.items
          .filter((x) => x.hero === i)
          .map((x) => ({ ...x.item, uid: newUid() }));
        const alive = res.heroes[i]?.alive ?? false;
        return {
          user_id: m.user_id,
          dead: !alive,
          retreated: false,
          reward: {
            xp: rewards.heroes[i]!.xp,
            job_xp: jobXpOf(rewards.heroes[i]!.xp, heroes[i]!.equipment),
            gold: rewards.heroes[i]!.gold,
            items,
            ores: loot.ores[i] ?? {},
            stones: loot.protectionStones[i] ?? 0,
          },
          left: [],
          potions_used: {
            hp: Math.max(
              0,
              m.potions.hp - (res.heroes[i]?.hpPots ?? m.potions.hp),
            ),
            mp: Math.max(
              0,
              m.potions.mp - (res.heroes[i]?.mpPots ?? m.potions.mp),
            ),
          },
          ammo_used: 0,
          levels_gained: 0,
          jobs_gained: 0,
        };
      }),
    };
    const meIdx = view.members.findIndex((m) => m.user_id === this.me);
    const mine = end.members[meIdx];
    let hero = this.hero()!;
    if (mine?.reward) {
      const r = applyRun(hero, {
        xp: mine.reward.xp,
        jobXp: mine.reward.job_xp,
        gold: mine.reward.gold,
        items: mine.reward.items,
        ores: mine.reward.ores,
        stones: mine.reward.stones,
        potionsUsed: mine.potions_used,
        ammoUsed: 0,
      });
      if (r.ok) {
        hero = r.hero;
        mine.levels_gained = r.levelsGained;
        mine.jobs_gained = r.jobsGained;
        mine.left = r.left;
      }
    }
    const cur = this.world.runs[view.id];
    const last = frames.at(-1);
    this.set({
      runs: {
        ...this.world.runs,
        [view.id]: {
          ...(cur ?? runStateFrom({ run: view })),
          ...(last ? { frame: last } : {}),
          end,
        },
      },
      lobbies: Object.fromEntries(
        Object.entries(this.world.lobbies).map(([k, l]) => [
          k,
          {
            ...l,
            state: "ready" as const,
            run_id: null,
            runs: l.runs + 1,
            last: res.outcome,
            ...(res.outcome === "derrota" && l.loop
              ? { loop: false, stopped: "derrota" as const }
              : {}),
          },
        ]),
      ),
    });
    this.save("", hero, {
      run: null,
      // A vitória do grupo conclui a DG (26/11/2026).
      ...(res.outcome === "vitoria"
        ? { cleared: withCleared(this.cleared(), view.dungeon) }
        : {}),
    });
  }
}
