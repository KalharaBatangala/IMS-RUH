import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  
  // Clear the session cookie (replace 'token' or 'session' with your exact cookie name)
  cookieStore.delete('token'); 
  cookieStore.delete('ims_session'); 

  return NextResponse.json({ success: true }, { status: 200 });
}