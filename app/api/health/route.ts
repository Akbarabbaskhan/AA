import { NextResponse } from 'next/server';
import { prisma, withoutTenantScope } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Liveness plus a real database round trip — a health check that does not touch Postgres
 * reports green while every page 500s.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await withoutTenantScope(() => prisma.$queryRaw`SELECT 1`);
    return NextResponse.json({
      status: 'ok',
      database: 'ok',
      latencyMs: Date.now() - startedAt,
    });
  } catch {
    return NextResponse.json(
      { status: 'degraded', database: 'unreachable', latencyMs: Date.now() - startedAt },
      { status: 503 },
    );
  }
}
