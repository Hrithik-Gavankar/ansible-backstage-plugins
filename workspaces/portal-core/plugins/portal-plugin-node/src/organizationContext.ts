import type {
  BackstageCredentials,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import { NotAllowedError } from '@backstage/errors';
import type { ActiveOrganizationResolver } from './entitlements';
import type { PortalContext } from './types';

export const PORTAL_ORGANIZATION_ANNOTATION = 'ansible.io/portal-organization';

/** Resolve identity and deployment scope independently; neither comes from input. */
export async function resolvePortalContext(options: {
  credentials: BackstageCredentials;
  userInfo: UserInfoService;
  organizations: ActiveOrganizationResolver;
}): Promise<PortalContext> {
  const principal = options.credentials.principal;
  if (
    !principal ||
    typeof principal !== 'object' ||
    !('type' in principal) ||
    principal.type !== 'user'
  ) {
    throw new NotAllowedError(
      'Portal operations require an authenticated user',
    );
  }
  const identity = await options.userInfo.getUserInfo(options.credentials);
  const match = /^user:[^/]+\/([^/]+)$/i.exec(identity.userEntityRef);
  if (!match) throw new NotAllowedError('Invalid Portal user identity');
  let organizationId: string | undefined;
  try {
    organizationId = await options.organizations.resolve(options.credentials);
  } catch {
    throw new NotAllowedError('Active organization could not be resolved');
  }
  if (!organizationId?.trim()) {
    throw new NotAllowedError('Active organization is missing or ambiguous');
  }
  return {
    userEntityRef: identity.userEntityRef,
    userId: match[1],
    organizationId,
  };
}

/** Explicit host mapping. The first namespace is used for new registrations. */
export function organizationCatalogNamespaces(
  config: Config,
  organizationId: string,
): readonly string[] {
  try {
    const mappings =
      config.getOptionalConfigArray('portal.organization.catalogMappings') ??
      [];
    const byOrganization = new Map<string, string[]>();
    const owners = new Map<string, string>();
    for (const mapping of mappings) {
      const id = mapping.getString('organizationId');
      const namespaces = mapping.getStringArray('namespaces');
      if (
        !id.trim() ||
        id !== id.trim() ||
        byOrganization.has(id) ||
        !namespaces.length
      ) {
        throw new Error('Invalid mapping');
      }
      for (const namespace of namespaces) {
        if (
          !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(namespace) ||
          owners.has(namespace)
        ) {
          throw new Error('Invalid or overlapping namespace');
        }
        owners.set(namespace, id);
      }
      byOrganization.set(id, namespaces);
    }
    const namespaces = byOrganization.get(organizationId) ?? [organizationId];
    if (
      namespaces.some(
        namespace =>
          !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(namespace) ||
          (owners.has(namespace) && owners.get(namespace) !== organizationId),
      )
    )
      throw new Error('Invalid implicit namespace');
    return namespaces;
  } catch {
    throw new NotAllowedError(
      'Invalid or ambiguous organization catalog mapping',
    );
  }
}

/** Catalog partition is a host mapping, not proof of organization membership. */
export function assertEntityOrganization(
  entity: {
    metadata: { namespace?: string; annotations?: Record<string, string> };
  },
  organizationId: string,
  config: Config,
): void {
  const declared =
    entity.metadata.annotations?.[PORTAL_ORGANIZATION_ANNOTATION];
  if (
    (declared !== undefined && declared !== organizationId) ||
    !organizationCatalogNamespaces(config, organizationId).includes(
      entity.metadata.namespace ?? 'default',
    )
  )
    throw new NotAllowedError('Repository is outside the active organization');
}
