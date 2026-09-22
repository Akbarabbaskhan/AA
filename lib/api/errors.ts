import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ForbiddenError } from '@/lib/permissions';
import { CrossTenantAccessError, TenantContextMissingError } from '@/lib/db';
import { UnauthenticatedError } from '@/lib/auth/session';

/**
 * One error shape across the whole API: `{ error: { code, message, fields? } }`.
 *
 * `fields` carries per-field validation messages so a form can render them inline rather
 * than dumping a single string at the top of the page.
 */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
};

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }

  static badRequest(code: string, message: string, fields?: Record<string, string[]>): ApiError {
    return new ApiError(400, code, message, fields);
  }

  static notFound(message = 'Not found'): ApiError {
    return new ApiError(404, 'notFound', message);
  }

  static conflict(code: string, message: string): ApiError {
    return new ApiError(409, code, message);
  }

  static locked(code: string, message: string): ApiError {
    return new ApiError(423, code, message);
  }
}

function zodFields(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.errors) {
    const key = issue.path.join('.') || '_';
    fields[key] = [...(fields[key] ?? []), issue.message];
  }
  return fields;
}

/**
 * Maps any thrown value to a status and a body.
 *
 * The tenancy and permission errors are deliberately flattened to 403 with no detail:
 * telling a caller "that record belongs to another school" confirms it exists.
 */
export function toErrorResponse(error: unknown): { status: number; body: ApiErrorBody } {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: { code: 'validationFailed', message: 'Check the highlighted fields.', fields: zodFields(error) },
      },
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 is a unique-constraint violation: two requests raced, or a caller is
    // re-creating something that exists. Either way it is the caller's conflict to see,
    // not an internal error — and the constraint's own fields are not disclosed.
    if (error.code === 'P2002') {
      return {
        status: 409,
        body: { error: { code: 'alreadyExists', message: 'That already exists.' } },
      };
    }
    // P2025: an update or delete found no row.
    if (error.code === 'P2025') {
      return { status: 404, body: { error: { code: 'notFound', message: 'Not found' } } };
    }
  }

  if (error instanceof UnauthenticatedError) {
    return { status: 401, body: { error: { code: 'unauthenticated', message: 'Sign in to continue.' } } };
  }

  if (error instanceof ForbiddenError || error instanceof CrossTenantAccessError) {
    return { status: 403, body: { error: { code: 'forbidden', message: 'Not allowed.' } } };
  }

  if (error instanceof TenantContextMissingError) {
    // A bug rather than a caller's fault, but it must never fall through as a 200.
    return { status: 500, body: { error: { code: 'internal', message: 'Something went wrong.' } } };
  }

  return { status: 500, body: { error: { code: 'internal', message: 'Something went wrong.' } } };
}
