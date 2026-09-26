import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The rule raw SQL has to obey, enforced rather than remembered.
 *
 * The tenancy extension rewrites Prisma's model queries; it cannot rewrite a raw statement.
 * So every raw query that touches a tenant table binds `school_id` itself — and the way that
 * rule gets broken is not carelessness but a performance fix written in a hurry, which is
 * exactly what happened to the leaderboard's attendance streak in M5. A grep is a poor
 * substitute for a type, and a far better one than a code review six months from now.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
}

type RawQuery = { file: string; body: string };

/** Every `$queryRaw`/`$executeRaw` tagged template in the file, with its SQL. */
function rawQueries(file: string): RawQuery[] {
  const source = readFileSync(file, 'utf8');
  const found: RawQuery[] = [];
  const tag = /\$(?:queryRaw|executeRaw)(?:<[^`]*?>)?`/g;

  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    const start = match.index + match[0].length;
    // Template literals here contain `${...}` but never a nested backtick.
    const end = source.indexOf('`', start);
    if (end === -1) continue;
    found.push({ file, body: source.slice(start, end) });
  }
  return found;
}

const files = [...sourceFiles('lib'), ...sourceFiles('app')];

describe('raw SQL and the tenant', () => {
  it('finds the raw queries it is meant to be checking', () => {
    // A guard that silently matches nothing is worse than no guard.
    const all = files.flatMap(rawQueries);
    expect(all.length).toBeGreaterThan(3);
  });

  it('binds school_id in every raw query that reads a tenant table', () => {
    const offenders: string[] = [];

    for (const file of files) {
      for (const query of rawQueries(file)) {
        const reads = /\b(from|join|into|update)\s+[a-z_"]/i.test(query.body);
        if (!reads) continue;
        // Bound, never interpolated as text: `school_id = ${schoolId}` is a parameter.
        if (!/school_id"?\s*=\s*\$\{/.test(query.body)) {
          offenders.push(`${file}: ${query.body.trim().split('\n')[0]?.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never interpolates into $executeRawUnsafe or $queryRawUnsafe', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const unsafe = /\$(?:executeRawUnsafe|queryRawUnsafe)\(([^)]*)\)/g;
      for (let match = unsafe.exec(source); match; match = unsafe.exec(source)) {
        const argument = match[1] ?? '';
        // A constant string is fine — a template with a value in it is an injection.
        if (/\$\{|\+/.test(argument) || !/^\s*'[^']*'\s*$/.test(argument)) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
