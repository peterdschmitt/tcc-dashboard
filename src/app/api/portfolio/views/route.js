// src/app/api/portfolio/views/route.js
import { NextResponse } from 'next/server';
import { listViews, validateViewPayload, createView } from '@/lib/portfolio/views';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const views = await listViews();
    return NextResponse.json({ views });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const payload = await req.json();
    validateViewPayload(payload);
    const id = await createView(payload);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    const status = err.message?.match(/required|unknown|invalid|both|unsafe/i) ? 400 : 500;
    return NextResponse.json({ error: err.message ?? String(err) }, { status });
  }
}
