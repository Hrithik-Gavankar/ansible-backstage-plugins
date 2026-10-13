/**
 * Executes a database callback with the given `organizationId` as its
 * explicit partition key.
 *
 * Every portal plugin database operation **must** go through this helper.
 * Queries that omit the organization key are a multi-tenancy bug — this
 * function makes the key unavoidable and visible at the call site.
 *
 * The helper adds no runtime overhead beyond a guard check. Its value is
 * structural: it signals intent, blocks accidental omissions via TypeScript,
 * and makes the key easy to grep.
 *
 * **Single-org deployments:** Even when there is only one organization, every
 * row must carry `organizationId = 'default'`. This ensures that adding a
 * second organization later never requires a schema migration.
 *
 * @example
 * ```ts
 * // In a route handler:
 * const { organizationId } = req.portalContext!;
 * const scans = await withOrganization(organizationId, orgId =>
 *   db.select('*').from('scans').where('organization_id', orgId)
 * );
 * ```
 *
 * @throws {Error} When `organizationId` is empty or whitespace-only.
 */
export function withOrganization<T>(
  organizationId: string,
  fn: (organizationId: string) => Promise<T>,
): Promise<T> {
  if (!organizationId || organizationId.trim() === '') {
    return Promise.reject(
      new Error(
        '[portal-plugin-node] withOrganization: organizationId must not be empty. ' +
          'Every database query must be scoped to an organization.',
      ),
    );
  }
  return fn(organizationId.trim());
}
