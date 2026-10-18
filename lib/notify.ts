import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { emailEnabled, notificationEmail, sendEmail } from '@/lib/email';

// In-app notifications. Called AFTER the workflow transaction has committed: a failure
// here is logged but never changes whether the request / issue / return succeeded.
// The in-app notification is the authoritative channel. When email is enabled
// (lib/email.ts), a copy is also emailed to each active recipient, unless the caller
// sends its own email for the same event ({ email: false }).
export async function notify(
  userIds: string[],
  message: { title: string; body: string; link?: string },
  options: { email?: boolean } = {}
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

  if (options.email === false || !emailEnabled()) return;
  runAfterResponse(() => emailCopies(unique, message));
}

async function emailCopies(userIds: string[], message: { title: string; body: string; link?: string }) {
  try {
    const users = await prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true, email: true } });
    const content = notificationEmail(message);
    await Promise.allSettled(users.map((u) => sendEmail({ to: u.email, userId: u.id, kind: 'NOTIFICATION', ...content })));
  } catch (error) {
    console.error('[notify] failed to send email copies', error);
  }
}

// Inside a Next.js request, send after the response so pages and actions do not wait for
// the mail provider. Outside a request (e.g. scripts), after() throws, so run directly.
function runAfterResponse(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    void task();
  }
}
