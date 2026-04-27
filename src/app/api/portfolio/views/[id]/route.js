// src/app/api/portfolio/views/[id]/route.js
import { NextResponse } from 'next/server';
import { getView, validateViewPayload, updateView, deleteView } from '@/lib/portfolio/views';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    const view = await getView(id);
    if (!view) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ view });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    const payload = await req.json();
    validateViewPayload(payload);
    await updateView(id, payload);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err.message?.match(/required|unknown|invalid|both|unsafe/i) ? 400 : 500;
    return NextResponse.json({ error: err.message ?? String(err) }, { status });
  }
}

export async function DELETE(req, { params }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    const result = await deleteView(id);
    if (!result.ok) {
      const status = result.reason.includes('not found') ? 404 : 403;
      return NextResponse.json({ error: result.reason }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
