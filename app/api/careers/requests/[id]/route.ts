import { route } from '@/lib/api/handler';
import { decideDocumentRequest, decideRequestSchema } from '@/lib/services/careers';

export const dynamic = 'force-dynamic';

export const PATCH = route<{ id: string }>(
  { capability: 'transcript.fulfil' },
  async ({ actor, request, params }) => {
    const input = decideRequestSchema.parse(await request.json());
    return decideDocumentRequest(actor, params.id, input);
  },
);
