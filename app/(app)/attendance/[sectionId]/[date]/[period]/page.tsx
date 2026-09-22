import { notFound } from 'next/navigation';
import { RegisterClient } from '@/components/features/attendance/register-client';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getRegister } from '@/lib/services/attendance/register';
import { ForbiddenError } from '@/lib/permissions';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

type Params = { sectionId: string; date: string; period: string };

export default async function RegisterPage({ params }: { params: Params }) {
  const actor = await requireSessionActor();
  const periodIndex = Number(params.period);
  if (!Number.isInteger(periodIndex)) notFound();

  try {
    const register = await withActor(actor, () =>
      getRegister(actor, { sectionId: params.sectionId, date: params.date, periodIndex }),
    );
    return <RegisterClient initial={register} />;
  } catch (error) {
    // "Not found", not "forbidden" — the latter confirms the section exists. The service
    // raises either depending on whether the capability or the row scope refused, and
    // both have to land on the same page rather than a 500.
    if (error instanceof ForbiddenError) notFound();
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
