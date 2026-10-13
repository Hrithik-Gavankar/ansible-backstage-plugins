# @ansible/portal-plugin-node

Server-side SDK for Ansible portal backend plugins. Provides identity middleware, push-based health reporting, structured audit logging, and org-keyed database helpers.

## When to use this package

- You are writing a **backend plugin** (Backstage backend module or Express router) that participates in the Portal ecosystem.
- You need to attach `req.portalContext` (organization ID, user ref) to authenticated requests.
- You want to report plugin health to the aggregated health endpoint.
- You want to emit structured audit log entries for state-changing operations.
- You need to scope database queries by organization ID.

## Installation

```bash
yarn workspace my-backend-plugin add @ansible/portal-plugin-node
```

## Quick start

```ts
import { createPortalPlugin } from '@ansible/portal-plugin-node';

// Create once per backend module
const portalPlugin = createPortalPlugin({ pluginId: 'my-plugin' });

// In your Backstage backend module init:
export const myBackendModule = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'my-module',
  register(reg) {
    reg.registerInit({
      deps: { logger, httpAuth, userInfo, scheduler },
      async init({ logger, httpAuth, userInfo }) {
        // Configure logger and attach identity middleware to your router
        const middleware = portalPlugin.createMiddleware({
          httpAuth,
          userInfo,
          logger,
        });
        router.use(middleware);

        // Signal readiness after workers are initialized
        portalPlugin.pushHealthStatus({
          state: 'READY',
          message: 'Workers healthy.',
        });
      },
    });
  },
});
```

## API

### `createPortalPlugin(options)`

Factory that returns a `PortalPlugin` instance. Create one instance per backend plugin module — the instance wraps a shared `HealthRegistry` keyed by `pluginId`.

```ts
const portalPlugin = createPortalPlugin({ pluginId: 'my-plugin' });
```

**Options:**

| Field      | Type     | Description                                                                                                                                                 |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginId` | `string` | Unique stable ID. Convention: `'<team>-<domain>'` (e.g. `'apme'`, `'content-quality'`). Used as the health registry key and `plugin` field in audit events. |

### `PortalPlugin`

The object returned by `createPortalPlugin`. All methods are documented below.

#### `.createMiddleware(options)`

Creates an Express `RequestHandler` that attaches `req.portalContext` to every authenticated request.

```ts
const middleware = portalPlugin.createMiddleware({
  httpAuth,
  userInfo,
  logger,
});
router.use(middleware);
```

Also configures the plugin's audit emitter with the provided logger.

**Options:**

| Field           | Type              | Description                                                                |
| --------------- | ----------------- | -------------------------------------------------------------------------- |
| `httpAuth`      | `HttpAuthService` | Backstage HTTP auth service                                                |
| `userInfo`      | `UserInfoService` | Backstage user info service                                                |
| `logger`        | `LoggerService`   | Logger for auth failures                                                   |
| `defaultOrgId?` | `string`          | Org ID to use when user namespace is `'default'`. Defaults to `'default'`. |

The middleware never blocks unauthenticated requests — route handlers must check for `req.portalContext` when they require it.

**TypeScript augmentation:** Declare `req.portalContext` in your module:

```ts
// In a .d.ts file or at the top of your router file:
declare global {
  namespace Express {
    interface Request {
      portalContext?: PortalContext;
    }
  }
}
```

#### `.pushHealthStatus(status)`

Pushes a health status update to the process-level `HealthRegistry`.

```ts
// Signal healthy:
portalPlugin.pushHealthStatus({
  state: 'READY',
  message: 'Sync workers healthy.',
});

// Signal degraded (e.g. partial sync failure):
portalPlugin.pushHealthStatus({
  state: 'DEGRADED',
  message: 'Sync failed for org: acme.',
});

// Signal unavailable:
portalPlugin.pushHealthStatus({
  state: 'UNAVAILABLE',
  message: 'DB connection lost.',
});
```

Health states:

| State         | When to use                                                  |
| ------------- | ------------------------------------------------------------ |
| `READY`       | Plugin initialized and all workers are running               |
| `DEGRADED`    | Plugin is running but some functionality is reduced          |
| `UNAVAILABLE` | Plugin failed to initialize or a critical dependency is down |
| `UNKNOWN`     | Initial state before the plugin has reported                 |

The status is readable via `GET /api/portal-health/status` (provided by `@ansible/portal-health-backend`).

**Deduplication pattern:** Track failure state to avoid pushing `DEGRADED` on every recurring failure:

```ts
let wasDegraded = false;

