import { useState, useEffect } from 'react';
import { useApi, identityApiRef } from '@backstage/core-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';

/**
 * The portal context available to any plugin frontend component.
 *
 * **Roadmap:** `apiClient` (the typed `automation-content-client`) will be
 * added here once `@ansible/automation-content-client` is published by
 * ANSTRAT-1758. Adding a field to this interface is non-breaking for existing
 * consumers.
 */
export interface PortalContext {
  /**
   * The organization identifier for the current session.
   *
   * Derived from the Backstage user entity ref namespace:
   *   `user:red-hat/alice` → `organizationId = "red-hat"`
   *   `user:default/alice` → `organizationId = "default"`
   *
   * All plugin backend DB queries must be keyed by this value.
   * Never accept `organizationId` from request parameters — always read it
   * from the authenticated session (see `portal-plugin-node` middleware).
   */
  organizationId: string;
}

export interface UsePortalContextResult extends PortalContext {
  /** True while the identity API call is in-flight. */
  loading: boolean;
  /** Set if the identity API rejected. `organizationId` falls back to `'default'`. */
  error: Error | null;
}

/**
 * Returns the portal context for the current authenticated session.
 *
 * @example
 * ```tsx
 * import { usePortalContext } from '@ansible/portal-plugin-sdk';
 *
 * function MyPluginPage() {
 *   const { organizationId, loading } = usePortalContext();
 *   if (loading) return <Progress />;
 *   return <div>Org: {organizationId}</div>;
 * }
 * ```
 */
export function usePortalContext(): UsePortalContextResult {
  const identityApi = useApi(identityApiRef);

  const [organizationId, setOrganizationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    identityApi
      .getBackstageIdentity()
      .then(identity => {
        if (!mounted) return;

        const { userEntityRef } = identity;

        if (!userEntityRef) {
          // Guest or unauthenticated — fall back to 'default'
          setOrganizationId('default');
          setLoading(false);
          return;
        }

        const { namespace } = parseEntityRef(userEntityRef);
        setOrganizationId(namespace ?? 'default');
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        // eslint-disable-next-line no-console
        console.error(
          '[usePortalContext] Failed to resolve portal context:',
          err instanceof Error ? err.message : err,
        );
        setError(
          err instanceof Error
            ? err
            : new Error('Failed to resolve portal context'),
        );
        setOrganizationId('default');
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [identityApi]);

  return { organizationId, loading, error };
}
