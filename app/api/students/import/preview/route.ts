import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { previewStudentImport } from '@/lib/services/import/students';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  file: z.string().min(1).max(20_000_000),
  mapping: z.record(z.string(), z.number().int().min(0)).optional(),
});

/** Dry run: validates every row and returns the first twenty, without writing anything. */
export const POST = route({ capability: 'import.run' }, async ({ actor, request }) => {
  const body = bodySchema.parse(await request.json());
  return previewStudentImport(actor, body.file, body.mapping);
});
