import { z } from 'zod';
import type { ResourceType, ResourceVisibility } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { can, requireCapability, type Actor } from '@/lib/permissions';
import { getStorage } from '@/lib/storage';
import { isAcceptableVideoLink } from '@/lib/storage/mime';

/**
 * The resources library.
 *
 * Two things stop a shared drive from becoming this: visibility that follows the timetable
 * rather than a folder, and version history. A teacher who fixes a typo in a handout
 * uploads version 2 — the old link keeps working for anyone who already has it, and the
 * library shows one entry, not two.
 */

export const RESOURCE_TYPES = ['NOTES', 'SLIDES', 'WORKSHEET', 'VIDEO_LINK', 'OTHER'] as const;
export const VISIBILITIES = ['MY_SECTIONS', 'YEAR_GROUP', 'WHOLE_SCHOOL'] as const;

export const resourceInputSchema = z
  .object({
    subjectId: z.string().uuid(),
    title: z.string().min(1).max(200),
    type: z.enum(RESOURCE_TYPES),
    /** A storage key for an upload, or an https URL for VIDEO_LINK. */
    fileUrl: z.string().min(1).max(2000),
    fileSize: z.number().int().min(0).default(0),
    mime: z.string().min(1).max(200).default('application/octet-stream'),
    topicTags: z.array(z.string().min(1).max(120)).max(20).default([]),
    visibility: z.enum(VISIBILITIES).default('MY_SECTIONS'),
    /** Set when this replaces an existing resource. */
    supersedesId: z.string().uuid().nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.type !== 'VIDEO_LINK') return;
    if (!isAcceptableVideoLink(value.fileUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fileUrl'],
        message: 'Paste a YouTube, Vimeo or Google Drive link.',
      });
    }
  });

export type ResourceInput = z.infer<typeof resourceInputSchema>;

export async function createResource(actor: Actor, raw: ResourceInput): Promise<{ id: string; version: number }> {
  requireCapability(actor, 'resource.upload');
  const input = resourceInputSchema.parse(raw);
  if (!actor.staffId) throw ApiError.notFound('Only staff upload resources');

  // Whole-school visibility is a broadcast; a class teacher does not get to make one.
  if (input.visibility === 'WHOLE_SCHOOL' && !can(actor, 'resource.moderate')) {
    throw ApiError.badRequest(
      'visibilityNotAllowed',
      'Ask your head of department to share this with the whole school.',
      { visibility: ['Not available to you.'] },
    );
  }

  let version = 1;
  if (input.supersedesId) {
    const previous = await prisma.resource.findFirst({
      where: { id: input.supersedesId, deletedAt: null },
      select: { id: true, version: true, uploadedById: true, subjectId: true },
    });
    if (!previous) throw ApiError.notFound('The resource being replaced was not found');
    if (previous.uploadedById !== actor.staffId && !can(actor, 'resource.moderate')) {
      throw ApiError.notFound('The resource being replaced was not found');
    }
    version = previous.version + 1;
  }

  const resource = await prisma.resource.create({
    data: {
      schoolId: actor.schoolId,
      subjectId: input.subjectId,
      uploadedById: actor.staffId,
      title: input.title,
      type: input.type,
      fileUrl: input.fileUrl,
      fileSize: input.fileSize,
      mime: input.mime,
      topicTags: input.topicTags,
      visibility: input.visibility,
      version,
      supersedesId: input.supersedesId,
    },
    select: { id: true, version: true },
  });
  return resource;
}

export type ResourceRow = {
  id: string;
  title: string;
  type: ResourceType;
  subjectId: string;
  subjectName: string;
  topicTags: string[];
  visibility: ResourceVisibility;
  version: number;
  fileSize: number;
  mime: string;
  downloadCount: number;
  uploadedBy: string;
  createdAt: string;
  /** True for the most recent version in its chain. Older versions are reachable, not listed. */
  isCurrent: boolean;
};

