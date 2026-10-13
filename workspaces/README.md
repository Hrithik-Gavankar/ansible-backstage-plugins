# Workspaces — Plugin Architecture Overview

This directory contains four workspaces. Each workspace is a self-contained Yarn
sub-project. Plugins within a workspace share a `node_modules` tree; plugins
across workspaces connect through typed package imports declared as
`peerDependencies` or `dependencies`.

```
workspaces/
├── portal-core/     SDK and host infrastructure (extension system, SDKs, RHDH singleton)
├── self-service/    User-facing automation flows (portal-scaffolder, templates, pickers)
├── apme/            Automation Platform Management Experience (quality scanning, gateway)
└── aap/             AAP integration layer (catalog sync, auth, scaffolder actions)
```

---

## How the workspaces relate

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  portal-core workspace                                                          │
│                                                                                 │
│  portal-extension-common  ←─ serializable types (no React, no Node)            │
│          │                                                                      │
│          ├──▶  portal-extension-api   ←─ frontend: registry + hooks + helpers  │
│          │            │                                                         │
│          │            └──▶  portal-extension-host  ←─ rendering runtime        │
│          │                          │                                           │
│          │                          └──▶  portal-core  ←─ RHDH MF singleton   │
│          │                                                                      │
│          ├──▶  portal-plugin-sdk    ←─ shared UI components, usePortalContext  │
│          │                                                                      │
│          └──▶  portal-plugin-node   ←─ backend SDK (middleware, health, audit) │
└───────────────────────────────────────────────────────────────────────────────┬─┘
                                                                                │
            ┌───────────────────────────────────────────────────────────────────┘
            │  all content plugins import from portal-core packages
            ▼
┌───────────────────────────┐    ┌───────────────────────────┐
│  self-service workspace   │    │  apme workspace           │
│                           │    │                           │
│  portal-scaffolder        │    │  plugin-backstage-apme    │
│    (frontend-plugin)      │    │    (frontend-plugin)      │
│                           │    │                           │
│  Depends on:              │    │  Depends on:              │
│  • portal-extension-api   │    │  • portal-extension-api   │
│  • portal-extension-host  │    │  • portal-plugin-sdk      │
│  • portal-plugin-sdk      │    │  • backstage-apme-common  │
│  • backstage-rhaap-common │    │  • backstage-rhaap-common │
└───────────────────────────┘    │                           │
                                 │  catalog-backend-module-  │
                                 │  apme (backend-plugin)    │
                                 │                           │
                                 │  Depends on:              │
                                 │  • portal-extension-common│
                                 │  • backstage-apme-common  │
                                 │  • portal-plugin-node     │
                                 │                           │
                                 │  backstage-apme-common    │
                                 │    (common-library)       │
                                 │  • APME types, API client │
                                 │  • gateway rules, catalog │
                                 └──────────────┬────────────┘
                                                │
            ┌───────────────────────────────────┘
            │  both self-service and apme depend on
            ▼
