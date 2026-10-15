import type { AssetStatus, ItemCondition, UnitStatus } from '@prisma/client';

// The four user-facing availability states, DERIVED (never stored separately):
//   RESERVED / ISSUED  <- EquipmentUnit.status (allocation, changed only by the borrow workflow)
//   UNAVAILABLE        <- not fit for use: condition != WORKING, NOT_RECEIVED, or archived
//   AVAILABLE          <- fit for use and not allocated
// An issued unit stays ISSUED even when the loan is overdue or a return is in progress.
export type Availability = 'AVAILABLE' | 'RESERVED' | 'ISSUED' | 'UNAVAILABLE';

export interface UnitAvailabilityFields {
  status: UnitStatus;
  condition: ItemCondition;
  assetStatus: AssetStatus;
  archivedAt: Date | string | null;
}

export function isFitForUse(unit: Omit<UnitAvailabilityFields, 'status'>): boolean {
  return unit.condition === 'WORKING' && unit.assetStatus === 'RECEIVED' && !unit.archivedAt;
}

export function effectiveAvailability(unit: UnitAvailabilityFields): Availability {
  if (unit.status === 'ISSUED') return 'ISSUED';
  if (unit.status === 'RESERVED') return 'RESERVED';
  return isFitForUse(unit) ? 'AVAILABLE' : 'UNAVAILABLE';
}

// Prisma `where` fragment for units that can be requested / reserved right now.
export const requestableUnitWhere = {
  status: 'AVAILABLE',
  currentLogId: null,
  condition: 'WORKING',
  assetStatus: 'RECEIVED',
  archivedAt: null,
} as const;
