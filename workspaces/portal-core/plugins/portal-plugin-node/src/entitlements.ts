import {
  coreServices,
  createServiceFactory,
  createServiceRef,
  type BackstageCredentials,
  type PermissionsService,
} from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import { InputError } from '@backstage/errors';
import {
  AuthorizeResult,
  createPermission,
} from '@backstage/plugin-permission-common';
import type {
  EntitlementDefinition,
  EntitlementDecision,
} from '@ansible/portal-extension-common';

export type { EntitlementDecision } from '@ansible/portal-extension-common';

/** Trusted deployment context. No client input or user-namespace inference. */
export interface ActiveOrganizationResolver {
  resolve(credentials: BackstageCredentials): Promise<string | undefined>;
}

export class ConfiguredOrganizationResolver implements ActiveOrganizationResolver {
  constructor(private readonly config: Config) {}
  async resolve(
    _credentials: BackstageCredentials,
  ): Promise<string | undefined> {
    return (
      this.config.getOptionalString('portal.organization.id')?.trim() ||
      undefined
    );
  }
}

/** Availability gates complement Backstage permissions; they never grant RBAC. */
export class PortalEntitlements {
  private readonly definitions = new Map<string, EntitlementDefinition>();
  constructor(
    private readonly config: Config,
    private readonly organizations: ActiveOrganizationResolver,
  ) {}

  register(
    pluginId: string,
    definitions: readonly EntitlementDefinition[],
  ): void {
    const ids = new Set<string>();
    for (const definition of definitions) {
      if (
        !/^[a-z][a-z0-9-]*$/.test(pluginId) ||
        !definition.id.startsWith(`${pluginId}.`) ||
        definition.id.length <= pluginId.length + 1 ||
        !definition.permissionName.trim() ||
        !['global', 'organization'].includes(definition.scope)
      ) {
        throw new InputError(
          'Entitlements require owner-prefixed IDs, a permission, and a supported scope',
        );
      }
      if (ids.has(definition.id) || this.definitions.has(definition.id))
        throw new InputError(`Duplicate entitlement: ${definition.id}`);
      ids.add(definition.id);
    }
    definitions.forEach(definition =>
      this.definitions.set(definition.id, { ...definition }),
    );
  }

  async check(
    id: string,
    credentials: BackstageCredentials,
    permissions: PermissionsService,
  ): Promise<EntitlementDecision> {
    const principal = credentials.principal;
    if (
      !principal ||
      typeof principal !== 'object' ||
      !('type' in principal) ||
      principal.type !== 'user'
    )
      return { allowed: false };
    const definition = this.definitions.get(id);
    if (!definition) return { allowed: false };
    try {
      const organizationId = await this.organizations.resolve(credentials);
      const denied = { allowed: false, organizationId };
      if (definition.scope === 'organization' && !organizationId) return denied;
      const grants =
        this.config.getOptionalConfigArray('portal.entitlements.grants') ?? [];
      const available = grants.some(grant => {
        if (grant.getString('id') !== id) return false;
        const organizations = grant.getStringArray('organizations');
        return (
          organizations.includes('*') ||
          (definition.scope === 'organization' &&
            !!organizationId &&
            organizations.includes(organizationId))
        );
      });
      if (!available) return denied;
      const [decision] = await permissions.authorize(
        [
          {
            permission: createPermission({
              name: definition.permissionName,
              attributes: { action: 'read' },
            }),
          },
        ],
        { credentials },
      );
      return {
        allowed: decision?.result === AuthorizeResult.ALLOW,
        organizationId,
      };
    } catch {
      // Missing/invalid policy, organization resolution, and permission errors deny.
      return { allowed: false };
    }
  }
}

export const portalActiveOrganizationServiceRef =
  createServiceRef<ActiveOrganizationResolver>({
    id: 'portal.active-organization',
    scope: 'root',
    defaultFactory: async service =>
      createServiceFactory({
        service,
        deps: { config: coreServices.rootConfig },
        factory: async ({ config }) =>
          new ConfiguredOrganizationResolver(config),
      }),
  });

export const portalEntitlementsServiceRef =
  createServiceRef<PortalEntitlements>({
    id: 'portal.entitlements',
    scope: 'root',
    defaultFactory: async service =>
      createServiceFactory({
        service,
        deps: {
          config: coreServices.rootConfig,
          organizations: portalActiveOrganizationServiceRef,
        },
        factory: async ({ config, organizations }) =>
          new PortalEntitlements(config, organizations),
      }),
  });
