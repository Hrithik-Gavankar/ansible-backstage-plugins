import type { RequestHandler } from 'express';
import type {
  HttpAuthService,
  UserInfoService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import type { PortalContext } from './types';

/**
 * Parses a Backstage entity reference and returns its namespace and name.
 *
 * Backstage entity refs have the format `<kind>:<namespace>/<name>`.
 * - `user:default/johndoe` → `{ namespace: 'default', name: 'johndoe' }`
 * - `user:acme-corp/jane.doe` → `{ namespace: 'acme-corp', name: 'jane.doe' }`
 *
 * Falls back to `{ namespace: 'default', name: ref }` for malformed refs
 * rather than throwing — the middleware must never crash the request pipeline.
 */
function parseEntityRef(entityRef: string): {
  namespace: string;
  name: string;
} {
  const match = entityRef.match(/^[^:]+:([^/]+)\/(.+)$/);
  if (!match) {
    return { namespace: 'default', name: entityRef };
  }
  return { namespace: match[1], name: match[2] };
}

export interface IdentityMiddlewareOptions {
  /** Backstage HTTP auth service — resolves credential tokens from requests. */
  httpAuth: HttpAuthService;
  /** Backstage user info service — resolves user entity refs from credentials. */
  userInfo: UserInfoService;
  /** Logger for auth failures and warnings. */
  logger: LoggerService;
  /**
   * `organizationId` to use when the user's entity ref namespace is `'default'`.
   *
   * In single-org deployments, every user is in the `default` namespace and
   * this value is the canonical org ID. Defaults to `'default'`.
   *
   * In multi-org deployments, each org has its own Backstage namespace and
   * this value is not used.
   */
  defaultOrgId?: string;
}

/**
 * Creates an Express middleware that attaches `req.portalContext` to every
 * authenticated request.
 *
 * The middleware resolves the caller's identity from the Backstage auth token
 * and derives `organizationId` from the user entity ref namespace. It never
 * blocks unauthenticated requests — that responsibility belongs to the route
 * handler. If identity resolution fails, `req.portalContext` is left undefined
 * and a warning is logged.
 *
 * **Usage:**
 * ```ts
 * const middleware = createIdentityMiddleware({ httpAuth, userInfo, logger });
 * router.use(middleware);
 *
 * router.get('/data', (req, res) => {
 *   const { organizationId, userId } = req.portalContext!;
 *   // ...
 * });
 * ```
 */
export function createIdentityMiddleware(
  options: IdentityMiddlewareOptions,
): RequestHandler {
  const { httpAuth, userInfo, logger, defaultOrgId = 'default' } = options;

  return async (req, _res, next) => {
    try {
      const credentials = await httpAuth.credentials(req as any, {
        allow: ['user'],
      });
      const info = await userInfo.getUserInfo(credentials);
      const { namespace, name } = parseEntityRef(info.userEntityRef);

      const portalContext: PortalContext = {
        userEntityRef: info.userEntityRef,
        userId: name,
        organizationId: namespace === 'default' ? defaultOrgId : namespace,
      };

      // Cast to any because the global type augmentation may not be seen in
      // all consuming TypeScript configurations.
      (req as any).portalContext = portalContext;
    } catch (err) {
      // Auth failures are common for unauthenticated routes (health checks,
      // public endpoints). Log at debug, not warn, to avoid noisy logs.
      logger.debug(
        `[portal-plugin-node] Could not resolve portal context: ${err}`,
      );
    }

    next();
  };
}

// Re-export the helper for tests that want to verify parsing logic directly.
export { parseEntityRef };
