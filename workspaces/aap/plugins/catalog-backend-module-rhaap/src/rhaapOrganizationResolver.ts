import {
  coreServices,
  createServiceFactory,
  type BackstageCredentials,
} from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import { resolveActiveOrganizations } from '@ansible/backstage-rhaap-common';
import {
  portalActiveOrganizationServiceRef,
  type ActiveOrganizationResolver,
} from '@ansible/portal-plugin-node';

/** Deployment adapter: AAP names are normalized by the existing provider contract. */
export class RhaapOrganizationResolver implements ActiveOrganizationResolver {
  constructor(private readonly config: Config) {}

  async resolve(
    _credentials: BackstageCredentials,
  ): Promise<string | undefined> {
    try {
      const providers = this.config.getOptionalConfig(
        'catalog.providers.rhaap',
      );
      if (!providers || providers.keys().length === 0) return undefined;
      const organizations = new Set<string>();
      for (const key of providers.keys()) {
        const provider = providers.getConfig(key);
        // The provider helper defaults malformed/missing orgs to "default".
        // Entitlements must not turn a configuration error into an authorization context.
        const raw = provider.getOptional('orgs');
        const names = typeof raw === 'string' ? raw.split(',') : raw;
        if (
          !Array.isArray(names) ||
          names.length === 0 ||
          names.some(name => typeof name !== 'string' || !name.trim())
        )
          return undefined;
        resolveActiveOrganizations(provider).forEach(name =>
          organizations.add(name),
        );
      }
      // Multiple providers may agree on one organization. Never choose between active orgs.
      return organizations.size === 1 ? [...organizations][0] : undefined;
    } catch {
      return undefined;
    }
  }
}

export const rhaapOrganizationServiceFactory = createServiceFactory({
  service: portalActiveOrganizationServiceRef,
  deps: { config: coreServices.rootConfig },
  factory: async ({ config }) => new RhaapOrganizationResolver(config),
});
