import { route } from '@/lib/api/handler';
import { availableReports } from '@/lib/services/reports';

export const dynamic = 'force-dynamic';

export const GET = route({ module: 'reports' }, async ({ actor }) => ({
  reports: availableReports(actor),
}));
