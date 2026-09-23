import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE, LOCALE_COOKIE, isLocale } from './config';
import { currentUserLocale } from './user-locale';

/**
 * Which language this request is rendered in.
 *
 * Three sources, in order of how much they mean:
 *
 *   1. The cookie — an explicit choice this person made on this device. It always wins.
 *   2. The signed-in user's stored locale. This is the one that matters for the parent
 *      portal: "many parents are not comfortable reading English interfaces, and this is
 *      the difference between a portal that is used and one that is ignored." A parent
 *      whose account says Urdu should not have to find a toggle on an English screen
 *      before the portal becomes usable to them.
 *   3. The school's default.
 */
export default getRequestConfig(async () => {
  const cookieLocale = cookies().get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : ((await currentUserLocale()) ?? DEFAULT_LOCALE);

  return {
    locale,
    timeZone: DEFAULT_TIMEZONE,
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
