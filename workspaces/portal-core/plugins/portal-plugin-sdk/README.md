# @ansible/portal-plugin-sdk

Frontend SDK for building Automation Portal plugins. Provides shared React components, hooks, and design utilities for any plugin that contributes capabilities into the Portal.

## When to use this package

- You are writing a **frontend plugin** and need shared UI components (page headers, empty states, loaders).
- You need `usePortalContext()` to access the current organization ID.
- You need `useIsSuperuser()` to gate UI features behind AAP superuser status.
- You need the `AppThemeFixer` or `RhaapThemeProvider` for MUI theme setup.

## Installation

```bash
yarn workspace my-plugin add @ansible/portal-plugin-sdk
```

## Components

### `PageHeaderSection`

Standard page header with title, subtitle, icon, and optional action slot. Extracted from `self-service` — use this instead of building your own heading layout.

```tsx
import { PageHeaderSection } from '@ansible/portal-plugin-sdk';

<PageHeaderSection
  title="My Plugin"
  subtitle="Description of what this page does."
  icon={<MyIcon />}
  action={<Button variant="contained">Create</Button>}
/>;
```

### `EmptyState`

Consistent empty-state illustration and messaging for list pages with no results:

```tsx
import { EmptyState } from '@ansible/portal-plugin-sdk';

<EmptyState
  title="No items found"
  description="Create your first item to get started."
  action={<Button>Create</Button>}
/>;
```

### `SkeletonLoader`

Loading placeholder that matches the Portal's card and list layouts:

```tsx
import { SkeletonLoader } from '@ansible/portal-plugin-sdk';

if (loading) return <SkeletonLoader count={4} />;
```

### `SyncDialog` / `SyncProgressPopover`

Dialog and popover for showing background sync progress. Used by pages that trigger long-running AAP sync operations:

```tsx
import { SyncDialog, SyncProgressPopover } from '@ansible/portal-plugin-sdk';
```

### `EntityLinkButton`

Renders a Backstage entity reference as a clickable link button:

```tsx
import { EntityLinkButton } from '@ansible/portal-plugin-sdk';

<EntityLinkButton entityRef="component:default/my-service" />;
```

### `ScmIntegrationAuthError`

Standard error state for SCM integration auth failures:

```tsx
import { ScmIntegrationAuthError } from '@ansible/portal-plugin-sdk';

if (error?.type === 'auth') return <ScmIntegrationAuthError />;
```

## Hooks

### `usePortalContext()`

Returns the portal context for the current authenticated session.

```tsx
import { usePortalContext } from '@ansible/portal-plugin-sdk';

function MyPluginPage() {
  const { organizationId, loading, error } = usePortalContext();
  if (loading) return <CircularProgress />;
  return <div>Fetching data for org: {organizationId}</div>;
}
```

**Returns:**

| Field            | Type            | Description                                                            |
| ---------------- | --------------- | ---------------------------------------------------------------------- |
| `organizationId` | `string`        | Derived from the user entity ref namespace. Falls back to `'default'`. |
| `loading`        | `boolean`       | True while the identity API call is in-flight.                         |
| `error`          | `Error \| null` | Set if identity resolution fails.                                      |

`organizationId` is the multi-tenancy key for all backend queries. Pass it to your API client instead of deriving it yourself.

### `useIsSuperuser()`

Checks whether the current user has the `aap.platform/is_superuser: "true"` annotation in the catalog. Results are cached for 5 minutes.

```tsx
import { useIsSuperuser } from '@ansible/portal-plugin-sdk';

function AdminOnlyButton() {
  const { isSuperuser, loading } = useIsSuperuser();
  if (loading || !isSuperuser) return null;
  return <Button>Admin action</Button>;
}
```

**Returns:**

| Field         | Type            | Description                                                    |
| ------------- | --------------- | -------------------------------------------------------------- |
| `isSuperuser` | `boolean`       | Whether the current user is an AAP superuser.                  |
| `loading`     | `boolean`       | True while catalog lookup is in-flight.                        |
| `error`       | `Error \| null` | Set if the catalog lookup fails. Defaults to `false` on error. |

The hook retries once after a 3-second delay before setting the error state. If the catalog entity is not yet synced, check `error` and inform the user rather than treating them as a non-superuser.

### `useSyncStatusPolling()`

Polls a sync status endpoint and returns the current sync state. Used internally by `SyncProgressPopover`.

## Theme utilities

### `AppThemeFixer`

Re-export of MUI `CssBaseline`. Add this once to your plugin root to apply consistent baseline styles:

```tsx
import { AppThemeFixer } from '@ansible/portal-plugin-sdk';

function MyPluginRoot() {
  return (
    <>
      <AppThemeFixer />
      <MyPluginContent />
    </>
  );
}
```

### `RhaapThemeProvider`

MUI theme provider configured with the RHAAP colour palette. Wraps the Backstage app in the correct MUI v4 theme:

```tsx
import { RhaapThemeProvider } from '@ansible/portal-plugin-sdk';
```

### CSS design tokens (static)

Static sizing constants exported from `tokens.ts`. Use these for fixed values that do not need theme adaptation:

```ts
import { PORTAL_TOKENS } from '@ansible/portal-plugin-sdk';

// Spacing multipliers (MUI 8px base)
PORTAL_TOKENS.spacing.page; // '24px' — page-level padding
PORTAL_TOKENS.spacing.section; // '16px' — between sections
PORTAL_TOKENS.spacing.card; // '12px' — card internal padding

// Border radii
PORTAL_TOKENS.borderRadius.card; // '4px'
```

For **colour and theme-adaptive values**, use CSS custom properties injected by `ContributionWrapper` (from `@ansible/portal-extension-host`). See `docs/next/portal-sdk-design-tokens.md` for the full reference.

## Notifications

```tsx
import {
  NotificationStack,
  NotificationContext,
  useNotifications,
} from '@ansible/portal-plugin-sdk';

// Wrap your plugin in the notification provider:
<NotificationContext>
  <MyPlugin />
</NotificationContext>;

// Push a notification from anywhere:
const { push } = useNotifications();
push({ severity: 'success', message: 'Job template launched.' });
```

## Styles

Shared `makeStyles` utilities for consistent page layout:

```tsx
import { usePageHeaderStyles } from '@ansible/portal-plugin-sdk';

function MyPage() {
  const classes = usePageHeaderStyles();
  return <div className={classes.pageHeader}>...</div>;
}
```

## Icons

Common icons re-exported to avoid per-plugin icon imports:

```tsx
import {
  AnsibleIcon,
  JobTemplateIcon,
  CollectionIcon,
} from '@ansible/portal-plugin-sdk';
```

## Utils

Shared utility functions:

```ts
import {
  formatDuration,
  truncateText,
  parseEntityRef,
} from '@ansible/portal-plugin-sdk';
```

## Peer dependencies

- `react` ^18.3
- `@material-ui/core` ^4
- `@backstage/core-plugin-api`
- `@backstage/plugin-catalog-react`
- `@backstage/catalog-model`
