import { NextResponse } from 'next/server';
import { checkAndUpdateOverdueLogs } from '@/actions/cron';

export async function GET(request: Request) {
  // Optional: Verify CRON_SECRET header for security in production
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await checkAndUpdateOverdueLogs();
  
  if (result.success) {
    return NextResponse.json({ 
      status: 'ok', 
      updatedCount: result.updatedCount 
    });
  } else {
    return NextResponse.json({ 
      status: 'error', 
      error: result.error 
    }, { status: 500 });
  }
}