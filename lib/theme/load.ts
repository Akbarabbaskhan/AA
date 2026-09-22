import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma, withoutTenantScope } from '@/lib/db';
import { parseTheme, type Theme } from './tokens';

const THEMES_DIR = join(process.cwd(), 'themes');
const cache = new Map<string, Theme>();

export const DEFAULT_THEME_ID = 'volt-default';

async function readThemeFile(themeId: string): Promise<Theme | null> {
  // Themes are files on disk chosen by id from the tenant record, never a path from a
  // request — so a tenant cannot point `themeJson` at an arbitrary file.
  if (!/^[a-z0-9-]+$/.test(themeId)) return null;

  const cached = cache.get(themeId);
  if (cached) return cached;

  try {
    const raw = await readFile(join(THEMES_DIR, `${themeId}.json`), 'utf8');
    const theme = parseTheme(JSON.parse(raw));
    cache.set(themeId, theme);
    return theme;
  } catch {
    return null;
  }
}

export async function loadTheme(themeId: string): Promise<Theme> {
  const theme = await readThemeFile(themeId);
  if (theme) return theme;

  const fallback = await readThemeFile(DEFAULT_THEME_ID);
  if (!fallback) throw new Error('The default Volt theme is missing from /themes');
  return fallback;
}

export type TenantBranding = {
  schoolId: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  theme: Theme;
};

/**
 * Resolves a tenant's branding. "LGS branding is configuration, not code" — a second
 * school is a new theme file and a row, and nothing else.
 */
export async function loadTenantBranding(slug: string): Promise<TenantBranding | null> {
  const school = await withoutTenantScope(() =>
    prisma.school.findFirst({
      where: { slug, isActive: true },
      select: { id: true, slug: true, name: true, logoUrl: true, themeJson: true },
    }),
  );
  if (!school) return null;

  const themeId =
    school.themeJson && typeof school.themeJson === 'object' && !Array.isArray(school.themeJson)
      ? ((school.themeJson as Record<string, unknown>)['themeId'] as string | undefined)
      : undefined;

  const theme = await loadTheme(themeId ?? DEFAULT_THEME_ID);

  return {
    schoolId: school.id,
    slug: school.slug,
    displayName: school.name,
    logoUrl: school.logoUrl,
    theme,
  };
}
