// An error whose message is safe to show to the user. Anything else is logged on the
// server and replaced with a generic message, so stack traces / DB internals never leak.
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

export type ActionResult<T = undefined> =
  | { success: true; data?: T; message?: string }
  | { success: false; error: string };

export function toActionError(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof ActionError) return { success: false, error: error.message };
  console.error(`[action] ${fallback}`, error);
  return { success: false, error: fallback };
}

export function requireText(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim()) throw new ActionError(`${field} is required.`);
  const text = value.trim();
  if (text.length > maxLength) throw new ActionError(`${field} must be at most ${maxLength} characters.`);
  return text;
}

export function optionalText(value: unknown, field: string, maxLength = 1000): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ActionError(`${field} is invalid.`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) throw new ActionError(`${field} must be at most ${maxLength} characters.`);
  return text;
}
