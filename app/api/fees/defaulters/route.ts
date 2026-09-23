import { NextResponse } from 'next/server';
import { route } from '@/lib/api/handler';
import { defaulterQuerySchema, defaultersToCsv, getDefaulters } from '@/lib/services/fees/reports';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'fee.read.school' }, async ({ actor, request }) => {
  const url = new URL(request.url);
  const query = defaulterQuerySchema.parse(Object.fromEntries(url.searchParams));
  const result = await getDefaulters(actor, query);

  if (url.searchParams.get('format') === 'csv') {
    return new NextResponse(defaultersToCsv(result.rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="defaulters.csv"',
        'cache-control': 'private, no-store',
      },
    });
  }

  return result;
});
