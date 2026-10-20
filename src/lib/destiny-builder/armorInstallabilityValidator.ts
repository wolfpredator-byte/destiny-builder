/**
 * Destiny Builder — Engine-B0.5c1: Conservative Armor 3.0 Installability Preflight
 *
 * Read-only, deterministic preflight for a single Armor 3.0 modifier swap.
 * This module NEVER claims certified installability. It provides separated
 * availability, energy, ownership, socket, tier, and unlock checks based on
 * available evidence only. Missing or inconsistent evidence results in unknown,
 * never passed.
 *
 * No Bungie/OpenAI calls, no writes, no inference from absent data.
 */

import type { ModifierAvailabilityAssessment, ModifierOptionAssessment } from './armorModifierAvailability';
import type { ModifierConfig } from './armorModifierSimulator';

export interface ItemInstanceEvidence {
  /** The requested Guardian's membership/character ID. NOT an instance ID. */
  requestedGuardianId: string | null;
  /** The owner of this item, if known. null = Vault or unknown. */
  ownerCharacterId: string | null;
  /** Current location: 'equipped', 'inventory', 'vault', or unknown. */
  location: 'equipped' | 'inventory' | 'vault' | 'unknown';
  /** Masterwork tier 0-10, if known. null = unknown. */
  masterworkTier: number | null;
  /** Masterwork energy type hash, if known. null = unknown. */
  masterworkEnergyTypeHash: number | null;
}

export interface CurrentEnergyEvidence {
  energyCapacity: number | null;
  energyUsed: number | null;
  energyTypeHash: number | null;
}

export interface ProposedSwap {
  socketIndex: number;
  newPlugHash: number;
  oldPlugHash: number | null;
}

export interface EnergyBalanceCheck {
  passed: boolean;
  blocked: boolean;
  unknown: boolean;
  reason: string;
  /** Populated when a consistent, safe energy calculation completes, including a capacity block. */
  newEnergyUsed: number | null;
  /** May be negative when capacity is insufficient. */
  energyRemaining: number | null;
  /** True only when the calculated required energy exceeds capacity. */
  overflow: boolean;
}

export interface OwnershipCheck {
  passed: boolean;
  blocked: boolean;
  unknown: boolean;
  reason: string;
}

export interface SocketRestrictionCheck {
  passed: boolean;
  blocked: boolean;
  unknown: boolean;
  reason: string;
}

export interface TierRequirementCheck {
  passed: boolean;
  blocked: boolean;
  unknown: boolean;
  reason: string;
}

export interface UnlockRequirementCheck {
  passed: boolean;
  blocked: boolean;
  unknown: boolean;
  reason: string;
}

export interface EnergyTypeCompatibilityCheck {
  passed: boolean;
  blocked: boolean;
  unknown: boolean;
  reason: string;
}

export interface InstallabilityPreflightResult {
  schemaVersion: 1;
  installabilityVerified: false;
  overallInstallable: false; // Never true in B0.5c1
  availabilityCheck: { passed: boolean; blocked: boolean; unknown: boolean; reason: string };
  energyBalance: EnergyBalanceCheck;
  ownership: OwnershipCheck;
  socketRestrictions: SocketRestrictionCheck;
  tierRequirements: TierRequirementCheck;
  unlockRequirements: UnlockRequirementCheck;
  energyTypeCompatibility: EnergyTypeCompatibilityCheck;
  reasons: string[];
}

function safeInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function isHash(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
}

/**
 * Conservative energy balance calculation.
 * Only calculates when:
 * - energyCapacity, energyUsed are valid safe integers and match item evidence
 * - oldPlugHash matches the selected plug in the socket
 * - new plug has a declared energy cost
 * - No overflow in arithmetic
 *
 * Returns unknown if any required data is missing or inconsistent.
 */
