import argon2 from 'argon2';

/**
 * argon2id, per the security section. Parameters are the OWASP baseline; they are here
 * rather than on the default so a change is visible in a diff.
 */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed hash is a failed verification, not a 500.
    return false;
  }
}

/**
 * Minimum policy for a password a human chose. Bulk-imported accounts get a generated
 * password and `mustChangePassword`, so this applies at first change, not at import.
 */
export function passwordProblems(plain: string): string[] {
  const problems: string[] = [];
  if (plain.length < 8) problems.push('tooShort');
  if (!/[a-zA-Z]/.test(plain)) problems.push('needsLetter');
  if (!/\d/.test(plain)) problems.push('needsDigit');
  return problems;
}
