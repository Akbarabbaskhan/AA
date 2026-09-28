import { route } from '@/lib/api/handler';
import {
  getSystemHealth,
  listTenants,
  provisionTenant,
  setTenantFlag,
} from '@/lib/services/tenants';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'tenant.provision' }, async ({ actor, request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get('health') === 'true') return getSystemHealth(actor);
  return { tenants: await listTenants(actor) };
});

export const POST = route({ capability: 'tenant.provision' }, async ({ actor, request }) =>
  provisionTenant(actor, await request.json()),
);

export const PATCH = route({ capability: 'tenant.provision' }, async ({ actor, request }) => ({
  disabledModules: await setTenantFlag(actor, await request.json()),
}));
