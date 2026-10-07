export type WeaponRollEntry = {
  socketIndex: number;
  plugHash: number | null;
  name: string;
  description: string;
  icon: string | null;
  type:
    | "barrel"
    | "magazine"
    | "trait"
    | "origin"
    | "masterwork"
    | "other";
};

export function getWeaponPlugType(
  identifier: string | null
): WeaponRollEntry["type"] {
  if (!identifier) {
    return "other";
  }

  const value = identifier.toLowerCase();

  if (
    value.includes("barrel") ||
    value.includes("scope") ||
    value.includes("sight")
  ) {
    return "barrel";
  }

  if (
    value.includes("magazine") ||
    value.includes("battery") ||
    value.includes("ammo")
  ) {
    return "magazine";
  }

  if (
    value.includes("trait") ||
    value.includes("perk")
  ) {
    return "trait";
  }

  if (
    value.includes("origin")
  ) {
    return "origin";
  }

  if (
    value.includes("masterwork")
  ) {
    return "masterwork";
  }

  return "other";
}