/**
 * Destiny Builder — Engine-B0.5b6 (READ ONLY).
 * Conservative projection of B0.5b1 item.modifierAvailability, optionally
 * cross-referenced with B0.5b5 core shared PlugSet evidence.
 *
 * Selected means currently fitted, NOT re-insertable. liveCanInsert is one live
 * signal, NOT a proof of socket/cost/unlock legality. Manifest-only is catalog
 * evidence, NOT permission. Never returns installabilityVerified: true.
 */
import { ARMOR_3_STAT_IDS } from './armorBaseStatsResolver';
import type { ModifierConfig } from './armorModifierSimulator';

const GENERAL = 'enhancements.v2_general' as const;
const TUNING = 'core.gear_systems.armor_tiering.plugs.tuning.mods' as const;
const BALANCED = 3122197216;
const EMPTY_GENERAL = 1980618587;
const EMPTY_TUNING = 2121121504;
const GENERAL_SOCKET_TYPE = 1718047805;
const TUNING_SOCKET_TYPE = 2581339086;
const STAT_SET = new Set<number>(ARMOR_3_STAT_IDS);
const SOURCES = new Set([
  'selected', 'live_item_reusable', 'manifest_socket_items',
  'manifest_reusable_set', 'manifest_randomized_set',
]);

type Category = typeof GENERAL | typeof TUNING;
export type Availability =
  | 'installed' | 'live_candidate' | 'live_blocked'
  | 'manifest_candidate' | 'unknown';
export type EffectKind =
  | 'direct' | 'balanced_lowest_three' | 'empty_socket'
  | 'unknown_effect';
export type SimulationMode = 'modifier' | 'omit_empty' | 'not_supported';
export type SharedSignalState = 'none' | 'positive' | 'blocked' | 'conflict' | 'incomplete';
export type SharedEvidenceState = 'not_provided' | 'valid' | 'invalid';
/** Static Manifest socket-category rule; never full insertion certification. */
export type SocketWhitelistCheck = 'allowed' | 'excluded' | 'unknown';
export type SocketWhitelistEvidenceState = 'verified' | 'missing' | 'invalid';
export type SharedPlugSource = 'profile_plug_set' | 'character_plug_set';
export interface SharedPlugSignalAssessment {
  state: SharedSignalState;
  /** Bungie definition hashes, NOT player or item instance identifiers. */
  setHashes: number[];
  sources: SharedPlugSource[];
}