export const resourceQuerySchema = z.object({
  subjectId: z.string().uuid().optional(),
  type: z.enum(RESOURCE_TYPES).optional(),
  topicTag: z.string().max(120).optional(),
  search: z.string().max(200).optional(),
  /** Off by default: the library shows the current version of each thing. */
  includeSuperseded: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

/**
 * Builds the visibility predicate for this actor.
 *
 * A student sees whole-school resources, their year group's, and anything attached to a
 * subject they are enrolled in. They never see another year's `YEAR_GROUP` material, which
 * is what stops next year's mock paper leaking a year early.
 */
async function visibleSubjectIds(actor: Actor): Promise<{ subjectIds: string[]; yearGroupIds: string[] }> {
  const sectionIds =
    actor.studentId && actor.enrolledSectionIds.length > 0
      ? [...actor.enrolledSectionIds]
      : [...actor.sectionIds];
  if (sectionIds.length === 0) return { subjectIds: [], yearGroupIds: [] };
  const sections = await prisma.section.findMany({
    where: { id: { in: sectionIds } },
    select: { subjectId: true, yearGroupId: true },
  });
  return {
    subjectIds: [...new Set(sections.map((section) => section.subjectId))],
    yearGroupIds: [...new Set(sections.map((section) => section.yearGroupId))],
  };
}

export async function listResources(
  actor: Actor,
  query: z.infer<typeof resourceQuerySchema>,
): Promise<ResourceRow[]> {
  requireCapability(actor, 'resource.read');
  const schoolWide = can(actor, 'resource.moderate') || can(actor, 'structure.manage');
  const { subjectIds } = await visibleSubjectIds(actor);

  if (!schoolWide && subjectIds.length === 0) {
    // No timetable yet — only what the school has published to everyone.
    const rows = await prisma.resource.findMany({
      where: { deletedAt: null, visibility: 'WHOLE_SCHOOL' },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      select: RESOURCE_SELECT,
    });
    return decorate(rows);
  }

  const rows = await prisma.resource.findMany({
    where: {
      deletedAt: null,
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.topicTag ? { topicTags: { has: query.topicTag } } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' as const } } : {}),
      ...(query.includeSuperseded ? {} : { supersededBy: null }),
      ...(schoolWide
        ? {}
        : {
            OR: [{ visibility: 'WHOLE_SCHOOL' as const }, { subjectId: { in: subjectIds } }],
          }),
    },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
    select: RESOURCE_SELECT,
  });
  return decorate(rows);
}

const RESOURCE_SELECT = {
  id: true,
  title: true,
  type: true,
  subjectId: true,
  subject: { select: { name: true } },
  topicTags: true,
  visibility: true,
  version: true,
  fileSize: true,
  mime: true,
  downloadCount: true,
  createdAt: true,
  uploadedBy: { select: { user: { select: { name: true } } } },
  supersededBy: { select: { id: true } },
} as const;

type ResourceSelected = {
  id: string;
  title: string;
  type: ResourceType;
  subjectId: string;
  subject: { name: string };
  topicTags: string[];
  visibility: ResourceVisibility;
  version: number;
  fileSize: number;
  mime: string;
  downloadCount: number;
  createdAt: Date;
  uploadedBy: { user: { name: string } };
  supersededBy: { id: string } | null;
};

function decorate(rows: readonly ResourceSelected[]): ResourceRow[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    subjectId: row.subjectId,
    subjectName: row.subject.name,
    topicTags: row.topicTags,
    visibility: row.visibility,
    version: row.version,
    fileSize: row.fileSize,
    mime: row.mime,
    downloadCount: row.downloadCount,
    uploadedBy: row.uploadedBy.user.name,
    createdAt: row.createdAt.toISOString(),
    isCurrent: row.supersededBy === null,
  }));
}

export type ResourceVersion = { id: string; version: number; createdAt: string; uploadedBy: string };

