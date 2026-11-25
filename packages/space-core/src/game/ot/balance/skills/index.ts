import type { ClassId } from "../content.ts";
import { ASSASSINO, CACADOR, MAGO } from "./dps.ts";
import type { SkillContent } from "./schema.ts";
import { DRUIDA, PADRE } from "./suportes.ts";
import { GUERREIRO, PALADINO } from "./tanques.ts";

/** As 42 skills do spec (§8), por classe, na ordem do spec. */
export const SKILLS_BY_CLASS: Record<ClassId, SkillContent[]> = {
  guerreiro: GUERREIRO,
  paladino: PALADINO,
  padre: PADRE,
  druida: DRUIDA,
  mago: MAGO,
  cacador: CACADOR,
  assassino: ASSASSINO,
};

export const SKILLS: SkillContent[] = Object.values(SKILLS_BY_CLASS).flat();

/** Skill por classe e id (os ids se repetem entre classes? não; mas a busca é sempre pela classe). */
export function skillOf(cls: ClassId, id: string): SkillContent | undefined {
  return SKILLS_BY_CLASS[cls].find((s) => s.id === id);
}

/**
 * Os kits de referência do §8 ("Kits de referência usados no simulador"), 4 slots contra chefe, na
 * ordem de prioridade em que o gabarito os rodou.
 */
export const REFERENCE_KITS: Record<ClassId, string[]> = {
  guerreiro: [
    "golpe-provocador",
    "grito-de-guerra",
    "muralha-de-ferro",
    "ultima-resistencia",
  ],
  paladino: [
    "golpe-sagrado",
    "escudo-da-fe",
    "bencao-da-egide",
    "imposicao-de-maos",
  ],
  padre: ["curar", "escudo-sagrado", "santuario", "bencao"],
  druida: ["florescer", "pele-de-carvalho", "espinhos", "rejuvenescer"],
  mago: ["meteoro", "raio-em-cadeia", "seta-arcana", "escudo-de-mana"],
  cacador: [
    "marca-do-cacador",
    "foco-mortal",
    "tiro-perfurante",
    "rajada-dupla",
  ],
  assassino: [
    "danca-das-laminas",
    "emboscada",
    "sequencia-letal",
    "lamina-envenenada",
  ],
};

/**
 * Do T4 em diante (L70, quando começa a Invocação do §12.3), o kit de chefe muda onde a classe precisa
 * responder aos lacaios: o paladino troca a Égide pela Consagração (P63). O guerreiro já tem o Grito.
 */
export const REFERENCE_KITS_T4: Partial<Record<ClassId, string[]>> = {
  paladino: [
    "golpe-sagrado",
    "consagracao",
    "escudo-da-fe",
    "imposicao-de-maos",
  ],
};

/** Kits solo (§8): tanques trocam uma defensiva por área; padre com Luz Sagrada; druida com Raízes. */
export const REFERENCE_SOLO_KITS: Record<ClassId, string[]> = {
  ...REFERENCE_KITS,
  guerreiro: [
    "golpe-provocador",
    "redemoinho",
    "muralha-de-ferro",
    "ultima-resistencia",
  ],
  paladino: [
    "golpe-sagrado",
    "consagracao",
    "escudo-da-fe",
    "imposicao-de-maos",
  ],
  padre: ["curar", "luz-sagrada", "escudo-sagrado", "bencao"],
  druida: ["rejuvenescer", "espinhos", "raizes", "pele-de-carvalho"],
};

export * from "./schema.ts";