export interface ModifierOptionAssessment {
  socketIndex: number;
  plugHash: number;
  name: string | null;
  category: Category | null;
  availability: Availability;
  effectKind: EffectKind;
  simulationMode: SimulationMode;
  /** Only populated when effects have auditable, modeled numerical meaning. */
  simulatorModifier: ModifierConfig | null;
  selected: boolean;
  liveCanInsert: boolean | null;
  liveEnabled: boolean | null;
  /** B0.5c3d: exact live failure indexes, null when not provided. Diagnostic only. */
  liveInsertFailIndexes?: number[] | null;
  liveEnableFailIndexes?: number[] | null;
  /** Manifest plug category hash; whitelist category gate is assessed separately. */
  plugCategoryHash?: number | null;
  /** Manifest-only category compatibility, independent of live availability. */
  socketWhitelistCheck: SocketWhitelistCheck;
  evidenceSources: string[];
  sharedSignal: SharedPlugSignalAssessment;
  /** Manifest numbers only; no global energy budget test is performed. */
  declaredEnergyCost: { energyCost: number | null; energyTypeHash: number | null } | null;
  reasons: string[];
  installabilityVerified: false;
}
export interface ModifierSocketAssessment {
  socketIndex: number;
  category: Category | null;
  selectedPlugHash: number | null;
  liveSocketEnabled: boolean | null;
  liveSocketPresent: boolean;
  liveReusableDataPresent: boolean;
  sharedReferencedSetCount: number;
  sharedMatchedSetCount: number;
  sharedComponentIncomplete: boolean;
  socketWhitelistEvidenceState: SocketWhitelistEvidenceState;
  /** null = missing or invalid evidence, [] = verified allow-all rule. */
  socketWhitelistCategoryHashes: number[] | null;
  options: ModifierOptionAssessment[];
  note: string;
}
export interface ModifierAvailabilityAssessment {
  schemaVersion: 1;
  validEvidence: boolean;
  readOnly: true;
  installabilityVerified: false;
  reason: string;
  sharedEvidenceState: SharedEvidenceState;
  sharedEvidenceReason: string;
  sockets: ModifierSocketAssessment[];
  energyEvidence: { energyCapacity: number | null; energyUsed: number | null; energyTypeHash: number | null } | null;
  summary: Record<Availability, number>;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : null;
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : null;
const bool = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
/** Legacy evidence lacking these indexes is valid; malformed PRESENT evidence is not positive. */
function failIndexes(value: unknown): { values: number[] | null; malformed: boolean } {
  if (value === undefined || value === null) return { values: null, malformed: false };
  if (!Array.isArray(value) || !value.every(x => integer(x, 0, 0xffffffff) !== null) ||
      new Set(value).size !== value.length) return { values: null, malformed: true };
  return { values: [...value] as number[], malformed: false };
}
/** Parse exact socket type Manifest evidence. Legacy inputs remain valid and unknown. */
function parseSocketWhitelist(socket: Rec): {
  state: SocketWhitelistEvidenceState;
  categoryHashes: number[] | null;
  reason: string;
} {
  const raw = socket.socketTypeWhitelistEvidence;
  if (raw === undefined || raw === null) return {
    state: 'missing', categoryHashes: null, reason: 'Socket-type whitelist evidence has not been supplied.',
  };
  const evidence = rec(raw);
  const socketTypeHash = integer(socket.socketTypeHash, 1, 0xffffffff);
  if (!evidence || socketTypeHash === null ||
      evidence.source !== 'bungie_manifest_socket_type_definition' ||
      integer(evidence.socketTypeHash, 1, 0xffffffff) !== socketTypeHash ||
      typeof evidence.definitionResolved !== 'boolean' ||
      typeof evidence.malformed !== 'boolean') return {
    state: 'invalid', categoryHashes: null, reason: 'Malformed or mismatched socket-type evidence.',
  };
  if (evidence.malformed) return {
    state: 'invalid', categoryHashes: null, reason: 'Socket-type definition is malformed or redacted.',
  };
  if (evidence.definitionResolved === false) {
    return evidence.plugWhitelistCategoryHashes === null ? {
      state: 'missing', categoryHashes: null, reason: 'Socket-type definition was not resolved.',
    } : {
      state: 'invalid', categoryHashes: null, reason: 'Unresolved definition carries an unsupported whitelist.',
    };
  }
  // A missing whitelist is NOT an explicit empty (allow-all) whitelist.
  const values = evidence.plugWhitelistCategoryHashes;
  if (values === null || values === undefined) return {
    state: 'missing', categoryHashes: null, reason: 'Resolved definition does not include a whitelist.',
  };
  if (!Array.isArray(values) || !values.every(v => integer(v, 1, 0xffffffff) !== null) ||
      new Set(values).size !== values.length) return {
    state: 'invalid', categoryHashes: null, reason: 'Invalid or duplicate whitelist categories.',
  };
  return { state: 'verified', categoryHashes: [...values] as number[],
    reason: 'Manifest socket-type category whitelist parsed; other insertion constraints remain unknown.' };
}

function checkWhitelist(whitelist: ReturnType<typeof parseSocketWhitelist>, plugCategoryHash: number | null): SocketWhitelistCheck {
  if (whitelist.state !== 'verified' || whitelist.categoryHashes === null) return 'unknown';
  // Empty in a resolved Bungie definition explicitly permits any plug category.
  if (whitelist.categoryHashes.length === 0) return 'allowed';
  if (plugCategoryHash === null) return 'unknown';
  return whitelist.categoryHashes.includes(plugCategoryHash) ? 'allowed' : 'excluded';
}

const name = (v: unknown): string | null => typeof v === 'string' ? v : null;
const category = (v: unknown): Category | null => v === GENERAL || v === TUNING ? v : null;
const emptySummary = (): ModifierAvailabilityAssessment['summary'] => ({
  installed: 0, live_candidate: 0, live_blocked: 0,
  manifest_candidate: 0, unknown: 0,
});

/** Scope=core is for the REQUESTED Guardian, not necessarily the armor owner.
 * Every positive result here is merely a live candidate; no energy, unlock,
 * full socket-rule or owner validation is performed.
 */
type SharedPlug = { plugHash: number; canInsert: boolean | null; enabled: boolean | null };
type SharedSet = {
  setHash: number;
  profileSetPresent: boolean;
  characterSetPresent: boolean;
  profilePlugs: SharedPlug[];
  characterPlugs: SharedPlug[];
};
type SharedEvidence = {
  profileComponentPresent: boolean;
  characterComponentPresent: boolean;
  sets: Map<number, SharedSet>;
};
type SharedSocket = {
  referencedSetCount: number;
  matchedSetCount: number;
  componentIncomplete: boolean;
  signals: Map<number, { source: SharedPlugSource; setHash: number; canInsert: boolean | null; enabled: boolean | null }[]>;
};

function parseSharedEvidence(input: unknown): SharedEvidence | null {
  const raw = rec(input);
  if (!raw || raw.schemaVersion !== 1 ||
      raw.source !== 'bungie_profile_item_sockets_shared_plug_sets' ||
      raw.readOnly !== true || raw.scopedToRequestedGuardian !== true ||
      raw.installabilityVerified !== false ||
      bool(raw.profileComponentPresent) === null ||
      bool(raw.characterComponentPresent) === null || !Array.isArray(raw.sets)) return null;
  const sets = new Map<number, SharedSet>();
  for (const entry of raw.sets) {
    const set = rec(entry);
    const setHash = integer(set?.setHash, 1, 0xffffffff);
    if (setHash === null || sets.has(setHash) ||
        bool(set?.profileSetPresent) === null || bool(set?.characterSetPresent) === null ||
        !Array.isArray(set?.profilePlugs) || !Array.isArray(set?.characterPlugs)) return null;
    const parsePlugs = (values: unknown[]): SharedPlug[] | null => {
      const plugs: SharedPlug[] = [];
      for (const entry of values) {
        const plug = rec(entry);
        const plugHash = integer(plug?.plugHash, 1, 0xffffffff);
        if (plugHash === null || (plug?.canInsert !== null && bool(plug?.canInsert) === null) ||
            (plug?.enabled !== null && bool(plug?.enabled) === null)) return null;
        plugs.push({ plugHash, canInsert: bool(plug?.canInsert), enabled: bool(plug?.enabled) });
      }
      return plugs;
    };
    const profilePlugs = parsePlugs(set!.profilePlugs as unknown[]);
    const characterPlugs = parsePlugs(set!.characterPlugs as unknown[]);
    if (!profilePlugs || !characterPlugs ||
        (set!.profileSetPresent !== true && profilePlugs.length > 0) ||
        (set!.characterSetPresent !== true && characterPlugs.length > 0)) return null;
    sets.set(setHash, {
      setHash, profileSetPresent: set!.profileSetPresent as boolean,
      characterSetPresent: set!.characterSetPresent as boolean,
      profilePlugs, characterPlugs,
    });
  }
  return {
    profileComponentPresent: raw.profileComponentPresent as boolean,
    characterComponentPresent: raw.characterComponentPresent as boolean,
    sets,
  };
}

function sharedSocketEvidence(socket: Rec, shared: SharedEvidence | null): SharedSocket {
  const result: SharedSocket = {
    referencedSetCount: 0, matchedSetCount: 0, componentIncomplete: false,
    signals: new Map(),
  };
  if (!shared) return result;
  const flags = integer(socket.plugSources, 0, 0xffffffff);
  const socketType = integer(socket.socketTypeHash, 1, 0xffffffff);
  // Only the two audited Armor 3.0 socket types may consume these signals.
  if (flags === null || (flags & ~15) !== 0 || (flags & 12) === 0 ||
      (socketType !== GENERAL_SOCKET_TYPE && socketType !== TUNING_SOCKET_TYPE)) return result;
  const references = [...new Set([
    integer(socket.reusablePlugSetHash, 1, 0xffffffff),
    integer(socket.randomizedPlugSetHash, 1, 0xffffffff),
  ].filter((h): h is number => h !== null))];
  result.referencedSetCount = references.length;
  result.componentIncomplete = ((flags & 4) !== 0 && !shared.profileComponentPresent) ||
    ((flags & 8) !== 0 && !shared.characterComponentPresent);
  for (const hash of references) {
    const set = shared.sets.get(hash);
    if (!set) { result.componentIncomplete = true; continue; }
    result.matchedSetCount++;
    for (const [flag, present, source, plugs] of [
      [4, set.profileSetPresent, 'profile_plug_set', set.profilePlugs],
      [8, set.characterSetPresent, 'character_plug_set', set.characterPlugs],
    ] as const) {
      if (!(flags & flag)) continue;
      // A missing set in a required scope is missing evidence, not a denial.
      if (!present) { result.componentIncomplete = true; continue; }
      for (const plug of plugs) {
        const hits = result.signals.get(plug.plugHash) ?? [];
        hits.push({ source, setHash: hash, canInsert: plug.canInsert, enabled: plug.enabled });
        result.signals.set(plug.plugHash, hits);
      }
    }
  }
  if (references.length === 0) result.componentIncomplete = true;
  return result;
}

function assessSharedSignal(shared: SharedSocket, plugHash: number): SharedPlugSignalAssessment {
  const signals = shared.signals.get(plugHash) ?? [];
  const info: SharedPlugSignalAssessment = {
    state: 'none',
    setHashes: [...new Set(signals.map(s => s.setHash))].sort((a,b) => a-b),
    sources: [...new Set(signals.map(s => s.source))],
  };
  if (!signals.length) return info;
  if (shared.componentIncomplete) { info.state = 'incomplete'; return info; }
  const positive = signals.some(s => s.canInsert === true && s.enabled === true);
  const negative = signals.some(s => s.canInsert === false || s.enabled === false);
  if (positive && negative) info.state = 'conflict';
  else if (negative) info.state = 'blocked';
  else if (signals.every(s => s.canInsert === true && s.enabled === true)) info.state = 'positive';
  else info.state = 'incomplete';
  return info;
}

function modelEffect(option: Rec, hash: number, cat: Category | null): {
  kind: EffectKind; mode: SimulationMode;
  config: ModifierConfig | null; reason: string;
} {
  if (!cat) return {kind:'unknown_effect',mode:'not_supported',config:null,reason:'Unrecognized or missing modifier category.'};
  if (option.plugDefinitionResolved !== true) {
    return {kind:'unknown_effect',mode:'not_supported',config:null,reason:'Plug definition not resolved.'};
  }
  const effects = option.declaredInvestmentStats;
  if (!Array.isArray(effects)) {
    return {kind:'unknown_effect',mode:'not_supported',config:null,reason:'Investment-stat evidence missing.'};
  }
  if (hash === EMPTY_GENERAL && cat === GENERAL || hash === EMPTY_TUNING && cat === TUNING) {
    if (effects.length !== 0) {
      return {kind:'unknown_effect',mode:'not_supported',config:null,reason:'Empty-socket plug unexpectedly has stat contributions.'};
    }
    return {kind:'empty_socket',mode:'omit_empty',config:null,reason:'Known empty socket: omit modifier during math-only simulation.'};
  }
  if (hash === BALANCED && cat === TUNING) {
    if (effects.length !== STAT_SET.size) {
      return {kind:'unknown_effect',mode:'not_supported',config:null,reason:'Balanced Tuning must declare all six conditional +1 effects.'};
    }
    const seen = new Set<number>();
    for (const entry of effects) {
      const e = rec(entry);
      const s = integer(e?.statHash, 1, 0xffffffff);
      if (!s || !STAT_SET.has(s) || seen.has(s) || e?.value !== 1 || e?.isConditionallyActive !== true) {
        return {kind:'unknown_effect',mode:'not_supported',config:null,reason:'Balanced Tuning has malformed Manifest conditional effects.'};
      }
      seen.add(s);
    }
    return {kind:'balanced_lowest_three',mode:'modifier',reason:'Balanced rule is mathematically modeled; ties remain conservative.',
      config: {
        plugHash:hash, name:name(option.name)??'', category:cat,
        rule:'balanced_lowest_three', hasConditionalEffects:true,
        contributions: effects.map((entry) => {
          const e=rec(entry)!;
          return {statHash:e.statHash as number, name:'', value:1, isConditionallyActive:true};
        }),
      }};
  }
  if (hash === BALANCED) return {kind:'unknown_effect',mode:'not_supported',config:null,reason:'Balanced hash reported in an unexpected category.'};
  if (!effects.length) return {kind:'unknown_effect',mode:'not_supported',config:null,reason:'No declared stat effects; unknown plug is not assumed to be an empty socket.'};
  const seen = new Set<number>();
  const contributions: ModifierConfig['contributions'] = [];
  for (const entry of effects) {
    const e = rec(entry);
    const s = integer(e?.statHash, 1, 0xffffffff);
    const v = e?.value;
    if (!s || !STAT_SET.has(s) || seen.has(s) || typeof v !== 'number' || !Number.isSafeInteger(v) || e?.isConditionallyActive !== false) {
      return {kind:'unknown_effect',mode:'not_supported',config:null,reason:'Direct plug effects are duplicate, unknown, conditional or invalid.'};
    }
    seen.add(s);
    contributions.push({statHash:s, name:'', value:v, isConditionallyActive:false});
  }
  if (contributions.every(c => c.value === 0)) {
    return {kind:'unknown_effect',mode:'not_supported',config:null,reason:'Only zero effects declared; not assumed a usable stat mod.'};
  }
  return {kind:'direct',mode:'modifier',reason:'Unconditional Armor 3.0 investmentStats can be simulated mathematically.',
    config:{plugHash:hash,name:name(option.name)??'',category:cat,contributions,hasConditionalEffects:false}};
}

/** Project a complete API evidence object, never a truncated report sample. */
export function assessArmorModifierAvailability(input: unknown, sharedInput?: unknown): ModifierAvailabilityAssessment {
  const out: ModifierAvailabilityAssessment = {
    schemaVersion:1, validEvidence:false, readOnly:true, installabilityVerified:false,
    reason:'', sharedEvidenceState:'not_provided', sharedEvidenceReason:'No shared evidence supplied.',
    sockets:[], energyEvidence:null, summary:emptySummary(),
  };
  const data = rec(input);
  if (!data || data.schemaVersion !== 1 ||
      data.source !== 'bungie_item_detail_live_reusable_plus_manifest' ||
      data.readOnly !== true || data.installabilityVerified !== false ||
      !Array.isArray(data.sockets)) {
    out.reason='Missing or invalid B0.5b1 modifier-availability evidence.';
    return out;
  }
  const manifestCount=integer(data.socketCountFromManifest,0,1000);
  const liveCount=integer(data.socketCountFromLive,0,1000);
  if (manifestCount===null || liveCount===null || manifestCount!==liveCount) {
    out.reason='Incomplete/mismatched Manifest and live socket counts.';
    return out;
  }
  const shared = sharedInput === undefined || sharedInput === null ? null : parseSharedEvidence(sharedInput);
  if (sharedInput !== undefined && sharedInput !== null) {
    out.sharedEvidenceState = shared ? 'valid' : 'invalid';
    out.sharedEvidenceReason = shared
      ? 'Shared PlugSet input parsed; requested Guardian and installation constraints are NOT verified.'
      : 'Invalid shared PlugSet input; ignored without upgrading item-only candidates.';
  }
  const energy=rec(data.itemEnergyEvidence);
  if (energy) out.energyEvidence = {
    energyCapacity:integer(energy.energyCapacity),
    energyUsed:integer(energy.energyUsed),
    energyTypeHash:integer(energy.energyTypeHash,1,0xffffffff),
  };
  const seenSockets=new Set<number>();
  for (const rawSocket of data.sockets) {
    const socket=rec(rawSocket);
    const index=integer(socket?.socketIndex,0,manifestCount ? manifestCount-1 : -1);
    if (!socket || index===null || seenSockets.has(index) || !Array.isArray(socket.options)) {
      out.reason='Duplicate, invalid or out-of-range socket evidence.';
      out.sockets=[];out.summary=emptySummary();return out;
    }
    seenSockets.add(index);
    const enabled=bool(socket.liveSocketEnabled);
    const liveSocketPresent=socket.liveSocketPresent===true;
    const selectedHash=integer(socket.selectedPlugHash,1,0xffffffff);
    const livePresent=socket.liveReusableDataPresent===true;
    const sharedSocket = sharedSocketEvidence(socket, shared);
    const whitelist = parseSocketWhitelist(socket);
    const derivedCategory=new Set<Category>();
    for (const rawOpt of socket.options) {
      const c=category(rec(rawOpt)?.plugCategoryIdentifier);
      if (c) derivedCategory.add(c);
    }
    const socketCategory=derivedCategory.size===1 ? [...derivedCategory][0] : null;
    const options: ModifierOptionAssessment[]=[];
    const seenOptions=new Set<number>();
    for (const rawOpt of socket.options) {
      const o=rec(rawOpt);
      const plug=integer(o?.plugHash,1,0xffffffff);
      if (!o || plug===null || seenOptions.has(plug)) {
        out.reason='Duplicate/invalid option hash in socket.';
        out.sockets=[];out.summary=emptySummary();return out;
      }
      seenOptions.add(plug);
      const sources=Array.isArray(o.sources) && o.sources.every((s)=>typeof s==='string' && SOURCES.has(s))
        ? [...new Set(o.sources as string[])] : [];
      const selected=o.selected===true;
      const reportedState=name(o.evidenceState);
      const liveCan=bool(o.liveCanInsert);
      const liveEnabled=bool(o.liveEnabled);
      const liveSource=sources.includes('live_item_reusable');
      const insertionFailures = failIndexes(o.liveInsertFailIndexes);
      const enableFailures = failIndexes(o.liveEnableFailIndexes);
      const contradictoryFailureEvidence = o.liveFailIndexEvidenceMalformed === true ||
        insertionFailures.malformed || enableFailures.malformed ||
        (insertionFailures.values !== null && insertionFailures.values.length > 0 && liveCan === true) ||
        (enableFailures.values !== null && enableFailures.values.length > 0 && liveEnabled === true) ||
        (!liveSource && (insertionFailures.values !== null || enableFailures.values !== null));
      const optionCategory=category(o.plugCategoryIdentifier);
      const sharedSignal = assessSharedSignal(sharedSocket, plug);
      const reasons:string[]=[];
      let availability:Availability='unknown';
      const plugCategoryHash = integer(o.plugCategoryHash, 1, 0xffffffff);
      const socketWhitelistCheck = checkWhitelist(whitelist, plugCategoryHash);
      const consistentSelected=selected === (selectedHash===plug) && selected === sources.includes('selected');
      const invalidLocal = !consistentSelected || !sources.length ||
        (optionCategory && optionCategory!==socketCategory) || !socketCategory || !optionCategory;
      const itemPositive = liveSource && livePresent && liveSocketPresent && enabled===true &&
        liveCan===true && liveEnabled===true && reportedState==='live_can_insert';
      const itemNegative = liveSource && (liveCan===false || liveEnabled===false);
      const sharedPositive = sharedSignal.state === 'positive';
      const sharedNegative = sharedSignal.state === 'blocked';
      const hasShared = sharedSignal.state !== 'none';
      const manifestOnly = !liveSource && !selected && reportedState==='manifest_only' &&
        liveCan===null && liveEnabled===null;
      const expectedType = optionCategory === GENERAL ? GENERAL_SOCKET_TYPE : TUNING_SOCKET_TYPE;
      const sharedSocketTypeMatches = integer(socket.socketTypeHash, 1, 0xffffffff) === expectedType;
      if (invalidLocal) {
        reasons.push('Selected/source/category evidence is incomplete or inconsistent.');
      } else if (selected && reportedState==='selected') {
        availability='installed';
        reasons.push('Plug is already selected. Re-insertion and alternative compatibility are unverified.');
      } else if (contradictoryFailureEvidence) {
        reasons.push('Malformed or contradictory per-item live insertion/enable failure indexes; cannot promote candidate.');
      } else if (sharedSignal.state==='conflict' || (itemPositive && sharedNegative) ||
                 (itemNegative && sharedPositive)) {
        reasons.push('Contradictory item/shared live signals: cannot claim availability or insertion denial.');
      } else if (enabled===false || (itemNegative && !sharedPositive) ||
                 (sharedNegative && !itemPositive && liveSocketPresent && enabled===true && sharedSocketTypeMatches)) {
        availability='live_blocked';
        reasons.push('Socket or live insertion flag reports an explicit restriction.');
      } else if (itemPositive) {
        availability='live_candidate';
        reasons.push('Live per-item canInsert/enabled signals present; complete installation still unverified.');
      } else if (sharedPositive && manifestOnly && sharedSocketTypeMatches && liveSocketPresent && enabled===true) {
        availability='live_candidate';
        reasons.push('Matching requested-Guardian Profile/Character PlugSet has positive live signals; item ownership, energy, socket legality and unlocks remain unverified.');
      } else if (hasShared && sharedPositive && !liveSocketPresent) {
        reasons.push('Shared positive signal cannot validate an absent live item socket.');
      } else if (manifestOnly && sharedSignal.state==='incomplete') {
        reasons.push('Partial shared evidence: no live availability inference.');
      } else if (manifestOnly) {
        availability='manifest_candidate';
        reasons.push('Catalog-only option; no sufficient matching live evidence for this item.');
      } else {
        reasons.push('Partial, contradictory or unknown live insertion evidence.');
      }
      // An excluded Manifest category contradicts live-candidate evidence.
      // This is *not* a new Bungie live denial; avoid labelling it live_blocked.
      if (socketWhitelistCheck === 'excluded') {
        reasons.push('Manifest socket-type whitelist excludes this plug category; no whole-installability decision.');
        if (availability === 'live_candidate') {
          availability = 'unknown';
          reasons.push('Contradictory live candidate and Manifest category exclusion.');
        }
      } else if (socketWhitelistCheck === 'allowed') {
        reasons.push('Plug category is permitted by Manifest whitelist only; all other conditions remain unverified.');
      } else {
        reasons.push(whitelist.reason);
      }
      if (hasShared) {
        reasons.push('Shared PlugSet scope is the requested Guardian, not proof of the armor owner or full legal configuration.');
      }
      const effect=modelEffect(o,plug,optionCategory);
      reasons.push(effect.reason);
      const rawEnergy=rec(o.declaredEnergyCost);
      const declaredEnergyCost=rawEnergy ? {
        energyCost:integer(rawEnergy.energyCost),
        energyTypeHash:integer(rawEnergy.energyTypeHash,1,0xffffffff),
      } : null;
      options.push({socketIndex:index,plugHash:plug,name:name(o.name),category:optionCategory,
        availability,effectKind:effect.kind,simulationMode:effect.mode,
        simulatorModifier:effect.config,selected,liveCanInsert:liveCan,liveEnabled,
        liveInsertFailIndexes: insertionFailures.values,
        liveEnableFailIndexes: enableFailures.values,
        plugCategoryHash, socketWhitelistCheck,
        evidenceSources:[...sources, ...sharedSignal.sources.map(s => `live_${s}`)],
        sharedSignal,declaredEnergyCost,reasons,installabilityVerified:false});
      out.summary[availability]++;
    }
    if (selectedHash !== null && !seenOptions.has(selectedHash)) {
      out.reason="Selected plug is missing from the socket option evidence.";
      out.sockets=[];out.summary=emptySummary();return out;
    }
    out.sockets.push({socketIndex:index,category:socketCategory,selectedPlugHash:selectedHash,
      liveSocketEnabled:enabled,liveSocketPresent,liveReusableDataPresent:livePresent,
      sharedReferencedSetCount:sharedSocket.referencedSetCount,
      sharedMatchedSetCount:sharedSocket.matchedSetCount,
      sharedComponentIncomplete:sharedSocket.componentIncomplete,
      socketWhitelistEvidenceState:whitelist.state,
      socketWhitelistCategoryHashes:whitelist.categoryHashes,
      options,note:sharedSocket.matchedSetCount ?
        'Matching shared PlugSets are live clues for the requested Guardian, not installation proof.' :
        livePresent ? 'Live reusable options available only as per-option evidence.' :
        'No matched shared or item-reusable live option: Manifest candidates are NOT approved.'});
  }
  out.validEvidence=true;
  out.reason='Evidence parsed. Math readiness and live insertion signals are NOT installation certification.';
  return out;
}
