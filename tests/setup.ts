// Tests run against a real Postgres, never a mock. The spec's definition of done requires
// "real database end to end (no mocked data paths)", and a tenancy guard tested against a
// fake client would prove nothing.
Object.assign(process.env, {
  NODE_ENV: 'test',
  NEXTAUTH_SECRET: process.env['NEXTAUTH_SECRET'] ?? 'test-secret-not-used-for-anything-real',
});
