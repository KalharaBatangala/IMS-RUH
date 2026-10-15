import { prisma } from '@/lib/prisma';

// In-app notifications. Called AFTER the workflow transaction has committed: a failure
// here is logged but never changes whether the request / issue / return succeeded.
// No external delivery channel (email/SMS) is used under the intranet-only constraint.
export async function notify(
  userIds: string[],
  message: { title: string; body: string; link?: string }
) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: unique.map((userId) => ({ userId, ...message, link: message.link ?? null })),
    });
  } catch (error) {
    console.error('[notify] failed to create notifications', error);
  }
}