function calculateEnergyBalance(
  currentEnergy: CurrentEnergyEvidence,
  proposedSwap: ProposedSwap,
  availabilityAssessment: ModifierAvailabilityAssessment,
  oldPlugCost: number | null,
  newPlugCost: number | null
): EnergyBalanceCheck {
  const result: EnergyBalanceCheck = {
    passed: false,
    blocked: false,
    unknown: true,
    reason: 'Energy balance cannot be determined: required evidence missing or inconsistent.',
    newEnergyUsed: null,
    energyRemaining: null,
    overflow: false,
  };

  // Validate current energy evidence
  // Do not invent a fixed 10-point ceiling: live Armor 3.0 evidence has shown capacity 11.
  // This verifies arithmetic coherence only; the game's installation rules remain unknown.
  const capacity = safeInteger(currentEnergy.energyCapacity, 0);
  const used = safeInteger(currentEnergy.energyUsed, 0);
  if (capacity === null || used === null || used > capacity) {
    result.reason = 'Current energy capacity or used is missing, invalid, or inconsistent.';
    return result;
  }

  // Validate old plug matches selected
  const socket = availabilityAssessment.sockets.find(s => s.socketIndex === proposedSwap.socketIndex);
  if (!socket) {
    result.reason = 'Socket not found in availability assessment.';
    return result;
  }
  // The absence of oldPlugHash must also agree with an actually empty selected socket.
  // Otherwise subtracting zero silently ignores an installed modifier.
  if (socket.selectedPlugHash !== proposedSwap.oldPlugHash) {
    result.reason = 'Old plug hash does not match the selected plug in the socket.';
    return result;
  }

  // Engine-B0.5c3a: values supplied by a caller are not independent proof.
  // Require that the current snapshot and the option definitions agree with them.
  const observed = availabilityAssessment.energyEvidence;
  const observedCapacity = safeInteger(observed?.energyCapacity);
  const observedUsed = safeInteger(observed?.energyUsed);
  // Engine-B0.5c3c — Energy Semantics Guard.
  // instance.energy.energyTypeHash is optional/legacy-facing evidence; it does
  // not encode a proven Armor 3.0 elemental insertion rule. Arithmetic depends
  // on the *numeric* capacity and used values, not the affinity/hash field.
  // A conflicting or absent type hash is NOT an energy-capacity contradiction.
  // Energy affinity/socket legality is assessed separately and remains unknown.
  if (observedCapacity === null || observedUsed === null ||
      observedCapacity !== capacity || observedUsed !== used) {
    result.reason = 'Caller energy capacity/used are missing or disagree with Bungie item energy evidence.';
    return result;
  }

  const proposedOption = socket.options.find(o => o.plugHash === proposedSwap.newPlugHash);
  if (!proposedOption) {
    result.reason = 'Proposed plug is missing from the assessed socket evidence.';
    return result;
  }
  const oldOption = proposedSwap.oldPlugHash === null ? null :
    socket.options.find(o => o.plugHash === proposedSwap.oldPlugHash);
  if (proposedSwap.oldPlugHash !== null &&
      (!oldOption || !oldOption.selected || oldOption.availability !== 'installed')) {
    result.reason = 'Old plug lacks consistent selected-option evidence.';
    return result;
  }
  if (proposedSwap.oldPlugHash === null && socket.options.some(o => o.selected)) {
    result.reason = 'Selected plug evidence contradicts an empty old socket.';
    return result;
  }

  // Validate plug costs
  if (oldPlugCost === null && proposedSwap.oldPlugHash !== null) {
    result.reason = 'Old plug cost is missing (plug selected but cost unknown).';
    return result;
  }
  if (newPlugCost === null) {
    result.reason = 'New plug cost is missing.';
    return result;
  }
  // Zero-cost plugs are valid. A null return, not a falsy number, indicates invalid data.
  if (safeInteger(newPlugCost, 0, 10) === null ||
      (oldPlugCost !== null && safeInteger(oldPlugCost, 0, 10) === null)) {
    result.reason = 'Plug costs are invalid (not safe integers or out of range).';
    return result;
  }

  // The declared values are static Manifest evidence: they can support a
  // mathematical cross-check, never Bungie installation certification.
  const declaredNewCost = safeInteger(proposedOption.declaredEnergyCost?.energyCost, 0, 10);
  if (declaredNewCost === null || declaredNewCost !== newPlugCost) {
    result.reason = 'New plug cost is missing or disagrees with the declared Manifest cost.';
    return result;
  }
  if (proposedSwap.oldPlugHash !== null) {
    const declaredOldCost = safeInteger(oldOption?.declaredEnergyCost?.energyCost, 0, 10);
    if (declaredOldCost === null || declaredOldCost !== oldPlugCost) {
      result.reason = 'Old plug cost is missing or disagrees with the selected Manifest cost.';
      return result;
    }
  }

  // Calculate new energy used
  const oldCost = proposedSwap.oldPlugHash !== null ? oldPlugCost ?? 0 : 0;
  const newCost = newPlugCost;
  const newUsed = used - oldCost + newCost;

  // Check for arithmetic overflow
  if (!Number.isSafeInteger(newUsed)) {
    result.reason = 'Energy balance calculation overflowed.';
    return result;
  }

  // Check for negative energy used
  if (newUsed < 0) {
    result.reason = 'Energy balance calculation resulted in negative energy used.';
    return result;
  }

  // Check for overflow
  const overflow = newUsed > capacity;
  const remaining = capacity - newUsed;

  result.passed = !overflow;
  result.blocked = overflow;
  result.unknown = false;
  result.reason = overflow
    ? 'Proposed swap exceeds observed energy capacity (arithmetic only; installation rules unverified).'
    : 'Energy arithmetic is within observed capacity; affinity and installation rules remain unverified.';
  result.newEnergyUsed = newUsed;
  result.energyRemaining = remaining;
  result.overflow = overflow;

  return result;
}