/** The whole chain, oldest first, so "what changed" is answerable. */
export async function getResourceVersions(actor: Actor, resourceId: string): Promise<ResourceVersion[]> {
  requireCapability(actor, 'resource.read');
  const chain: ResourceVersion[] = [];
  let cursor: string | null = resourceId;
  const seen = new Set<string>();

  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const row: {
      id: string;
      version: number;
      createdAt: Date;
      supersedesId: string | null;
      uploadedBy: { user: { name: string } };
    } | null = await prisma.resource.findFirst({
      where: { id: cursor },
      select: {
        id: true,
        version: true,
        createdAt: true,
        supersedesId: true,
        uploadedBy: { select: { user: { select: { name: true } } } },
      },
    });
    if (!row) break;
    chain.push({
      id: row.id,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      uploadedBy: row.uploadedBy.user.name,
    });
    cursor = row.supersedesId;
  }

  return chain.reverse();
}

async function canReadResource(
  actor: Actor,
  resource: { visibility: ResourceVisibility; subjectId: string },
): Promise<boolean> {
  if (resource.visibility === 'WHOLE_SCHOOL') return true;
  if (can(actor, 'resource.moderate') || can(actor, 'structure.manage')) return true;
  const { subjectIds } = await visibleSubjectIds(actor);
  return subjectIds.includes(resource.subjectId);
}

/**
 * Hands back a download URL and counts the download.
 *
 * The counter is what tells a teacher whether anyone opened the revision pack, which is the
 * only analytics the spec asks for here. It counts link handouts too — clicking through to
 * a video is still a use.
 */
export async function openResource(
  actor: Actor,
  resourceId: string,
): Promise<{ url: string; type: ResourceType; title: string; isExternal: boolean }> {
  requireCapability(actor, 'resource.read');

  const resource = await prisma.resource.findFirst({
    where: { id: resourceId, deletedAt: null },
    select: { id: true, title: true, type: true, fileUrl: true, visibility: true, subjectId: true },
  });
  if (!resource) throw ApiError.notFound('Resource not found');

  /*
   * Authorised against this one resource, not against a page of the library.
   *
   * Asking "is it among the first two hundred rows I can see" refuses a resource the
   * reader is perfectly entitled to as soon as the library outgrows that page — and the
   * failure looks like a missing file rather than a bug.
   */
  if (!(await canReadResource(actor, resource))) throw ApiError.notFound('Resource not found');

  await prisma.resource.update({
    where: { id: resource.id },
    data: { downloadCount: { increment: 1 } },
  });

  if (resource.type === 'VIDEO_LINK') {
    return { url: resource.fileUrl, type: resource.type, title: resource.title, isExternal: true };
  }
  const url = await getStorage().createDownloadUrl(resource.fileUrl, { download: true });
  return { url, type: resource.type, title: resource.title, isExternal: false };
}

/** Soft delete: an old link 404s rather than serving someone else's file at that key. */
export async function removeResource(actor: Actor, resourceId: string): Promise<void> {
  requireCapability(actor, 'resource.upload');
  const resource = await prisma.resource.findFirst({
    where: { id: resourceId, deletedAt: null },
    select: { id: true, uploadedById: true },
  });
  if (!resource) throw ApiError.notFound('Resource not found');
  if (resource.uploadedById !== actor.staffId && !can(actor, 'resource.moderate')) {
    throw ApiError.notFound('Resource not found');
  }
  await prisma.resource.update({ where: { id: resource.id }, data: { deletedAt: new Date() } });
}

export type ResourceFacets = {
  subjects: { id: string; name: string; count: number }[];
  topicTags: { tag: string; count: number }[];
  types: { type: ResourceType; count: number }[];
};

export async function getResourceFacets(actor: Actor): Promise<ResourceFacets> {
  const rows = await listResources(actor, { includeSuperseded: false, limit: 200 });
  const subjects = new Map<string, { id: string; name: string; count: number }>();
  const tags = new Map<string, number>();
  const types = new Map<ResourceType, number>();

  for (const row of rows) {
    const subject = subjects.get(row.subjectId) ?? { id: row.subjectId, name: row.subjectName, count: 0 };
    subject.count += 1;
    subjects.set(row.subjectId, subject);
    for (const tag of row.topicTags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    types.set(row.type, (types.get(row.type) ?? 0) + 1);
  }

  return {
    subjects: [...subjects.values()].sort((a, b) => a.name.localeCompare(b.name)),
    topicTags: [...tags.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    types: [...types.entries()].map(([type, count]) => ({ type, count })),
  };
}
