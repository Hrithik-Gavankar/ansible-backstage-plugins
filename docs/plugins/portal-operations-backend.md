# @ansible/portal-operations-backend

Backend plugin for authorized Portal operation dispatch and entitlement
decisions. Source: `workspaces/portal-core/plugins/portal-operations-backend`.

## Integration

The `./alpha` backend feature loader installs the host-owned operation,
entitlement, and health services once, then loads the backend plugin:

```ts
backend.add(import('@ansible/portal-operations-backend/alpha'));
```

Contributor backends register operations through `portalOperationsServiceRef`.
The host dispatches operation IDs with authenticated context and current subjects,
not contributor-supplied handler URLs.

## Organization and entitlement policy

`portal.organization.id` supplies a trusted single-organization context when
configured. Entitlement grants under `portal.entitlements.grants` declare
organization IDs or `'*'`. A missing grant denies entitlement; a grant does
not replace RBAC. The AAP organization adapter can resolve the deployment's
configured organization; this is not a user organization switcher.

See [NFS composition](../next/portal-sdk-nfs-composition.md) for frontend checks
and [portal-plugin-node](portal-plugin-node.md) for service contracts.
