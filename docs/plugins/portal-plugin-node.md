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
