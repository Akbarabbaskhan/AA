import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE, LOCALE_COOKIE, isLocale } from './config';

export default getRequestConfig(async () => {
  const cookieLocale = cookies().get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return {
    locale,
    timeZone: DEFAULT_TIMEZONE,
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
