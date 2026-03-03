export const dynamic = 'force-dynamic';
import { clearAllCache } from '@/lib/sheets';
import { NextResponse } from 'next/server';

export async function POST() {
  clearAllCache();
  return NextResponse.json({ success: true, message: 'Cache cleared' });
}