/**
 * Ownership check based on requested Guardian vs item owner.
 * - If item is equipped/inventory on requested Guardian: passed
 * - If item is in Vault: unknown (may be transferable, but requires actual transfer)
 * - If item is owned by different Guardian: blocked
 * - If ownership unknown: unknown
 */
function checkOwnership(
  itemInstance: ItemInstanceEvidence
): OwnershipCheck {
  const result: OwnershipCheck = {
    passed: false,
    blocked: false,
    unknown: true,
    reason: 'Ownership cannot be determined: item owner or location unknown.',
  };

  // Vault location cannot establish direct Guardian ownership even if the
  // ownership field is stale or unexpectedly populated.
  if (itemInstance.location === 'vault') {
    result.reason = 'Item is in Vault: transferability depends on actual transfer rules, not just ownership.';
    return result;
  }

  // A matching character ID alone does not establish a confirmed location.
  // Vault is already handled separately above; unknown positions stay unknown.
  if (itemInstance.location !== 'equipped' && itemInstance.location !== 'inventory') {
    result.reason = 'Item position is unknown; direct Guardian ownership is not confirmed.';
    return result;
  }

  if (itemInstance.requestedGuardianId === null) {
    result.reason = 'Requested Guardian ID is missing.';
    return result;
  }

  if (itemInstance.ownerCharacterId === null) {
    result.reason = 'Item owner is unknown (may be Vault or unknown location).';
    return result;
  }

  if (itemInstance.ownerCharacterId === itemInstance.requestedGuardianId) {
    result.passed = true;
    result.unknown = false;
    result.reason = 'Item is owned by the requested Guardian.';
    return result;
  }

  result.blocked = true;
  result.unknown = false;
  result.reason = 'Item is owned by a different Guardian.';
  return result;
}

/**
 * Socket restriction check.
 * Uses availability assessment to determine if the new plug is:
 * - installed (cannot re-install without verification)
 * - live_candidate (may be installable, but not certified)
 * - live_blocked (explicitly blocked)
 * - manifest_candidate (catalog only, no live evidence)
 * - unknown (insufficient evidence)
 *
 * A live candidate and Manifest whitelist match are INDEPENDENT PARTIAL signals:
 * they do not establish plug insertion rules, objectives, material requirements,
 * upgrade/tier gates, or socket state for the proposed swap. Never mark the
 * complete socket-restriction gate passed from those partial signals alone.
 */
function checkSocketRestrictions(
  proposedSwap: ProposedSwap,
  availabilityAssessment: ModifierAvailabilityAssessment
): SocketRestrictionCheck {
  const result: SocketRestrictionCheck = {
    passed: false,
    blocked: false,
    unknown: true,
    reason: 'Socket restrictions cannot be determined: availability evidence missing or inconsistent.',
  };

  const socket = availabilityAssessment.sockets.find(s => s.socketIndex === proposedSwap.socketIndex);
  if (!socket) {
    result.reason = 'Socket not found in availability assessment.';
    return result;
  }

  const option = socket.options.find(o => o.plugHash === proposedSwap.newPlugHash);
  if (!option) {
    result.reason = 'New plug not found in socket options.';
    return result;
  }

  switch (option.availability) {
    case 'installed':
      // Already equipped is neither permission to re-insert nor a proven illegal swap.
      result.reason = 'Plug is already installed; no new insertion is verified.';
      break;
    case 'live_candidate':
      if (option.socketWhitelistCheck === 'excluded') {
        result.reason = 'Contradiction: live candidate is excluded by Manifest socket category whitelist; socket legality is unknown.';
      } else if (option.socketWhitelistCheck === 'allowed') {
        result.reason = 'Live candidate and Manifest category are compatible, but insertion rules, objectives, materials and remaining socket restrictions are unverified.';
      } else {
        result.reason = 'Live candidate without verified socket-category compatibility; insertion rules and other socket restrictions remain unknown.';
      }
      // Deliberately remains tri-state UNKNOWN. Category allow != plug install.
      break;
    case 'live_blocked':
      result.blocked = true;
      result.unknown = false;
      result.reason = 'Plug is explicitly blocked by live signals (canInsert=false or enabled=false).';
      break;
    case 'manifest_candidate':
      result.reason = 'Plug is catalog-only; no sufficient live evidence for this item.';
      break;
    case 'unknown':
      result.reason = 'Plug availability is unknown (insufficient or contradictory evidence).';
      break;
  }

  return result;
}

