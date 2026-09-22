'use client';

import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';
import { ServiceWorkerRegistrar } from '@/components/features/service-worker';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ServiceWorkerRegistrar />
      {children}
    </SessionProvider>
  );
}
