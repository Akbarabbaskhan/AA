import { route } from '@/lib/api/handler';
import {
  documentRequestSchema,
  listDocumentRequests,
  requestDocument,
  requestQuerySchema,
} from '@/lib/services/careers';

export const dynamic = 'force-dynamic';

export const GET = route({ module: 'careers' }, async ({ actor, request }) => {
  const query = requestQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listDocumentRequests(actor, query);
});

export const POST = route(
  { capability: 'transcript.request', module: 'careers' },
  async ({ actor, request }) => {
    const input = documentRequestSchema.parse(await request.json());
    return requestDocument(actor, input);
  },
);