// In your sync error handler:
if (!wasDegraded) {
  portalPlugin.pushHealthStatus({
    state: 'DEGRADED',
    message: `Sync failed: ${err.message}`,
  });
  wasDegraded = true;
}

// In your sync recovery handler:
if (wasDegraded) {
  portalPlugin.pushHealthStatus({ state: 'READY', message: 'Sync recovered.' });
  wasDegraded = false;
}
```

#### `.emitAuditEvent(event)`

Emits a structured audit log entry. Requires a logger (call `createMiddleware` or `withLogger` first).

```ts
portalPlugin.emitAuditEvent({
  operationId: 'my-plugin.jobs.launch',
  userId: req.portalContext!.userId,
  organizationId: req.portalContext!.organizationId,
  input: { jobTemplateId, extraVars },
  outcome: 'SUCCESS',
  resourceRef: `job-template:${jobTemplateId}`,
});
```

**`AuditEvent` fields:**

| Field            | Type                                 | Required | Description                                                 |
| ---------------- | ------------------------------------ | -------- | ----------------------------------------------------------- |
| `operationId`    | `string`                             | ✓        | Dot-namespaced operation ID, e.g. `'my-plugin.jobs.launch'` |
| `userId`         | `string`                             | ✓        | User entity ref from `req.portalContext`                    |
| `organizationId` | `string`                             | ✓        | Org ID from `req.portalContext`                             |
| `outcome`        | `'SUCCESS' \| 'FAILURE' \| 'DENIED'` | ✓        | Result of the operation                                     |
| `input`          | `Record<string, unknown>`            | —        | Sanitized input parameters                                  |
| `resourceRef`    | `string`                             | —        | Stable reference to the affected resource                   |
| `error`          | `string`                             | —        | Error message on `FAILURE` outcome                          |

#### `.withLogger(logger)`

Configures the audit emitter with a logger. Call this if you need to emit audit events before calling `createMiddleware`.

```ts
const portalPlugin = createPortalPlugin({ pluginId: 'my-plugin' }).withLogger(
  logger,
);
```

Returns the same `PortalPlugin` instance for chaining.

#### `.getHealthStatus()`

Returns the current `HealthStatus` for this plugin:

```ts
const status = portalPlugin.getHealthStatus();
// { state: 'READY', message: 'Workers healthy.' }
```

### `createIdentityMiddleware(options)` / `parseEntityRef(ref)`

Lower-level exports if you need to create the identity middleware without a `PortalPlugin` wrapper:

```ts
import { createIdentityMiddleware } from '@ansible/portal-plugin-node';
const middleware = createIdentityMiddleware({ httpAuth, userInfo, logger });
```

### `HealthRegistry` / `getAllHealthStatuses()`

The `HealthRegistry` is a process-level singleton keyed by `pluginId`. The host's `portal-health-backend` plugin reads from it to serve the aggregated health endpoint.

```ts
import { getAllHealthStatuses } from '@ansible/portal-plugin-node';

// Returns Record<string, HealthStatus> for all registered plugins
const snapshot = getAllHealthStatuses();
```

### `withOrganization(db, orgId, fn)`

Org-keyed database helper that wraps a Knex transaction and enforces every query carries the `organizationId` key.

```ts
import { withOrganization } from '@ansible/portal-plugin-node';

const results = await withOrganization(
  db,
  req.portalContext!.organizationId,
  async knex => {
    return knex('my_table')
      .where({ org_id: knex.raw('?', [orgId]) })
      .select('*');
  },
);
```

### `AuditEmitter`

The class backing `emitAuditEvent`. For advanced use cases, instantiate directly:

```ts
import { AuditEmitter } from '@ansible/portal-plugin-node';

const emitter = new AuditEmitter('my-plugin', logger);
emitter.emit({ operationId: 'my-plugin.items.delete', ... });
```

## Types

```ts
import type {
  CreatePortalPluginOptions,
  PortalPlugin,
  PortalContext,
  HealthStatus,
  HealthState,
  AuditEvent,
  AuditOutcome,
  IdentityMiddlewareOptions,
} from '@ansible/portal-plugin-node';
```

## Health status in the backend

Plugin health is exposed by `@ansible/portal-health-backend` at `GET /api/portal-health/status`. Register the plugin in your backend:

```ts
// packages/backend/src/index.ts
backend.add(import('@ansible/portal-health-backend'));
```

The frontend `PortalHealthStatus` component (from `@ansible/portal-extension-host`) polls this endpoint and renders the results. See that package's README for usage.

## Peer dependencies

- `express` ^4
- `@backstage/backend-plugin-api`