/**
 * Tier requirement check.
 * Currently, the system does not have reliable tier requirements data.
 * This check will always return unknown unless explicit tier evidence is added.
 */
function checkTierRequirements(
  itemInstance: ItemInstanceEvidence,
  proposedSwap: ProposedSwap,
  availabilityAssessment: ModifierAvailabilityAssessment
): TierRequirementCheck {
  const result: TierRequirementCheck = {
    passed: false,
    blocked: false,
    unknown: true,
    reason: 'Tier requirements cannot be determined: tier requirements data not available.',
  };

  // If we had tier requirements data, we would check:
  // - itemInstance.masterworkTier >= requiredTier for the proposed plug
  // - For now, we conservatively return unknown

  return result;
}

/**
 * Unlock requirement check.
 * Currently, the system does not have reliable unlock requirements data.
 * This check will always return unknown unless explicit unlock evidence is added.
 */
function checkUnlockRequirements(
  proposedSwap: ProposedSwap,
  availabilityAssessment: ModifierAvailabilityAssessment
): UnlockRequirementCheck {
  const result: UnlockRequirementCheck = {
    passed: false,
    blocked: false,
    unknown: true,
    reason: 'Unlock requirements cannot be determined: unlock requirements data not available.',
  };

  // If we had unlock requirements data, we would check:
  // - Seasonal availability
  // - Purchase requirements
  // - Progression/level requirements
  // - For now, we conservatively return unknown

  return result;
}

/**
 * Energy type compatibility check.
 * Checks if the new plug's energy type matches the socket's energy type.
 * Currently, the system does not have reliable per-socket energy type data.
 * This check will always return unknown unless explicit energy type evidence is added.
 */
function checkEnergyTypeCompatibility(
  itemInstance: ItemInstanceEvidence,
  proposedSwap: ProposedSwap,
  availabilityAssessment: ModifierAvailabilityAssessment,
  newPlugEnergyType: number | null
): EnergyTypeCompatibilityCheck {
  const result: EnergyTypeCompatibilityCheck = {
    passed: false,
    blocked: false,
    unknown: true,
    reason: 'Energy type compatibility cannot be determined: per-socket energy type data not available.',
  };

  // If we had per-socket energy type data, we would check:
  // - newPlugEnergyType matches socket energy type
  // - For now, we conservatively return unknown

  return result;
}

/**
 * Main preflight function.
 * Performs all checks and returns a comprehensive result.
 * Never returns installabilityVerified: true or overallInstallable: true.
 */
