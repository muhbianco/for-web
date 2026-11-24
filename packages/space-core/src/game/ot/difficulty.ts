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
  "galerias-afogadas": { dmg: 3.08, hp: 1, furyMs: 25000 },
  "ninho-das-aranhas": { dmg: 2.13, hp: 1, furyMs: 30000 },
  "forja-rachada": { dmg: 1.54, hp: 1, furyMs: 35000 },
  "mina-assombrada": { dmg: 1, hp: 1, furyMs: 40000 },
  "bosque-petrificado": { dmg: 1.3, hp: 1, furyMs: 35000 },
  "cidadela-de-cinzas": { dmg: 0.71, hp: 1, furyMs: 55000 },
  "abismo-gelado": { dmg: 0.88, hp: 1, furyMs: 65000 },
  "trono-do-vazio": { dmg: 0.92, hp: 1, furyMs: 75000 },
  "pantano-dos-afogados": { dmg: 0.71, hp: 1, furyMs: 145000 },
  "fortaleza-partida": { dmg: 0.71, hp: 1, furyMs: 135000 },
  "deserto-de-vidro": { dmg: 0.71, hp: 1, furyMs: 135000 },
  "picos-trovejantes": { dmg: 0.84, hp: 1, furyMs: 190000 },
  "floresta-sombria": { dmg: 0.84, hp: 1, furyMs: 130000 },
  "catacumbas-reais": { dmg: 1.24, hp: 1, furyMs: 125000 },
  "vulcao-rubro": { dmg: 1, hp: 1, furyMs: 125000 },
  "abismo-coral": { dmg: 1.41, hp: 1, furyMs: 205000 },
  "cidade-celeste": { dmg: 1.3, hp: 1, furyMs: 120000 },
  "vale-dos-titas": { dmg: 1.41, hp: 1, furyMs: 120000 },
  "plano-etereo": { dmg: 1.41, hp: 1, furyMs: 110000 },
  "fenda-do-caos": { dmg: 1.58, hp: 1, furyMs: 105000 },
  "coracao-do-mundo": { dmg: 1.41, hp: 1, furyMs: 105000 },
};
