import { route } from '@/lib/api/handler';
import { getChildren } from '@/lib/services/parents';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor }) => getChildren(actor));
