import { route } from '@/lib/api/handler';
import { auditQuerySchema, searchAuditLog } from '@/lib/services/audit-search';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'audit.read' }, async ({ actor, request }) => {
  const query = auditQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return searchAuditLog(actor, query);
});
