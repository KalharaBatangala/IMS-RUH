import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { POLICY } from '@/lib/config';

// One-time handover / return codes.
// - Generated with a cryptographically secure RNG (crypto.randomInt).
// - Only an HMAC is stored. A 6-digit code has little entropy, so a plain hash could be
//   brute-forced offline; the HMAC key (derived from JWT_SECRET) prevents that if the
//   database alone leaks. Online guessing is limited by POLICY.codeMaxAttempts.
// - Because only the HMAC is stored, a code cannot be "revealed" later: authorised staff
//   regenerate it instead (old code invalidated, new code shown once).

function hmacKey(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET is missing or too short.');
  return `ims-confirmation-code:${secret}`;
}

export function generateCode(): string {
  const max = 10 ** POLICY.codeDigits;
  return randomInt(0, max).toString().padStart(POLICY.codeDigits, '0');
}

// Bound to the code row id so a hash cannot be replayed against another code.
export function hashCode(code: string, codeId: string): string {
  return createHmac('sha256', hmacKey()).update(`${codeId}:${code}`).digest('hex');
}

export function codeMatches(code: string, codeId: string, storedHash: string): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${POLICY.codeDigits}}$`).test(normalized)) return false;
  const a = Buffer.from(hashCode(normalized, codeId), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
