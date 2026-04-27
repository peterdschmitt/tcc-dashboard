// src/app/api/portfolio/views/[id]/reset/route.js
import { NextResponse } from 'next/server';
import { resetSystemView } from '@/lib/portfolio/views';

export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    const result = await resetSystemView(id);
    if (!result.ok) {
      const status = result.reason.includes('not found') ? 404 : 403;
      return NextResponse.json({ error: result.reason }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
