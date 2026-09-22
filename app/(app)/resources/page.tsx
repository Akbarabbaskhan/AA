import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { OpenResourceButton } from '@/components/features/resources/open-button';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';
import { getResourceFacets, listResources, resourceQuerySchema } from '@/lib/services/resources';

export const dynamic = 'force-dynamic';

/**
 * The resources library.
 *
 * Grouped by subject rather than listed flat: a student revising chemistry wants every
 * chemistry handout together, and a flat list sorted by upload date scatters them.
 */
export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('resources');

  const query = resourceQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const isStaff = can(actor, 'resource.upload');
  const [resources, facets] = await withActor(actor, async () =>
    Promise.all([listResources(actor, query), getResourceFacets(actor)]),
  );

  if (resources.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('none')} body={isStaff ? t('noneStaffBody') : t('noneBody')} />
      </div>
    );
  }

  const bySubject = new Map<string, typeof resources>();
  for (const resource of resources) {
    bySubject.set(resource.subjectName, [...(bySubject.get(resource.subjectName) ?? []), resource]);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">
          {facets.subjects.length} · {facets.topicTags.length}
        </p>
      </header>

      {[...bySubject.entries()].map(([subjectName, items]) => (
        <section key={subjectName} className="flex flex-col gap-2">
          <h2 className="text-h2">{subjectName}</h2>
          <ul className="flex flex-col gap-2">
            {items.map((resource) => (
              <li key={resource.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
                    <span className="flex flex-col gap-1">
                      <span className="text-body font-medium text-[var(--text-primary)]">
                        {resource.title}
                      </span>
                      <span className="flex flex-wrap gap-2 text-small text-[var(--text-tertiary)]">
                        <span>{resource.type}</span>
                        {resource.version > 1 ? <span>{t('version', { version: resource.version })}</span> : null}
                        <span>{t('downloads', { count: resource.downloadCount })}</span>
                        <span>{t('uploadedBy', { name: resource.uploadedBy })}</span>
                      </span>
                      {resource.topicTags.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {resource.topicTags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-pill border border-[var(--border-subtle)] px-2 text-small text-[var(--text-tertiary)]"
                            >
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <OpenResourceButton resourceId={resource.id} isVideo={resource.type === 'VIDEO_LINK'} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
