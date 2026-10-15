// Policy defaults agreed with the developer (2026-10-12). Change here only;
// every rule that depends on them reads these constants.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MINUTE = 60 * 1000;

export const POLICY = {
  // A recommended (reserved) request must be collected within this time, else it EXPIRES
  // and the unit is released (if still fit for use).
  reservationCollectionMs: 3 * DAY,
  // The handover code is valid until the reservation deadline.
  // The return code is short-lived: it is generated while borrower and TO are together.
  returnCodeTtlMs: 15 * MINUTE,
  codeDigits: 6,
  // Wrong entries allowed before a code is locked and must be regenerated.
  codeMaxAttempts: 5,
  // PENDING requests older than this are flagged "awaiting review" (never auto-rejected).
  pendingReviewFlagMs: 3 * DAY,
  // Login throttling (per account).
  loginMaxFailures: 5,
  loginLockoutMs: 15 * MINUTE,
  // Session lifetime.
  sessionTtlSeconds: 60 * 60 * 24,
  minPasswordLength: 8,
} as const;

export const ALLOWED_EMAIL_DOMAINS = ['@eie.ruh.ac.lk', '@eng.ruh.ac.lk'];
