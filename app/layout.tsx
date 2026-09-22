import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { DEFAULT_LOCALE, direction, isLocale } from '@/lib/i18n/config';
import { loadTenantBranding } from '@/lib/theme/load';
import { themeToCss } from '@/lib/theme/tokens';
import { Providers } from './providers';
import './globals.css';

/**
 * Inter, self-hosted through next/font — an open licence, and excellent at small sizes on
 * Android. Apple's SF Pro is deliberately not used: its licence covers Apple platforms only.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export async function generateMetadata(): Promise<Metadata> {
  const slug = process.env['DEFAULT_TENANT_SLUG'] ?? 'volt-demo';
  const branding = await loadTenantBranding(slug);

  return {
    title: {
      default: branding?.displayName ?? 'Volt',
      template: `%s · ${branding?.displayName ?? 'Volt'}`,
    },
    description: 'School ERP and student portal',
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'default' },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The register has to stay usable when a teacher has text size turned up.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const slug = process.env['DEFAULT_TENANT_SLUG'] ?? 'volt-demo';
  const branding = await loadTenantBranding(slug);

  const rawLocale = await getLocale();
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const messages = await getMessages();

  return (
    <html lang={locale} dir={direction(locale)} suppressHydrationWarning>
      <head>
        {/*
          The tenant's tokens, inlined so the first paint is already branded. Swapping a
          school changes this block and nothing else in the app.
        */}
        {branding ? (
          <style
            id="volt-theme"
            // eslint-disable-next-line react/no-danger -- generated from a validated theme file, never user input
            dangerouslySetInnerHTML={{ __html: themeToCss(branding.theme) }}
          />
        ) : null}
      </head>
      <body className={`${inter.variable} font-sans text-body antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
