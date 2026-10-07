export type GuardianClassType =
  | 0 // Titan
  | 1 // Hunter
  | 2; // Warlock

export type SubclassElement =
  | "arc"
  | "solar"
  | "void"
  | "stasis"
  | "strand"
  | "prismatic";

export type SubclassCatalogEntry = {
  itemHash: number;
  classType: GuardianClassType;
  name: string;
  element: SubclassElement;
};

export const SUBCLASS_CATALOG: SubclassCatalogEntry[] = [
  // TITAN
  {
    itemHash: 2932390016,
    classType: 0,
    name: "Striker",
    element: "arc",
  },
  {
    itemHash: 2550323932,
    classType: 0,
    name: "Sunbreaker",
    element: "solar",
  },
  {
    itemHash: 2842471112,
    classType: 0,
    name: "Sentinel",
    element: "void",
  },
  {
    itemHash: 613647804,
    classType: 0,
    name: "Behemoth",
    element: "stasis",
  },
  {
    itemHash: 242419885,
    classType: 0,
    name: "Berserker",
    element: "strand",
  },
  {
    itemHash: 1616346845,
    classType: 0,
    name: "Prismatic Titan",
    element: "prismatic",
  },

  // HUNTER
  {
    itemHash: 2328211300,
    classType: 1,
    name: "Arcstrider",
    element: "arc",
  },
  {
    itemHash: 2240888816,
    classType: 1,
    name: "Gunslinger",
    element: "solar",
  },
  {
    itemHash: 2453351420,
    classType: 1,
    name: "Nightstalker",
    element: "void",
  },
  {
    itemHash: 873720784,
    classType: 1,
    name: "Revenant",
    element: "stasis",
  },
  {
    itemHash: 3785442599,
    classType: 1,
    name: "Threadrunner",
    element: "strand",
  },
  {
    itemHash: 4282591831,
    classType: 1,
    name: "Prismatic Hunter",
    element: "prismatic",
  },

  // WARLOCK
  {
    itemHash: 3168997075,
    classType: 2,
    name: "Stormcaller",
    element: "arc",
  },
  {
    itemHash: 3941205951,
    classType: 2,
    name: "Dawnblade",
    element: "solar",
  },
  {
    itemHash: 2849050827,
    classType: 2,
    name: "Voidwalker",
    element: "void",
  },
  {
    itemHash: 3291545503,
    classType: 2,
    name: "Shadebinder",
    element: "stasis",
  },
  {
    itemHash: 4204413574,
    classType: 2,
    name: "Broodweaver",
    element: "strand",
  },
  {
    itemHash: 3893112950,
    classType: 2,
    name: "Prismatic Warlock",
    element: "prismatic",
  },
];

export function getSubclassCatalog(
  classType: number
) {
  return SUBCLASS_CATALOG.filter(
    (subclass) =>
      subclass.classType === classType
  );
}