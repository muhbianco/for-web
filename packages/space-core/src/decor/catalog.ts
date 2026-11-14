import type { DecorCategory, DecorItem, DecorLayer, InteractionKind } from "./types.ts";

/**
 * The item catalog (ADR 0007): data only. The art lives in the client
 * (space-client/src/render/items.ts, one drawing per item id); the server only
 * needs footprints, layers and collision. Adding an item is adding one entry
 * here and one drawing there. Ids are stable: instances reference them.
 */
export interface Catalog {
  items: readonly DecorItem[];
  byId: ReadonlyMap<string, DecorItem>;
}

export const CATALOG_VERSION = 1;

interface Def {
  id: string;
  name: string;
  category: DecorCategory;
  layer?: DecorLayer;
  w?: number;
  h?: number;
  rotations?: 1 | 2 | 4;
  solid?: boolean;
  variants?: readonly string[];
  interaction?: InteractionKind;
  description?: string;
  tags?: readonly string[];
}

const defaultLayer: Record<DecorCategory, DecorLayer> = {
  floor: "floor",
  rug: "rug",
  furniture: "furniture",
  gamer: "furniture",
  decor: "furniture",
  lighting: "furniture",
  equipment: "furniture",
  special: "furniture",
};

function def(d: Def): DecorItem {
  const layer = d.layer ?? defaultLayer[d.category];
  return {
    id: d.id,
    name: d.name,
    category: d.category,
    layer,
    w: d.w ?? 1,
    h: d.h ?? 1,
    rotations: d.rotations ?? 1,
    solid: d.solid ?? (layer === "furniture"),
    ...(d.variants ? { variants: d.variants } : {}),
    ...(d.interaction ? { interaction: d.interaction } : {}),
    ...(d.description ? { description: d.description } : {}),
    ...(d.tags ? { tags: d.tags } : {}),
  };
}

const WOOD = ["claro", "escuro", "mel"] as const;
const FABRIC = ["azul", "cinza", "vermelho", "verde", "roxo"] as const;
const NEON = ["ciano", "magenta", "verde", "laranja"] as const;

