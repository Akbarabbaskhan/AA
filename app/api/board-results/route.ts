import { route } from '@/lib/api/handler';
import { listBoardSessions, recordBoardResults } from '@/lib/services/reports/board-results';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'report.school', module: 'exams' }, async ({ actor }) => ({
  sessions: await listBoardSessions(actor),
}));

export const POST = route(
  { capability: 'exam.manage', module: 'exams' },
  async ({ actor, request }) => recordBoardResults(actor, await request.json()),
);
