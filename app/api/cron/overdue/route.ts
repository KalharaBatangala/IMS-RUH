import { NextResponse } from 'next/server';
import { runMaintenance } from '@/lib/borrow-workflow';

// For a scheduled task on the server (e.g. Windows Task Scheduler calling this URL).
// Disabled unless CRON_SECRET is configured.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runMaintenance();
    return NextResponse.json({ status: 'ok', updatedCount: result.overdue, expiredCount: result.expired });
  } catch (error) {
    console.error('[cron] maintenance failed', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