export function validateArmorInstallability(input: {
  itemInstance: ItemInstanceEvidence;
  currentEnergy: CurrentEnergyEvidence;
  proposedSwap: ProposedSwap;
  availabilityAssessment: ModifierAvailabilityAssessment;
  oldPlugCost: number | null;
  newPlugCost: number | null;
  newPlugEnergyType: number | null;
}): InstallabilityPreflightResult {
  const result: InstallabilityPreflightResult = {
    schemaVersion: 1,
    installabilityVerified: false,
    overallInstallable: false,
    availabilityCheck: { passed: false, blocked: false, unknown: true, reason: '' },
    energyBalance: {
      passed: false, blocked: false, unknown: true,
      reason: '', newEnergyUsed: null, energyRemaining: null, overflow: false,
    },
    ownership: { passed: false, blocked: false, unknown: true, reason: '' },
    socketRestrictions: { passed: false, blocked: false, unknown: true, reason: '' },
    tierRequirements: { passed: false, blocked: false, unknown: true, reason: '' },
    unlockRequirements: { passed: false, blocked: false, unknown: true, reason: '' },
    energyTypeCompatibility: { passed: false, blocked: false, unknown: true, reason: '' },
    reasons: [],
  };

  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      result.reasons.push('Input is missing or invalid.');
      return result;
    }

    // Check availability assessment validity
    if (!input.availabilityAssessment || input.availabilityAssessment.schemaVersion !== 1 ||
        input.availabilityAssessment.validEvidence !== true ||
        input.availabilityAssessment.readOnly !== true ||
        input.availabilityAssessment.installabilityVerified !== false ||
        !Array.isArray(input.availabilityAssessment.sockets)) {
      result.availabilityCheck.reason = 'Availability assessment is missing or invalid.';
      result.reasons.push(result.availabilityCheck.reason);
      return result;
    }

    // Availability check: is the new plug at least a candidate?
    const socket = input.availabilityAssessment.sockets.find(
      s => s.socketIndex === input.proposedSwap.socketIndex
    );
    if (!socket) {
      result.availabilityCheck.reason = 'Socket not found in availability assessment.';
      result.availabilityCheck.unknown = true;
      result.reasons.push(result.availabilityCheck.reason);
      return result;
    }

    const option = socket.options.find(o => o.plugHash === input.proposedSwap.newPlugHash);
    if (!option) {
      result.availabilityCheck.reason = 'New plug not found in socket options.';
      result.availabilityCheck.blocked = true;
      result.availabilityCheck.unknown = false;
      result.reasons.push(result.availabilityCheck.reason);
      return result;
    }

    if (option.availability === 'live_candidate' && option.socketWhitelistCheck === 'excluded') {
      // Defense in depth if caller supplies inconsistent/bypassed Availability evidence.
      result.availabilityCheck.reason = 'Conflicting live candidate and excluded Manifest socket category: availability unknown.';
    } else if (option.availability === 'live_candidate') {
      result.availabilityCheck.passed = true;
      result.availabilityCheck.unknown = false;
      result.availabilityCheck.reason = 'Plug is a live candidate only; insertion rules and installability remain unverified.';
    } else if (option.availability === 'installed') {
      result.availabilityCheck.reason = 'Plug is already installed; re-insertion is not verified.';
    } else if (option.availability === 'live_blocked') {
      result.availabilityCheck.blocked = true;
      result.availabilityCheck.unknown = false;
      result.availabilityCheck.reason = 'Plug is blocked by live signals.';
    } else {
      result.availabilityCheck.reason = `Plug availability is ${option.availability}; more evidence is needed.`;
    }
    result.reasons.push(result.availabilityCheck.reason);

    // Energy balance check
    result.energyBalance = calculateEnergyBalance(
      input.currentEnergy,
      input.proposedSwap,
      input.availabilityAssessment,
      input.oldPlugCost,
      input.newPlugCost
    );
    result.reasons.push(`Energy balance: ${result.energyBalance.reason}`);

    // Ownership check
    result.ownership = checkOwnership(input.itemInstance);
    result.reasons.push(`Ownership: ${result.ownership.reason}`);

    // Socket restrictions check
    result.socketRestrictions = checkSocketRestrictions(
      input.proposedSwap,
      input.availabilityAssessment
    );
    result.reasons.push(`Socket restrictions: ${result.socketRestrictions.reason}`);

    // Tier requirements check
    result.tierRequirements = checkTierRequirements(
      input.itemInstance,
      input.proposedSwap,
      input.availabilityAssessment
    );
    result.reasons.push(`Tier requirements: ${result.tierRequirements.reason}`);

    // Unlock requirements check
    result.unlockRequirements = checkUnlockRequirements(
      input.proposedSwap,
      input.availabilityAssessment
    );
    result.reasons.push(`Unlock requirements: ${result.unlockRequirements.reason}`);

    // Energy type compatibility check
    result.energyTypeCompatibility = checkEnergyTypeCompatibility(
      input.itemInstance,
      input.proposedSwap,
      input.availabilityAssessment,
      input.newPlugEnergyType
    );
    result.reasons.push(`Energy type compatibility: ${result.energyTypeCompatibility.reason}`);

    // Overall installable is always false in B0.5c1
    result.overallInstallable = false;
    result.reasons.push('Overall installability is not certified in B0.5c1 (preflight only).');

  } catch {
    // Never echo arbitrary exception strings: they might contain private item/Guardian IDs.
    result.reasons.push('Preflight failed: invalid or incomplete input.');
  }

  return result;
}
