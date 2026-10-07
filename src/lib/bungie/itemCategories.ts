export type ItemCategory =
  | "weapon"
  | "armor"
  | "subclass"
  | "finisher"
  | "quest"
  | "ghost"
  | "ship"
  | "vehicle"
  | "emote"
  | "other";

export function getItemCategory(
  itemType: number | null
): ItemCategory {
  switch (itemType) {
    case 2:
      return "armor";

    case 3:
      return "weapon";

    case 16:
      return "subclass";

    case 29:
      return "finisher";

    case 24:
      return "ghost";

    case 21:
      return "ship";

    case 22:
      return "vehicle";

    case 23:
      return "emote";

    case 12:
    case 13:
    case 15:
      return "quest";

    default:
      return "other";
  }
}