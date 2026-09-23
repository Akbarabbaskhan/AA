import { route } from '@/lib/api/handler';
import { markAnnouncementRead } from '@/lib/services/announcements';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>({ capability: 'announcement.read' }, async ({ actor, params }) =>
  markAnnouncementRead(actor, params.id),
);
