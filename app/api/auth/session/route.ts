import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ user: null }, { status: 200 });
    }
    const unreadNotifications = await prisma.notification.count({
      where: { userId: session.userId, readAt: null },
    });
    return NextResponse.json(
      {
        user: { id: session.userId, name: session.name, email: session.email, role: session.role, twoFactorEnabled: session.twoFactorEnabled },
        unreadNotifications,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[session] lookup failed', error);
    return NextResponse.json({ user: null }, { status: 500 });
  }
}
