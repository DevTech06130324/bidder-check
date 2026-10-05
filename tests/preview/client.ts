// Only the isolated component fixture uses this non-production session.
export function createClient() {
  return { auth: { getSession: async () => ({ data: { session: { access_token: "fixture-token" } } }) } };
}
