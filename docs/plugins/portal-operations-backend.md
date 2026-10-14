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

The same injected resolver supplies operation contexts and entitlement decisions.
The dispatcher rejects missing or inconsistent organization scope and enforces
every backend descriptor's `requiredEntitlements` before invoking its handler.
APME scanning declares `apme.scanning`. Registration and deregistration remain
available without that scanning entitlement, subject to their own permissions.

### Minimal policy

For a deployment whose resolver returns `default`:

```yaml
portal:
  organization:
    id: default
  entitlements:
    grants:
      - id: apme.scanning
        organizations: [default]
```

The AAP adapter, when installed, resolves organization from trusted AAP provider
configuration instead of the generic `portal.organization.id` resolver. Use its
resolved canonical ID in grants and mappings; the identity namespace and SCM
repository owner are not substitutes.

### Catalog namespace compatibility

For a resolver returning `engineering`, with existing repositories in `default`:

```yaml
portal:
  organization:
    id: engineering
    catalogMappings:
      - organizationId: engineering
        namespaces: [default, engineering]
  entitlements:
    grants:
      - id: apme.scanning
        organizations: [engineering]
```

The first mapped namespace is used for new manual registrations. Other mapped
namespaces allow legacy subjects without rewriting entity references. New manual
records carry the trusted `ansible.io/portal-organization` annotation; a conflicting
annotation denies access even inside an allowed namespace. Existing unannotated
records are accepted only inside the organization's allowed partition.

Without a mapping, only the namespace equal to the resolved organization is
accepted. Empty, invalid, duplicate, or overlapping mappings deny access; one
namespace cannot belong to multiple organizations. Mappings do not grant catalog
read permission or prove user membership. They are backend-only host policy.

### Interactive workflow boundaries

APME operation submission, approval, state/events, and remediation submission
authorize the trusted organization, scanning entitlement, and catalog repository
before forwarding gateway requests or resolving SCM credentials. Mutating
requests additionally require the scan operation permission. Read-only
state/event requests do not require that mutation permission.

This does not migrate every legacy settings route, change automatic scan policy,
partition gateway storage, or revoke running jobs when a grant changes.

### Troubleshooting

**Operation denied although the action is visible:** check backend descriptor
requirements, registered entitlement definitions, grants for the resolved
organization, operation permission, and the handler's resource checks.

**Default-namespace repository denied for another organization:** verify the
trusted resolver's canonical ID and configure an intentional `catalogMappings`
entry. Do not derive it from the user's namespace or broadly bypass resource
authorization. Re-export affected dynamic consumers and restart the backend
after changing contracts or policy configuration.

See [NFS composition](../next/portal-sdk-nfs-composition.md) for frontend checks
and [portal-plugin-node](portal-plugin-node.md) for service contracts.
