export {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  FINANCE_ONLY_FORBIDDEN,
  type Capability,
} from './capabilities';
export {
  ForbiddenError,
  type Actor,
  can,
  capabilitiesOf,
  hasRole,
  requireCapability,
  canAccessStudent,
  assertCanAccessStudent,
  canMarkSection,
  canAccessSection,
  assertCanAccessSection,
  canAccessDepartment,
  assertCanAccessDepartment,
  studentScopeFilter,
  type StudentScopeFilter,
} from './actor';
export { resolveActor } from './resolve';

// Re-exported so pages have a single place to ask "what is this user, mainly?".
export { primaryRole as primaryRoleOf } from '@/components/layouts/nav-config';
