/**
 * Destiny Builder — Phase 8R.6.3C4: evidence-first, bounded AI context adapter.
 * Install as: src/lib/destiny-builder/aiContextBudget.ts
 *
 * Pure/read-only. NEVER calls AI or Bungie, never ranks combat effectiveness,
 * never transfers account/character/item-instance IDs or API secrets.
 * Returned `packet` is the ONLY object designed for transmission to the AI
 * endpoint. `privateItemRefs` stays in the browser and MUST NOT be sent.
 *
 * The LLM can SUGGEST aliases, but every candidate MUST be checked by the
 * existing deterministic Full Build Planner against fresh local data.
 */
import type { UniversalPlanningContext, PlanningGearOption } from "./universalPlanningContext";

const MAX_GOAL = 600;
const MAX_PACKET_CHARS = 18_000;
const MAX_GEAR = 26;
const MAX_PERKS = 3;
const MAX_SUBCLASSES = 6;
const MAX_SOCKETS = 15;
const MAX_CHOICES_PER_SOCKET = 5;

const clamp = (text: string, max: number): string => text.trim().replace(/\s+/g, " ").slice(0, max);

export type SharedAiGear = {
  ref: string;
  name: string;
  type: "weapon" | "armor";
  itemHash: number;
  slotHash: number;
  selected: boolean;
  verifiedDetail: boolean;
  exotic?: boolean | null;
  stats?: Array<[number, number]>;
  perks?: Array<{ hash: number; name: string; description: string }>;
};

export type SharedAiPacket = {
  version: 1;
  purpose: "hypotheses_only_require_live_validation";
  goal: string;
  guardian: { className: string; activity: string; currentSubclass: string | null };
  coverage: { account: string; verifiedDetails: number; totalGear: number; unknownDetails: number };
  subclasses: Array<{
    hash: number;
    name: string;
    element: string;
    status: string;
    selected: boolean;
    setupKnown: boolean;
    socketsIncluded: boolean;
    sockets: Array<{
      index: number;
      type: string;
      options: Array<{ hash: number; name: string; selected: boolean; status: string; description: string }>;
    }>;
  }>;
  gear: SharedAiGear[];
  artifact: { name: string | null; coverage: string; selectedPerks: string[] };
  mechanics: Array<{ id: string; status: string; trigger: string; effects: string[] }>;
  gaps: string[];
};

export type LocalGearIdentity = { itemInstanceId: string; itemHash: number; slotHash: number };

export interface AiContextBudgetResult {
  /** Send this object alone. It intentionally contains NO Bungie account/instance IDs. */
  packet: SharedAiPacket;
  /** Never serialize or transmit. Used solely for fresh local validation. */
  privateItemRefs: Readonly<Record<string, LocalGearIdentity>>;
  diagnostics: {
    packetChars: number;
    gearSent: number;
    eligibleGearObserved: number;
    gearOmitted: number;
    truncated: boolean;
  };
}

/** Search only OBSERVED item / perk text. Synonyms are retrieval hints, never gameplay rules. */
function normalizedText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function goalTerms(goal: string): string[] {
  const normalized = normalizedText(goal);
  const stop = new Set(["quello", "voglio", "vorrei", "build", "classe", "grazie", "perche", "della", "delle", "dello", "dentro", "senza", "molto", "tutto", "degli", "questo", "questa", "utilizzare", "possiedo", "posseduti", "warlock", "titan", "hunter", "void", "solar", "strand", "stasis", "prismatic", "arc", "granate", "granata", "grenade", "sopravvivenza", "survival"]);
  const terms = (normalized.match(/[a-z0-9]{4,}/g) ?? []).filter((term) => !stop.has(term));
  const add = (pattern: RegExp, words: string[]) => {
    if (pattern.test(normalized)) terms.push(...words);
  };
  add(/granat|grenad|abilit|ability|ricaric|regen|cooldown/, ["grenade", "granat", "ability", "abilit", "energy", "energia", "recharge", "regen"]);
  add(/sopravv|surviv|resisten|difes|health|cura|heal|tank/, ["health", "heal", "cure", "shield", "overshield", "resist", "surviv", "sopravv", "devour"]);
  add(/mischia|melee/, ["melee", "mischia", "punch"]);
  add(/super|orb|sfera/, ["super", "orb", "sphere"]);
  add(/volatile|volatil/, ["volatile", "volatil"]);
  add(/weaken|indeboli/, ["weaken", "indeboli"]);
  add(/invisib|stealth/, ["invisib", "stealth"]);
  add(/damage|danno|danni|dps/, ["damage", "danno", "danni"]);
  // Element terms can find wording in a perk; they NEVER certify the weapon element.
  add(/\bvoid\b|\bvuoto\b/, ["void", "vuoto"]);
  add(/\bsolar\b|\bsolare\b/, ["solar", "solare"]);
  add(/\barc\b/, ["arc"]);
  add(/\bstrand\b|\btela\b/, ["strand"]);
  add(/\bstasis\b|\bstasi\b/, ["stasis"]);
  add(/\bprismatic\b|\bprismatico\b/, ["prismatic"]);
  return [...new Set(terms)].slice(0, 26);
}