const ITEMS: DecorItem[] = [
  // ---- Pisos (pintados por zona) --------------------------------------------
  def({ id: "floor-wood", name: "Piso de madeira", category: "floor", variants: WOOD, tags: ["tábua", "parquet"] }),
  def({ id: "floor-ceramic", name: "Piso de cerâmica", category: "floor", variants: ["branco", "bege", "xadrez"], tags: ["azulejo", "cozinha"] }),
  def({ id: "floor-carpet", name: "Carpete", category: "floor", variants: FABRIC, tags: ["tapete", "escritório"] }),
  def({ id: "floor-office", name: "Piso de escritório", category: "floor", variants: ["cinza", "grafite"], tags: ["vinílico"] }),
  def({ id: "floor-gamer", name: "Piso gamer", category: "floor", variants: NEON, description: "Placas escuras com frisos de LED.", tags: ["neon", "led"] }),
  def({ id: "floor-concrete", name: "Concreto", category: "floor", variants: ["cinza", "escuro"], tags: ["industrial", "galpão"] }),
  def({ id: "floor-grate", name: "Grade metálica", category: "floor", tags: ["industrial", "metal"] }),
  def({ id: "floor-tatami", name: "Tatame", category: "floor", tags: ["japonês", "dojo"] }),

  // ---- Tapetes --------------------------------------------------------------
  def({ id: "rug-round", name: "Tapete redondo", category: "rug", w: 2, h: 2, variants: FABRIC }),
  def({ id: "rug-living", name: "Tapete de sala", category: "rug", w: 4, h: 3, rotations: 2, variants: FABRIC }),
  def({ id: "rug-runner", name: "Passadeira", category: "rug", w: 1, h: 4, rotations: 2, variants: ["vermelho", "azul", "cinza"], tags: ["corredor"] }),
  def({ id: "rug-gamer", name: "Tapete gamer", category: "rug", w: 3, h: 2, rotations: 2, variants: NEON, tags: ["led", "neon"] }),
  def({ id: "rug-doormat", name: "Capacho", category: "rug", tags: ["entrada", "bem-vindo"] }),
  def({ id: "rug-striped", name: "Tapete listrado", category: "rug", w: 3, h: 3, variants: ["areia", "marinho"] }),

  // ---- Móveis ---------------------------------------------------------------
  def({ id: "sofa-2", name: "Sofá de 2 lugares", category: "furniture", w: 2, h: 1, rotations: 4, variants: FABRIC }),
  def({ id: "sofa-3", name: "Sofá de 3 lugares", category: "furniture", w: 3, h: 1, rotations: 4, variants: FABRIC }),
  def({ id: "armchair", name: "Poltrona", category: "furniture", rotations: 4, variants: FABRIC }),
  def({ id: "beanbag", name: "Puff", category: "furniture", variants: FABRIC }),
  def({ id: "coffee-table", name: "Mesa de centro", category: "furniture", w: 2, h: 1, rotations: 2, variants: WOOD }),
  def({ id: "table-round", name: "Mesa redonda", category: "furniture", w: 2, h: 2, variants: WOOD }),
  def({ id: "table-square", name: "Mesa quadrada", category: "furniture", variants: WOOD }),
  def({ id: "dining-table", name: "Mesa de jantar", category: "furniture", w: 3, h: 2, rotations: 2, variants: WOOD }),
  def({ id: "meeting-table", name: "Mesa de reunião", category: "furniture", w: 4, h: 2, rotations: 2, variants: WOOD, tags: ["reunião", "escritório"] }),
  def({ id: "chair", name: "Cadeira", category: "furniture", rotations: 4, variants: WOOD }),
  def({ id: "gaming-chair", name: "Cadeira gamer", category: "furniture", rotations: 4, variants: ["preto-vermelho", "preto-azul", "branco-rosa"] }),
  def({ id: "stool", name: "Banqueta", category: "furniture", variants: WOOD }),
  def({ id: "desk", name: "Escrivaninha", category: "furniture", w: 2, h: 1, rotations: 4, variants: WOOD }),
  def({ id: "bookshelf", name: "Estante de livros", category: "furniture", w: 2, h: 1, variants: WOOD }),
  def({ id: "cabinet", name: "Armário", category: "furniture", variants: WOOD }),
  def({ id: "locker", name: "Armário de aço", category: "furniture", variants: ["azul", "verde", "cinza"] }),
  def({ id: "counter", name: "Balcão", category: "furniture", w: 3, h: 1, rotations: 2, variants: WOOD, tags: ["recepção", "bar"] }),
  def({ id: "bar-shelf", name: "Prateleira de bar", category: "furniture", w: 2, h: 1, variants: WOOD }),

  // ---- Gamer ----------------------------------------------------------------
  def({ id: "desk-pc", name: "Setup gamer", category: "gamer", w: 2, h: 1, rotations: 4, variants: NEON, description: "Escrivaninha com dois monitores, teclado, mouse e headset.", interaction: "link", tags: ["computador", "pc", "monitor"] }),
  def({ id: "desk-laptop", name: "Mesa com notebook", category: "gamer", w: 2, h: 1, rotations: 4, variants: WOOD, interaction: "link", tags: ["notebook", "laptop"] }),
  def({ id: "desk-stream", name: "Bancada de stream", category: "gamer", w: 3, h: 1, rotations: 4, variants: NEON, description: "Monitor, microfone de braço, câmera e ring light.", interaction: "link", tags: ["streaming", "live", "microfone"] }),
  def({ id: "pc-tower", name: "Gabinete", category: "gamer", variants: NEON, tags: ["computador"] }),
  def({ id: "tv-stand", name: "TV no rack", category: "gamer", w: 2, h: 1, rotations: 4, interaction: "frame", description: "Mostra um vídeo ou página ao interagir.", tags: ["televisor", "televisão"] }),
  def({ id: "tv-wall", name: "TV de parede", category: "gamer", layer: "wall", w: 2, h: 1, solid: false, interaction: "frame", tags: ["televisor", "televisão"] }),
  def({ id: "console-shelf", name: "Rack de consoles", category: "gamer", variants: ["preto", "branco"], tags: ["videogame", "console"] }),
  def({ id: "arcade", name: "Máquina de arcade", category: "gamer", rotations: 4, variants: ["vermelho", "azul", "roxo", "amarelo"], interaction: "frame", description: "Abre um joguinho (uma página) ao interagir.", tags: ["fliperama", "jogo"] }),
  def({ id: "arcade-double", name: "Arcade duplo", category: "gamer", w: 2, h: 1, rotations: 4, variants: ["preto", "vermelho"], interaction: "frame", tags: ["fliperama", "jogo"] }),
  def({ id: "speaker", name: "Caixa de som", category: "gamer", variants: ["preto", "branco"] }),
  def({ id: "mic-stand", name: "Microfone de pedestal", category: "gamer", tags: ["podcast"] }),
  def({ id: "vr-stand", name: "Óculos VR no suporte", category: "gamer", tags: ["realidade virtual"] }),
  def({ id: "server-rack", name: "Rack de servidores", category: "gamer", variants: ["azul", "verde"], tags: ["servidor", "ti"] }),
  def({ id: "pinball", name: "Pinball", category: "gamer", w: 1, h: 2, rotations: 4, variants: ["vermelho", "azul"], interaction: "frame", tags: ["fliperama"] }),

  // ---- Decoração ------------------------------------------------------------
  def({ id: "plant-small", name: "Planta pequena", category: "decor", variants: ["vaso-terracota", "vaso-branco", "vaso-preto"] }),
  def({ id: "plant-tall", name: "Planta alta", category: "decor", variants: ["vaso-terracota", "vaso-branco", "vaso-preto"] }),
  def({ id: "plant-hanging", name: "Planta pendente", category: "decor", layer: "wall", solid: false }),
  def({ id: "painting", name: "Quadro", category: "decor", layer: "wall", solid: false, variants: ["paisagem", "abstrato", "retrato", "mar"], interaction: "picture", description: "Pode mostrar uma imagem ao interagir." }),
  def({ id: "painting-wide", name: "Quadro grande", category: "decor", layer: "wall", w: 2, h: 1, solid: false, variants: ["paisagem", "abstrato", "cidade"], interaction: "picture" }),
  def({ id: "poster", name: "Pôster", category: "decor", layer: "wall", solid: false, variants: ["gamer", "retro", "espaço", "banda", "mapa"] }),
  def({ id: "window", name: "Janela", category: "decor", layer: "wall", solid: false, variants: ["dia", "noite", "cidade"] }),
  def({ id: "window-wide", name: "Janela ampla", category: "decor", layer: "wall", w: 2, h: 1, solid: false, variants: ["dia", "noite", "cidade"] }),
  def({ id: "curtain", name: "Cortina", category: "decor", layer: "wall", w: 2, h: 1, solid: false, variants: FABRIC }),
  def({ id: "clock", name: "Relógio", category: "decor", layer: "wall", solid: false }),
  def({ id: "whiteboard", name: "Quadro branco", category: "decor", layer: "wall", w: 2, h: 1, solid: false, interaction: "note", description: "Mostra um texto ao interagir.", tags: ["reunião", "anotações"] }),
  def({ id: "sign", name: "Placa", category: "decor", layer: "wall", w: 2, h: 1, solid: false, interaction: "note", variants: ["madeira", "neon", "metal"], description: "Um aviso na parede, com texto ao interagir." }),
  def({ id: "trophy-shelf", name: "Prateleira de troféus", category: "decor", layer: "wall", w: 2, h: 1, solid: false }),
  def({ id: "trash-can", name: "Lixeira", category: "decor", variants: ["cinza", "azul", "verde"] }),
  def({ id: "box-stack", name: "Caixas", category: "decor", tags: ["caixa", "depósito"] }),
  def({ id: "vending-machine", name: "Máquina de lanches", category: "decor", variants: ["azul", "vermelho"], tags: ["vending"] }),
  def({ id: "water-cooler", name: "Bebedouro", category: "decor" }),
  def({ id: "fridge", name: "Geladeira", category: "decor", variants: ["branco", "preto", "vermelho"], tags: ["cozinha"] }),
  def({ id: "bar-cart", name: "Carrinho de bar", category: "decor" }),
  def({ id: "punching-bag", name: "Saco de pancada", category: "decor", tags: ["academia"] }),

  // ---- Iluminação -----------------------------------------------------------
  def({ id: "floor-lamp", name: "Luminária de chão", category: "lighting", variants: ["preto", "dourado", "branco"] }),
  def({ id: "led-pillar", name: "Coluna de LED", category: "lighting", variants: NEON, tags: ["neon"] }),
  def({ id: "neon-strip", name: "Fita de LED", category: "lighting", layer: "wall", w: 2, h: 1, solid: false, variants: NEON, tags: ["neon"] }),
  def({ id: "neon-sign", name: "Letreiro neon", category: "lighting", layer: "wall", w: 2, h: 1, solid: false, variants: ["gg", "live", "play", "coracao"], tags: ["neon", "letreiro"] }),
  def({ id: "ceiling-lamp", name: "Lustre", category: "lighting", layer: "ceiling", solid: false, variants: ["quente", "frio"] }),
  def({ id: "spotlight", name: "Refletor", category: "lighting", layer: "ceiling", solid: false, variants: NEON }),

  // ---- Equipamentos ---------------------------------------------------------
  def({ id: "camera-tripod", name: "Câmera no tripé", category: "equipment", rotations: 4, tags: ["filmagem", "streaming"] }),
  def({ id: "ring-light", name: "Ring light", category: "equipment", tags: ["streaming"] }),
  def({ id: "mixer", name: "Mesa de som", category: "equipment", w: 2, h: 1, rotations: 2, tags: ["áudio", "dj"] }),
  def({ id: "projector-screen", name: "Tela de projeção", category: "equipment", layer: "wall", w: 3, h: 1, solid: false, interaction: "frame", tags: ["reunião", "apresentação"] }),
  def({ id: "podium", name: "Púlpito", category: "equipment", rotations: 4, variants: WOOD }),
  def({ id: "drum-kit", name: "Bateria", category: "equipment", w: 2, h: 2, tags: ["música"] }),
  def({ id: "guitar-stand", name: "Guitarra no suporte", category: "equipment", variants: ["vermelho", "preto", "sunburst"], tags: ["música"] }),

  // ---- Especiais ------------------------------------------------------------
  def({ id: "portal-pad", name: "Portal", category: "special", layer: "rug", solid: false, interaction: "teleport", variants: NEON, description: "Leva para outro ambiente ao interagir." }),
  def({ id: "info-totem", name: "Totem de informações", category: "special", interaction: "note", description: "Mostra um texto ao interagir." }),
  def({ id: "photo-frame", name: "Moldura de foto", category: "special", interaction: "picture", description: "Mostra uma imagem ao interagir.", variants: WOOD }),
  def({ id: "kiosk", name: "Quiosque web", category: "special", interaction: "frame", description: "Abre uma página dentro do espaço ao interagir." }),
  def({ id: "fountain", name: "Fonte", category: "special", w: 2, h: 2 }),
  def({ id: "statue", name: "Estátua", category: "special", variants: ["mármore", "bronze", "ouro"] }),
];

export const CATALOG: Catalog = { items: ITEMS, byId: new Map(ITEMS.map((i) => [i.id, i])) };

export function itemOf(catalog: Catalog, id: string): DecorItem | undefined {
  return catalog.byId.get(id);
}

export const CATEGORY_LABELS: Record<DecorCategory, string> = {
  floor: "Pisos",
  rug: "Tapetes",
  furniture: "Móveis",
  gamer: "Gamer",
  decor: "Decoração",
  lighting: "Iluminação",
  equipment: "Equipamentos",
  special: "Especiais",
};

/** Case- and accent-insensitive search over name, description and tags. */
export function searchCatalog(catalog: Catalog, query: string, category?: DecorCategory | "interactive"): DecorItem[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(query.trim());
  return catalog.items.filter((i) => {
    if (category === "interactive" ? !i.interaction : category && i.category !== category) return false;
    if (!q) return true;
    return [i.name, i.description ?? "", ...(i.tags ?? [])].some((t) => norm(t).includes(q));
  });
}
