import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { LOCALE_COOKIE, LOCALES } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ locale: z.enum(LOCALES) });

/**
 * Switches language.
 *
 * Writes both a cookie and the user's stored preference: the cookie makes this device
 * change immediately, and the stored value is what decides the language of the WhatsApp
 * messages the school sends them. A parent who switches the portal to Urdu and then keeps
 * getting English alerts has not really been given the choice.
 */
export const PATCH = route({}, async ({ actor, request }) => {
  const { locale } = bodySchema.parse(await request.json());

  await prisma.user.update({ where: { id: actor.userId }, data: { locale } });

  const response = NextResponse.json({ locale });
  response.cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
});