function textMatches(value: string, terms: readonly string[]): number {
  const text = normalizedText(value);
  return terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
}

function perkRelevance(perk: PlanningGearOption["perks"][number], terms: readonly string[]): number {
  return textMatches(`${perk.name} ${perk.description}`, terms);
}

function relevance(item: PlanningGearOption, terms: readonly string[]): number {
  if (item.detailCoverage !== "verified") return 0;
  // Perk descriptions provide more evidence of a goal match than item names.
  return item.perks.reduce((score, perk) => score + 3 * perkRelevance(perk, terms), 0) +
    textMatches(item.name, terms);
}

function verifiedItem(item: PlanningGearOption): boolean {
  return item.eligibility === "candidate" && item.itemInstanceId !== null &&
    item.slotHash !== null && item.positionStatus === "confirmed";
}

/** Preserve the selected build; diversify credible alternatives over all available slots. */
function chooseGear(context: UniversalPlanningContext, terms: readonly string[]): PlanningGearOption[] {
  const items = context.gearOptions.filter((item) => verifiedItem(item) || item.selectedInBuild);
  const score = (item: PlanningGearOption): number =>
    10 * relevance(item, terms) +
    (item.detailCoverage === "verified" ? 8 : 0) +
    (item.category === "armor" && item.armorMetadata?.exotic === true ? 11 : 0) +
    (item.detailCoverage === "verified" ? Math.min(item.perks.length, 3) : 0);
  const order = (a: PlanningGearOption, b: PlanningGearOption): number =>
    score(b) - score(a) || a.category.localeCompare(b.category) ||
    (a.slotHash ?? 0) - (b.slotHash ?? 0) || a.itemHash - b.itemHash ||
    a.name.localeCompare(b.name) || (a.itemInstanceId ?? "").localeCompare(b.itemInstanceId ?? "");
  const available = items.filter((x) => !x.selectedInBuild).sort(order);
  const included: PlanningGearOption[] = [];
  const ids = new Set<string>();
  const slots = new Map<string, number>();
  const add = (item: PlanningGearOption, limit: number): void => {
    const key = `${item.category}:${item.slotHash ?? "unknown"}`;
    const instance = item.itemInstanceId ?? `selected:${key}:${item.itemHash}`;
    if (ids.has(instance) || (slots.get(key) ?? 0) >= limit || included.length >= MAX_GEAR) return;
    ids.add(instance);
    included.push(item);
    slots.set(key, (slots.get(key) ?? 0) + 1);
  };

  // Never discard baseline items merely to make room for recommendations.
  for (const item of items.filter((x) => x.selectedInBuild).sort(order)) add(item, MAX_GEAR);
  const relevantVerified = available.filter((x) => x.detailCoverage === "verified" && relevance(x, terms) > 0);
  const observedExotics = available.filter((x) => x.category === "armor" &&
    x.armorMetadata?.exotic === true && x.detailCoverage === "verified");
  const otherVerified = available.filter((x) => x.detailCoverage === "verified");
  const unidentifiedExotics = available.filter((x) => x.category === "armor" &&
    x.armorMetadata?.exotic === true && x.detailCoverage !== "verified");
  // Two per slot first, so an interesting pair of gloves cannot crowd out all weapons.
  for (const group of [relevantVerified, observedExotics, otherVerified, unidentifiedExotics]) {
    for (const item of group) add(item, 2);
  }
  for (const group of [relevantVerified, observedExotics, otherVerified, unidentifiedExotics, available]) {
    for (const item of group) add(item, 4);
  }
  return included;
}

/** Prioritize the parts of each selected roll that match the goal; preserve intrinsic evidence. */
function choosePerks(item: PlanningGearOption, terms: readonly string[]) {
  return [...item.perks].sort((a, b) =>
    perkRelevance(b, terms) - perkRelevance(a, terms) ||
    Number(b.origin === "intrinsic") - Number(a.origin === "intrinsic") ||
    a.plugHash - b.plugHash).slice(0, MAX_PERKS);
}

