import { notFound } from 'next/navigation';
import { RegisterClient } from '@/components/features/attendance/register-client';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getRegister } from '@/lib/services/attendance/register';
import { ForbiddenError } from '@/lib/permissions';

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
    // A teacher who is not on this section gets "not found", not "forbidden" — the latter
    // confirms the section exists.
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
}
