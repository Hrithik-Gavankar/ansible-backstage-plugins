# @ansible/portal-plugin-sdk

Shared frontend web library for Portal contributors. Source:
`workspaces/portal-core/plugins/portal-plugin-sdk`.

## Reusable functionality

- Page headers, dialogs, empty states, links, and loading components.
- Notification stack and synchronization polling utilities.
- Pagination, cache, and subscription utilities.
- Context/authorization hooks, icons, styles, and theme utilities.

The SDK is not a host page plugin and does not register native contributions.
Use [portal-extension-api](portal-extension-api.md) for Blueprint declarations
and [portal-extension-host](portal-extension-host.md) for host rendering.

## Styling and ownership

Prefer shared components and theme-adaptive tokens over importing private RHDH
UI implementation details. Synchronization/cache integration uses injected
callbacks rather than direct imports of a content plugin.

See [design tokens](../next/portal-sdk-design-tokens.md) and the
[implementation guide](../next/portal-plugin-factory-implementation-guide.md)
for the remaining content-client and picker boundary.