/** Match explicit elements and observed subclass names, not generic combat words. */
function requestedSubclassElements(
  goal: string,
  subclasses: UniversalPlanningContext["subclasses"],
): Set<string> {
  const text = normalizedText(goal);
  const explicitElements: Record<string, RegExp> = {
    Arc: /\barc\b/,
    Solar: /\bsolar\b|\bsolare\b/,
    Void: /\bvoid\b|\bvuoto\b/,
    Stasis: /\bstasis\b|\bstasi\b/,
    Strand: /\bstrand\b|\btela\s+scura\b/,
    Prismatic: /\bprismatic\w*\b|\bprismatico\b/,
  };
  const found = new Set(
    Object.entries(explicitElements)
      .filter(([, expression]) => expression.test(text))
      .map(([element]) => element),
  );
  // Names come from this Guardian's observed subclasses, not a hardcoded
  // keyword list that could confuse weapon names or combat effects with classes.
  for (const subclass of subclasses) {
    const name = normalizedText(subclass.name).trim();
    if (name.length < 4) continue;
    const literal = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const namePattern = new RegExp(`(^|[^a-z0-9])${literal}(?=$|[^a-z0-9])`);
    if (namePattern.test(text)) found.add(subclass.element);
  }
  return found;
}
export function buildBudgetedAiContext(context: UniversalPlanningContext, userGoal: string): AiContextBudgetResult {
  const goal = userGoal.trim();
  if (goal.length < 8 || goal.length > MAX_GOAL) throw new Error("Goal must contain 8 to 600 characters.");
  const terms = goalTerms(goal);
  const selected = chooseGear(context, terms);
  const refs: Record<string, LocalGearIdentity> = {};
  const gear: SharedAiGear[] = selected.map((item, index) => {
    const ref = `g${index}`;
    if (item.itemInstanceId && item.slotHash !== null) refs[ref] = {
      itemInstanceId: item.itemInstanceId, itemHash: item.itemHash, slotHash: item.slotHash,
    };
    return {
      ref, name: clamp(item.name, 62), type: item.category,
      itemHash: item.itemHash, slotHash: item.slotHash ?? 0,
      selected: item.selectedInBuild, verifiedDetail: item.detailCoverage === "verified",
      ...(item.category === "armor" ? {
        exotic: item.armorMetadata?.exotic ?? null,
        ...(item.armorStats ? { stats: item.armorStats.filter((x) => Number.isFinite(x.value) && x.value >= -1000 && x.value <= 1000 && Number.isSafeInteger(x.statHash) && x.statHash >= 0 && x.statHash <= 0xffffffff)
          .slice(0, 6).map((x): [number, number] => [x.statHash, x.value]) } : {}),
      } : {}),
      ...(item.detailCoverage === "verified" ? { perks: choosePerks(item, terms).map((perk) => ({
        hash: perk.plugHash, name: clamp(perk.name, 54), description: clamp(perk.description, 94),
      })) } : {}),
    };
  });

  const requestedElements = requestedSubclassElements(goal, context.subclasses);
  const packet: SharedAiPacket = {
    version: 1,
    purpose: "hypotheses_only_require_live_validation",
    goal,
    guardian: {
      className: clamp(context.guardian.className, 24), activity: context.activity,
      currentSubclass: context.subclasses.find((s) => s.selectedInBuild)?.name
        ? clamp(context.subclasses.find((s) => s.selectedInBuild)!.name, 90) : null,
    },
    coverage: {
      account: context.coverage.account,
      verifiedDetails: context.coverage.itemDetailsVerified,
      totalGear: context.coverage.ownedGearCount,
      unknownDetails: context.coverage.itemDetailsMissing,
    },
    subclasses: [...context.subclasses].sort((a, b) =>
      Number(requestedElements.has(b.element)) - Number(requestedElements.has(a.element)) ||
      Number(b.selectedInBuild) - Number(a.selectedInBuild) || a.name.localeCompare(b.name))
      .slice(0, MAX_SUBCLASSES).map((subclass) => {
        const isRequested = requestedElements.has(subclass.element);
        const isEquipped = subclass.selectedInBuild;
        const include = isEquipped || isRequested;
        // Explicitly requested subclass gets full socket options; equipped subclass
        // gets reduced options only when a different element was requested.
        const preserveOptions = isRequested || !isEquipped || requestedElements.size === 0;
        return {
          hash: subclass.itemHash,
          name: clamp(subclass.name, 44), element: clamp(subclass.element, 20),
          status: subclass.status, selected: subclass.selectedInBuild,
          setupKnown: subclass.setupCoverage !== "unknown", socketsIncluded: include,
          sockets: (include ? subclass.sockets.slice(0, MAX_SOCKETS) : []).map((socket) => ({
            index: socket.socketIndex, type: clamp(socket.slotType, 32),
            options: [...socket.options].sort((a,b) =>
              Number(b.selectedInBuild) - Number(a.selectedInBuild) ||
              Number(b.status === "unlocked" || b.status === "equipped") -
                Number(a.status === "unlocked" || a.status === "equipped") ||
              textMatches(b.description, terms) - textMatches(a.description, terms) ||
              a.plugHash - b.plugHash)
              // Preserve selected choices for requested subclasses; reduce baseline
              // equipped options only when a different element is explicitly requested.
              .slice(0, preserveOptions ? Math.min(3, MAX_CHOICES_PER_SOCKET) : 1)
              .map((option) => ({
                hash: option.plugHash, name: clamp(option.name, 44), selected: option.selectedInBuild,
                status: option.status, description: clamp(option.description, 70),
              })),
          })),
        };
      }),
    gear,
    artifact: {
      name: context.artifact.name ? clamp(context.artifact.name, 58) : null,
      coverage: context.artifact.coverage,
      selectedPerks: context.artifact.selectedPerks.slice(0, 8).map((p) => clamp(p.name, 56)),
    },
    mechanics: context.observedMechanics.mechanics.slice(0, 10).map((m) => ({
      id: clamp(m.id, 60), status: clamp(m.configuration, 28), trigger: clamp(m.trigger, 85),
      effects: m.effects.slice(0, 3).map((x) => clamp(x, 85)),
    })),
    gaps: ["Subset only: omitted gear and socket choices are UNKNOWN, not unavailable.",
      ...context.warnings.slice(0, 4).map((x) => clamp(x, 145))],
  };

  // Strong size ceiling. Preserve selected equipment and the requested subclass.
  // Shed verbose lower-priority ability alternatives before dropping verified gear.
  const serializedSize = () => JSON.stringify(packet).length;
  let truncated = selected.length < context.gearOptions.filter((x) => verifiedItem(x)).length;
  const shrinkOptions = (onlyUnrequested: boolean): boolean => {
    let changed = false;
    for (const subclass of packet.subclasses) {
      if (onlyUnrequested && requestedElements.has(subclass.element)) continue;
      for (const socket of subclass.sockets) {
        // Never remove the selected choice. Preserve one alternative if possible.
        const candidate = [...socket.options].reverse().find((option) => !option.selected);
        if (candidate && socket.options.length > 2) {
          socket.options.splice(socket.options.indexOf(candidate), 1);
          changed = true;
        }
        if (serializedSize() <= MAX_PACKET_CHARS) return changed;
      }
    }
    return changed;
  };
  while (serializedSize() > MAX_PACKET_CHARS && shrinkOptions(true)) truncated = true;
  while (serializedSize() > MAX_PACKET_CHARS && shrinkOptions(false)) truncated = true;
  // Selected pieces are never removed: they establish what the Guardian is using.
  while (serializedSize() > MAX_PACKET_CHARS && packet.gear.some((g) => !g.selected)) {
    let index = packet.gear.length - 1;
    while (index >= 0 && packet.gear[index].selected) index--;
    const [removed] = packet.gear.splice(index, 1);
    delete refs[removed.ref];
    truncated = true;
  }
  // If necessary keep the socket identities but compress verbose descriptions.
  while (serializedSize() > MAX_PACKET_CHARS && packet.subclasses.some((s) =>
    s.sockets.some((socket) => socket.options.some((option) => option.description.length > 25)))) {
    let changed = false;
    for (const subclass of packet.subclasses) for (const socket of subclass.sockets) {
      for (const option of socket.options) {
        if (option.description.length > 25) {
          option.description = option.description.slice(0, Math.max(25, Math.floor(option.description.length / 2)));
          changed = true;
        }
      }
    }
    if (!changed) break;
    truncated = true;
  }
  while (serializedSize() > MAX_PACKET_CHARS && packet.mechanics.length) {
    packet.mechanics.pop(); truncated = true;
  }
  // If selected items and minimum evidence exceed the ceiling, fail locally.
  const packetChars = serializedSize();
  if (packetChars > MAX_PACKET_CHARS) throw new Error("Selected build context exceeds AI request limit; reduce the scope.");
  const observedEligible = context.gearOptions.filter((g) => verifiedItem(g)).length;
  return {
    packet, privateItemRefs: refs,
    diagnostics: {
      packetChars, gearSent: packet.gear.length, eligibleGearObserved: observedEligible,
      gearOmitted: Math.max(0, observedEligible - packet.gear.length), truncated,
    },
  };
}
