import assert from "node:assert/strict";
import test from "node:test";

import {
  type RpgRecordDoc,
  MemoryRecordStore,
  better,
  dungeonScore,
  rankRow,
  recordOf,
} from "./records.ts";

const win = (
  dungeon: string,
  members: [string, string, string?][],
  started_at = 1_000,
  outcome: "vitoria" | "derrota" = "vitoria",
) => ({
  _id: `run-${dungeon}-${started_at}`,
  server: "S1",
  dungeon,
  outcome,
  started_at,
  members: members.map(([userId, cls, name]) => ({
    userId,
    name: name ?? userId,
    hero: { cls: cls as "mago", level: 100 },
  })),
});

test("ranking: a dificuldade da DG ordena por nível; no mesmo nível, Região > Masmorra > Caçada", () => {
  assert.ok(dungeonScore("regiao-2")! > dungeonScore("masmorra-90")!);
  assert.ok(dungeonScore("masmorra-90")! > dungeonScore("cacada-90")!);
  assert.ok(dungeonScore("masmorra-40")! > dungeonScore("cacada-40")!);
  assert.ok(dungeonScore("cacada-101")! > dungeonScore("regiao-2")!);
  assert.equal(dungeonScore("nao-existe"), null);
});

test("ranking: só vitória vira recorde; um herói é solo, dois ou mais é grupo, com os ids em ordem", () => {
  assert.equal(
    recordOf(win("cacada-40", [["U1", "mago"]], 1, "derrota")),
    null,
  );
  const solo = recordOf(win("cacada-40", [["U1", "mago", "Ana"]]))!;
  assert.equal(solo.kind, "solo");
  assert.equal(solo._id, "solo:U1");
  assert.equal(solo.server, "S1");
  assert.deepEqual(solo.members, [
    { user_id: "U1", name: "Ana", cls: "mago", level: 100 },
  ]);
  const g1 = recordOf(
    win("masmorra-40", [
      ["U2", "padre"],
      ["U1", "guerreiro"],
    ]),
  )!;
  const g2 = recordOf(
    win("masmorra-60", [
      ["U1", "guerreiro"],
      ["U2", "padre"],
    ]),
  )!;
  assert.equal(g1.kind, "grupo");
  // O mesmo conjunto de jogadores é o mesmo recorde, em qualquer ordem.
  assert.equal(g1._id, g2._id);
  // A ordem dos membros fica a da corrida (a tela mostra como o grupo entrou).
  assert.deepEqual(
    g1.members.map((m) => m.user_id),
    ["U2", "U1"],
  );
});

test("ranking: o recorde só sobe; na mesma DG fica a primeira vez", async () => {
  const st = new MemoryRecordStore();
  const a = recordOf(win("masmorra-60", [["U1", "mago"]], 5_000))!;
  assert.ok(await st.offer(a));
  // Mais fácil não troca.
  assert.equal(
    await st.offer(recordOf(win("cacada-60", [["U1", "mago"]], 9_000))!),
    false,
  );
  // Mesma DG mais tarde não troca; mais cedo (a carga das antigas chegando depois) troca.
  assert.equal(
    await st.offer(recordOf(win("masmorra-60", [["U1", "mago"]], 6_000))!),
    false,
  );
  assert.ok(
    await st.offer(recordOf(win("masmorra-60", [["U1", "mago"]], 4_000))!),
  );
  assert.equal(st.docs.get("solo:U1")!.at, 4_000);
  // Mais difícil troca.
  assert.ok(
    await st.offer(recordOf(win("regiao-2", [["U1", "mago"]], 7_000))!),
  );
  assert.equal(st.docs.get("solo:U1")!.dungeon, "regiao-2");
  // O recorde é do herói em todo o Muchat: vencer noutro servidor conta (e mostra esse servidor).
  assert.ok(
    await st.offer({
      ...recordOf(win("regiao-3", [["U1", "mago"]], 8_000))!,
      server: "S2",
    }),
  );
  assert.equal(st.docs.size, 1);
  assert.equal(st.docs.get("solo:U1")!.server, "S2");
});

test("ranking: o top é de todos os servidores, da DG mais difícil para a mais fácil; empate, quem chegou antes", async () => {
  const st = new MemoryRecordStore();
  const put = (r: RpgRecordDoc | null) => st.offer(r!);
  await put(recordOf(win("cacada-40", [["U1", "mago"]], 3)));
  await put(recordOf(win("masmorra-60", [["U2", "padre"]], 2)));
  await put(recordOf(win("masmorra-60", [["U3", "druida"]], 1)));
  await put({
    ...recordOf(win("regiao-10", [["U9", "mago"]], 1))!,
    server: "S2",
  });
  const top = await st.top("solo", 10);
  assert.deepEqual(
    top.map((r) => r.members[0]!.user_id),
    ["U9", "U3", "U2", "U1"],
  );
  assert.equal(top[0]!.server, "S2");
  assert.deepEqual((await st.top("solo", 2)).length, 2);
  assert.deepEqual(await st.top("grupo", 10), []);
  // A linha leva o nome do servidor de agora (null: o servidor não existe mais).
  const names: Record<string, string> = { S2: "Taverna" };
  assert.deepEqual(rankRow(top[0]!, (id) => names[id] ?? null).server, {
    id: "S2",
    name: "Taverna",
  });
  assert.deepEqual(rankRow(top[1]!, (id) => names[id] ?? null).server, {
    id: "S1",
    name: null,
  });
});

test("ranking: better() compara DG e data", () => {
  const r = recordOf(win("masmorra-60", [["U1", "mago"]], 10))!;
  assert.ok(better(r, undefined));
  assert.equal(better(r, r), false);
  assert.ok(better({ ...r, at: 5 }, r));
  assert.ok(better({ ...r, score: r.score + 1, at: 99 }, r));
});
