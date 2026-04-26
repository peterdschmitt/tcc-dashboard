// src/app/api/portfolio/contact/[id]/route.js
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  try {
    const [contact] = await sql`SELECT * FROM contacts WHERE id = ${id}`;
    if (!contact) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const policies = await sql`
      SELECT p.*, c.name AS carrier_name, pr.name AS product_name, a.canonical_name AS agent_name
      FROM policies p
      LEFT JOIN carriers c ON c.id = p.carrier_id
      LEFT JOIN products pr ON pr.id = p.product_id
      LEFT JOIN agents a ON a.id = p.agent_id
      WHERE p.contact_id = ${id}
      ORDER BY p.application_date DESC NULLS LAST
    `;

    const calls = await sql`
      SELECT ca.*, cm.code AS campaign_code_resolved, a.canonical_name AS agent_name
      FROM calls ca
      LEFT JOIN campaigns cm ON cm.id = ca.campaign_id
      LEFT JOIN agents a ON a.id = ca.agent_id
      WHERE ca.contact_id = ${id}
      ORDER BY ca.call_date DESC
      LIMIT 100
    `;

    return NextResponse.json({ contact, policies, calls });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
