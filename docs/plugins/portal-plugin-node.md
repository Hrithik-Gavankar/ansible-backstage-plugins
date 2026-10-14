# @ansible/portal-plugin-node

Node library for Portal contributor backends. Source:
`workspaces/portal-core/plugins/portal-plugin-node`.

## Backend infrastructure

- `createPortalPlugin`: scoped health and audit helpers.
- `portalOperationsServiceRef`: shared operation registration and execution.
- `portalEntitlementsServiceRef` and `portalActiveOrganizationServiceRef`:
  host entitlement and active-organization decisions.
- `portalHealthServiceRef`: shared push-based health reporting.
- Identity middleware, audit emission, and `withOrganization` helpers.
- `resolvePortalContext`: authenticated user identity plus injected active
  organization, independent of user namespace.
- `organizationCatalogNamespaces` and `assertEntityOrganization`: explicit
  catalog partition policy, including legacy namespace mappings and conflicting
  organization annotation checks.

## Operation and context requirements

Inject `portalOperationsServiceRef` instead of constructing a private dispatcher.
Its service dependencies include the active-organization resolver and entitlement
service. For isolated tests, `new PortalOperations(logger, organizations,
entitlements)` requires both dependencies; there is no permissive fallback.

Backend operation descriptors declare `requiredEntitlements` separately from
frontend presentation requirements. The dispatcher verifies organization context,
operation permission, and every declared entitlement before running the handler.
Handlers still own resource permissions, supported content checks, and domain
authorization.

Identity middleware requires `organizations`, injected from
`portalActiveOrganizationServiceRef`. The deprecated `defaultOrgId` option is
ignored. If identity or organization resolution fails, the middleware clears
`portalContext`; protected routes must reject a missing context.

## Usage boundaries

Inject host services into backend modules rather than creating independent
registries in each dynamically loaded package. Presentation belongs to frontend
contributions; registered operations can serve multiple UI surfaces.

Identity and organization helpers do not imply a complete multi-organization
session model. The current host resolver uses trusted server configuration.
Audit emission does not imply a durable external audit store.

See [operations backend](portal-operations-backend.md),
[health backend](portal-health-backend.md), and the
[implementation guide](../next/portal-plugin-factory-implementation-guide.md).