┌───────────────────────────────────────────────────┐
│  aap workspace                                    │
│                                                   │
│  backstage-rhaap-common (common-library)          │
│    • AAPClient, IAAPService, AAP types            │
│    • Permissions (git-repositories, collections)  │
│    • SCM client, user provisioner                 │
│                                                   │
│  plugin-backstage-rhaap (frontend-plugin)         │
│    • Ansible sidebar, AnsiblePage                 │
│                                                   │
│  catalog-backend-module-rhaap (backend-plugin)    │
│    • Entity providers (org, job templates, EEs)   │
│                                                   │
│  auth-backend-module-rhaap-provider (backend)     │
│    • AAP OAuth sign-in                            │
│                                                   │
│  scaffolder-backend-module-backstage-rhaap        │
│    • Scaffolder actions (create project, launch   │
│      job template, create EE, clean up, etc.)     │
└───────────────────────────────────────────────────┘
```

---

## Workspace-by-workspace detail

### `portal-core/` — SDK and host infrastructure

The foundation everything else builds on. No business logic — only contracts,
rendering infrastructure, and shared utilities.

| Package                   | Role              | Purpose                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portal-extension-common` | `common-library`  | Serializable plugin contract types. `PluginManifest`, `CapabilityContribution`, `OperationDescriptor`, `CONTENT_TYPES`, `EXTENSION_POINTS`. No React, no Node — safe in both frontend and backend.                                                                                                            |
| `portal-extension-api`    | `web-library`     | Frontend registration SDK. `ContributionRegistry` singleton, `useExtensionTabs/Cards/Actions` hooks, `registerManifest()`, convenience helpers (`registerGitRepoDetailTab` etc.). Re-exports all of `portal-extension-common`.                                                                                |
| `portal-extension-host`   | `web-library`     | Rendering runtime. `ExperienceSlot`, `ExtensionRenderer`, `ErrorBoundary`, `DynamicExtensionDiscovery`, manifest validation, `ContributionWrapper` (CSS token injection), `PortalHealthStatus` (health dashboard), `SettingsShell` (RJSF settings form). Used by host pages, not by content plugins directly. |
| `portal-core`             | `frontend-plugin` | RHDH module federation singleton provider. No UI — its sole job is to bundle `portal-extension-api` and `portal-extension-host` into one MF remote so all portal plugins share a single `ContributionRegistry` instance. Must load first in `dynamic-plugins.yaml`.                                           |
| `portal-plugin-sdk`       | `web-library`     | Shared UI component library for plugin authors. `usePortalContext()` (resolves `organizationId` from Backstage identity), notification utilities, cache helpers, theme tokens, common UI widgets.                                                                                                             |
| `portal-plugin-node`      | `node-library`    | Backend SDK. `createPortalPlugin()` factory providing Express identity middleware (`req.portalContext`), push-based health reporting, structured audit event emission, and org-keyed DB helpers.                                                                                                              |
| `portal-health-backend`   | `backend-plugin`  | Health aggregation endpoint. Exposes `GET /api/portal-health/status` — a JSON snapshot of all registered portal plugin health states from the process-level `HealthRegistry` (populated by `portal-plugin-node`'s `pushHealthStatus()`). Consumed by `PortalHealthStatus` in `portal-extension-host`.         |

**Key rule:** `portal-extension-common` has no React or Node dependency. Any type
that needs to be shared between a frontend plugin and its backend sibling belongs
here. Types that need React (e.g. `ComponentType`, hooks) stay in
`portal-extension-api`.

**Phase 3 components (now implemented):**

- `ContributionWrapper` / `usePortalCssTokens` — injects 10 `--portal-color-*` CSS custom properties derived from `useTheme()` on a `display: contents` wrapper, enabling contributed components to use theme-adaptive colours without importing MUI.
- `PortalHealthStatus` / `usePortalHealthStatus` — polls `portal-health-backend` every 30 s and renders a table of per-plugin health states with coloured status chips.
- `SettingsShell<T>` — generic RJSF v5 form shell for plugin settings pages. Accepts `schema`, `uiSchema`, `onLoad`, and `onSave` callbacks; handles load/save lifecycle, reset, and Backstage alert feedback.

---

### `self-service/` — User automation flows (portal-scaffolder)

The plugin users interact with for creating automation content — templates,
execution environments, collections, git repositories. This is a consumer of the
portal-core SDK, not a provider of it.

| Package             | Role              | Purpose                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portal-scaffolder` | `frontend-plugin` | Main self-service UI. `LandingPage`, `SelfServicePage`, `EEPage`, `CollectionsPage`, `GitRepositoriesPage`. Detail pages (`RepositoryDetailsPage`, `EEDetailsPage`, `CollectionDetailsPage`) render extension tabs/cards from the registry. Also contributes its own tabs and cards back into the registry via `selfServiceManifest.ts`. Scaffolder field extensions (7 custom pickers). |

**Connection to portal-core:** `portal-scaffolder` has `portal-extension-api` and
`portal-extension-host` as `peerDependencies`. It reads contributions from the
registry (via `useExtensionTabs`, `useExtensionActions`) and renders them using
host components (`ExperienceTabContent`, `ExperienceCardSlot`). It does **not**
own the registry — it only reads from and writes to it.

**Connection to aap:** Depends on `backstage-rhaap-common` for AAP API types,
permission definitions (`gitRepositoriesViewPermission`), and SCM utilities.

---

### `apme/` — Automation Platform Management Experience

APME provides content quality scanning, gateway rule management, and AI-assisted
analysis. It is the first third-party contributor to the portal extension system —
APME tabs, cards, and actions appear inside `portal-scaffolder`'s detail pages
without `portal-scaffolder` knowing about APME at compile time.

| Package                       | Role                    | Purpose                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backstage-apme-common`       | `common-library`        | APME-specific shared types. APME API client and service ref, catalog entity types, scan configs, gateway rules, severity models, operation status. Used by both the frontend plugin and the backend module.                                                                                                                                                           |
| `plugin-backstage-apme`       | `frontend-plugin`       | APME UI. Registers tabs (Quality, Activity, Dependencies), overview card, deregister/run-scan actions on the repository detail page, and an "Add repository" list action via `registerApmeExtensions()`. These contributions land in the `ContributionRegistry` at startup and are rendered by `portal-scaffolder`'s `GitRepositoriesPage` without any direct import. |
| `catalog-backend-module-apme` | `backend-plugin-module` | APME catalog integration. Syncs APME project data into the Backstage catalog and provides the API routes that `plugin-backstage-apme` calls.                                                                                                                                                                                                                          |

**Connection to portal-core:** `plugin-backstage-apme` has `portal-extension-api`
as a `peerDependency` (so it gets the shared singleton in RHDH) and imports
`registerGitRepoDetailTab`, `registerGitRepoListAction` etc. from it. The backend
module will use `portal-extension-common` for `PluginManifest` / `OperationDescriptor`
and `portal-plugin-node` for identity middleware and audit events.

**Connection to aap:** Both APME packages depend on `backstage-rhaap-common` for
the `AAPClient` (AAP API calls) and shared permission definitions.

---

### `aap/` — AAP integration layer

The foundational AAP connectivity layer. Every other workspace that talks to
Ansible Automation Platform goes through the types, client, and permissions
defined here.

| Package                                                          | Role                    | Purpose                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backstage-rhaap-common`                                         | `common-library`        | The cross-workspace shared library. `AAPClient` (HTTP client for AAP API), `IAAPService` Backstage service ref, AAP entity types (job templates, EEs, inventories, organizations), SCM client, permission definitions, user provisioner interface. Imported by `portal-scaffolder`, `plugin-backstage-apme`, and all aap plugins. |
| `plugin-backstage-rhaap`                                         | `frontend-plugin`       | Ansible sidebar and `AnsiblePage`. The top-level navigation entry point for Ansible content in the portal.                                                                                                                                                                                                                        |
| `catalog-backend-module-rhaap`                                   | `backend-plugin-module` | Entity providers that sync AAP resources (organizations, job templates, execution environments, collections, git repos) into the Backstage catalog on a schedule.                                                                                                                                                                 |
| `auth-backend-module-rhaap-provider`                             | `backend-plugin-module` | AAP OAuth authentication provider. Signs users in with their AAP credentials via Backstage's auth framework.                                                                                                                                                                                                                      |
| `scaffolder-backend-module-backstage-rhaap`                      | `backend-plugin-module` | Backstage scaffolder actions for AAP: create project, create job template, launch job template, create EE environment, clean up resources, prepare for publish.                                                                                                                                                                   |
| `backstage-plugin-catalog-backend-module-rhaap-user-provisioner` | `backend-plugin-module` | Just-in-time user provisioning: creates Backstage user/group entities for AAP users on first sign-in.                                                                                                                                                                                                                             |

---

## Data flow: how a contribution reaches the page

The following shows what happens when APME registers a "Quality" tab and a user
opens a repository detail page in `portal-scaffolder`:

```
1. RHDH loads portal-core first (dynamic-plugins.yaml load order)
   └─▶ portal-extension-api's ContributionRegistry is in the MF shared scope

2. RHDH loads plugin-backstage-apme
   └─▶ registerApmeExtensions() runs as a side effect
       └─▶ registry.registerTab('rhaap.git-repository.detail.tabs', {
               id: 'apme.quality-tab', label: 'Quality',
               component: lazy(() => import('./ApmeEntityTab')),
               appliesToContentTypes: ['playbook-repository'],
           })

3. User navigates to /self-service/repositories/<repo>
   └─▶ portal-scaffolder's RepositoryDetailsPage mounts

4. useExtensionTabs('rhaap.git-repository.detail.tabs', entity, 'playbook-repository')
   └─▶ reads from the same registry instance (shared via MF)
   └─▶ returns [{ id: 'apme.quality-tab', label: 'Quality', ... }]

5. <ExperienceTabContent contribution={apmeTab} />
   └─▶ portal-extension-host wraps in ContributionWrapper (CSS tokens) + ErrorBoundary + Suspense
   └─▶ lazy ApmeEntityTab renders inside portal-scaffolder's page
   └─▶ ApmeEntityTab can use var(--portal-color-primary) etc. — no MUI import needed
```

`portal-scaffolder` and `plugin-backstage-apme` have no direct compile-time
import relationship. The registry is the only coupling.

**Health data flow** (separate from the contribution rendering path):

```
portal-plugin-node.pushHealthStatus({ state: 'READY', message: '...' })
   └─▶ process-level HealthRegistry (keyed by pluginId)
          └─▶ GET /api/portal-health/status (portal-health-backend)
                 └─▶ usePortalHealthStatus() hook (portal-extension-host)
                        └─▶ <PortalHealthStatus /> renders status table
```

---

## RHDH deployment wiring

In production (RHDH), static imports are replaced by dynamic plugin loading.
The reference overlay is at
`workspaces/portal-core/dynamic-plugins.portal-extension.dev.yaml`.

Key rules:

1. `portal-core` must appear **first** in `dynamic-plugins.yaml` — it provides
   `portal-extension-api` to the MF shared scope before any content plugin loads.
2. `portal-extension-api` and `portal-extension-host` are `peerDependencies` in
   both `portal-scaffolder` and `plugin-backstage-apme` — `rhdh-cli plugin export`
   externalizes them automatically (no bundling, consumed from MF shared scope).
3. `backstage-apme-common` and `backstage-rhaap-common` are embedded (`--embed-package`)
   into their respective frontend plugin bundles — they have no RHDH-side provider.

In development (`yarn start` from `workspaces/portal-core/`), the MF singleton is
unnecessary because Node.js's module cache provides a natural singleton. The static
import of `plugin-backstage-apme` in `App.tsx` triggers `registerApmeExtensions()`
directly.
