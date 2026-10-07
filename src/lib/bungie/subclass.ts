export type SubclassSlotType =
  | "super"
  | "classAbility"
  | "movement"
  | "melee"
  | "grenade"
  | "aspect"
  | "fragment"
  | "other";

export function getSubclassSlotType(
  identifier: string | null
): SubclassSlotType {
  if (!identifier) {
    return "other";
  }

  const value = identifier.toLowerCase();

  if (value.includes("super")) {
    return "super";
  }

if (
  value.includes("class_ability") ||
  value.includes("class_abilities") ||
  value.includes("classability")
) {
  return "classAbility";
}

  if (
    value.includes("movement") ||
    value.includes("jump")
  ) {
    return "movement";
  }

  if (value.includes("melee")) {
    return "melee";
  }

  if (value.includes("grenade")) {
    return "grenade";
  }

  if (value.includes("aspect")) {
    return "aspect";
  }

  if (value.includes("fragment")) {
    return "fragment";
  }

  return "other";
}