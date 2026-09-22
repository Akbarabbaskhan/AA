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
} from './actor';
export { resolveActor } from './resolve';
