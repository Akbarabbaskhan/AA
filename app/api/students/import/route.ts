import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { commitStudentImport } from '@/lib/services/import/students';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  file: z.string().min(1).max(20_000_000),
  mapping: z.record(z.string(), z.number().int().min(0)),
  fileName: z.string().max(255).optional(),
});

export const POST = route({ capability: 'import.run' }, async ({ actor, request }) => {
  const body = bodySchema.parse(await request.json());
  return commitStudentImport(actor, body.file, body.mapping, { fileName: body.fileName });
});
