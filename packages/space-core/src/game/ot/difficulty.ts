/**
 * A dificuldade de cada dungeon para o grupo completo [nosso] (24/11/2026, pedido do dono: "a
 * party completa é importante; sem algum membro, a deficiência precisa ser evidente"). Gerado por
 * scripts/party-tune.ts: os golpes dos monstros vezes `dmg` e a vida vezes `hp` para o grupo das
 * quatro classes vencer ~85% na entrada, e a Fúria da sala do chefe (run.ts) depois de `furyMs`,
 * um pouco mais do que o grupo completo leva nela. Sem entrada aqui: tudo 1 e a Fúria padrão.
 */
export interface Difficulty {
  dmg: number;
  hp: number;
  furyMs: number;
  /**
   * Dungeon de iniciante (as primeiras): sem a dificuldade de grupo, sem Fúria e com a sala do
   * tamanho de antes (+40% por herói), para quem começa sozinho ou em dupla conseguir jogar.
   */
  beginner?: boolean;
}

export const DIFFICULTY: Readonly<Record<string, Difficulty>> = {
  "cripta-do-musgo": { dmg: 1, hp: 1, furyMs: 25000, beginner: true },
  "toca-dos-javalis": { dmg: 1, hp: 1, furyMs: 20000, beginner: true },
  "galerias-afogadas": { dmg: 3.15, hp: 0.99, furyMs: 25000 },
  "ninho-das-aranhas": { dmg: 2, hp: 1, furyMs: 35000 },
  "forja-rachada": { dmg: 1.48, hp: 1, furyMs: 35000 },
  "mina-assombrada": { dmg: 1, hp: 1, furyMs: 40000 },
  "bosque-petrificado": { dmg: 1.3, hp: 1.09, furyMs: 35000 },
  "cidadela-de-cinzas": { dmg: 0.77, hp: 1, furyMs: 55000 },
  "abismo-gelado": { dmg: 0.9, hp: 1, furyMs: 60000 },
  "trono-do-vazio": { dmg: 0.85, hp: 1, furyMs: 70000 },
  "pantano-dos-afogados": { dmg: 0.71, hp: 1, furyMs: 140000 },
  "fortaleza-partida": { dmg: 0.84, hp: 1, furyMs: 130000 },
  "deserto-de-vidro": { dmg: 0.84, hp: 1, furyMs: 140000 },
  "picos-trovejantes": { dmg: 0.84, hp: 1.09, furyMs: 140000 },
  "floresta-sombria": { dmg: 1.04, hp: 1.15, furyMs: 145000 },
  "catacumbas-reais": { dmg: 1.19, hp: 1.19, furyMs: 125000 },
  "vulcao-rubro": { dmg: 1.3, hp: 1.24, furyMs: 130000 },
  "abismo-coral": { dmg: 1.27, hp: 1.2, furyMs: 125000 },
  "cidade-celeste": { dmg: 1.33, hp: 1.3, furyMs: 120000 },
  "vale-dos-titas": { dmg: 1.46, hp: 1.3, furyMs: 115000 },
  "fenda-do-caos": { dmg: 1.41, hp: 1.3, furyMs: 105000 },
  "coracao-do-mundo": { dmg: 1.61, hp: 1.2, furyMs: 95000 },
  "plano-etereo": { dmg: 1.42, hp: 1.3, furyMs: 110000 },
};
