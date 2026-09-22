import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { ApiError } from '@/lib/api/errors';
import { assertCanAccessStudent } from '@/lib/permissions';
import { getWeaknessMap } from '@/lib/services/quizzes/mastery';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const { studentId } = z
    .object({ studentId: z.string().uuid().optional() })
    .parse(Object.fromEntries(new URL(request.url).searchParams));

  const target = studentId ?? actor.studentId;
  if (!target) throw ApiError.notFound('No student');
  if (target !== actor.studentId) assertCanAccessStudent(actor, target);
  return getWeaknessMap(target);
});
