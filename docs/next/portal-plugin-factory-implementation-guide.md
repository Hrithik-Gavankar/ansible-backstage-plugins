# ANSTRAT-2497 Implementation Guide — Portal Plugin Factory (Self-Service & Portal Core)

> **Jira:** [ANSTRAT-2497](https://redhat.atlassian.net/browse/ANSTRAT-2497) — Portal Plugin Factory: Plugin Development Guide and SDK
> **Team:** Self-service and portal core teams
> **Status:** Active — Phases 1–5, 7 complete; RHDH singleton wiring (portal-core) + dynamic manifest discovery done; Phase 6 blocked on ANSTRAT-1758; NFS slot activation design needed
> **Branch:** `anstrat-2497-poc` in `ansible-backstage-plugins` > **Related:** [ANSTRAT-1758](https://redhat.atlassian.net/browse/ANSTRAT-1758) (Content Management), [PR #712](https://github.com/ansible/ansible-backstage-plugins/pull/712) (migration plan), [AAP-95616](https://redhat.atlassian.net/browse/AAP-95616) (Research Spikes Epic), [AAP-95778](https://redhat.atlassian.net/browse/AAP-95778) (RHDH singleton + Gap 3 spike)
> **Canonical architecture reference:** [Content Experience Architecture](https://github.com/ansible/ansible-rhdh-plugins/blob/portal-plugin-research/.sdlc/research/plugin-factory/Content%20Experience%20Architecture.md) (Ganesh's doc)
>
> This document is the implementation guide for ANSTRAT-2497 within the broader content
> experience architecture. It defines exactly what this Jira ticket owns, how it relates
> to the full architecture, the ordered work packages, and the contracts this team publishes
> for other teams to depend on. It is intended to be referenced inline from the canonical
> architecture document.

---

## 1. What ANSTRAT-2497 Owns

ANSTRAT-2497 is responsible for **how anything plugs into Automation Portal**. From the
canonical architecture (§7.1):

> Self-service and portal core teams own: Shell, experiences, plugin contract, extension
> host, SDK, self-service, scaffolder, auth.

Concretely, this Jira ticket delivers:

1. **`portal-extension-common`** — serialisable plugin manifest, contribution types,
   entitlement definitions, operation descriptors. The schema every plugin publishes.

2. **`portal-extension-api`** — frontend API refs and typed contribution bindings.
   What a frontend plugin imports to register capabilities.

3. **`portal-extension-host`** — the runtime host: experience slots, error boundaries,
   RJSF settings shell, contribution registry, extension renderer.

4. **`portal-plugin-sdk`** — `usePortalContext()`, BUI tokens, RJSF widget registration.
   The enforced path for plugin authors.

5. **`portal-plugin-node`** — identity middleware, audit emit, health push.
   The server-side SDK for plugin backends.

6. **Self-service plugin refactoring** — splitting the current `self-service` monolith,
   naming the remaining plugin `portal-scaffolder`, contributing existing pages as
   first-party capabilities into the host.

7. **The content/self-service boundary** — the contracts that replace today's direct
   imports between self-service and content components (§7.5 of the architecture doc).

**What this ticket does NOT own:**

- Content management primitives, ingestion, trust, OCI adapters → ANSTRAT-1758
- AAP resource sync, auth provider, scaffolder actions → AAP integration team
- Operator / appliance delivery manifest → release engineering (§9.1 of architecture doc)

---

## 2. PoC Baseline

Branch `anstrat-2497-poc` in `ansible-backstage-plugins` is the proof-of-concept.
It validated the core patterns but used preliminary names and made several design
decisions that need updating before production. Full record: `docs/architecture/self-service-extension-sdk.md`.

**What the PoC proved:**

- Module-level singleton registry works for async dynamic plugin late-loading
- Component extraction from self-service with re-export shims preserves backward compatibility
- `useExtensionTabs` subscription + re-render handles RHDH async plugin loading correctly
- CSS custom properties from `useTheme()` give theme-adaptive tokens to non-MUI contributors
- MUI v4 `ThemeProvider` wrapping gives contributed components automatic host theme inheritance

**What the PoC got wrong (resolved in §4):**

- Package names: `backstage-rhaap-*` → `portal-*` / `automation-portal-*`
- Host location: in self-service → in `portal-core` workspace
- `handler()` for server effects → `CapabilityLaunch.operationId` / `workflowId`
- Frozen per-page IDs → experience + capability + entry point model
- Single EE type → definition vs built image split
- `filter?: (entity) => boolean` as sole type gate → `appliesToContentTypes` is primary

---

## 3. Target Package Layout (this ticket's deliverables)

All packages live in `workspaces/portal-core/` in the renamed `automation-portal-plugins`
repo (see §9 for naming and workspace structure).

```
workspaces/portal-core/
├── package.json  yarn.lock  .changeset/
├── packages/
│   ├── app/     # dev harness — portal-core standalone
│   └── backend/
└── plugins/
    ├── portal-theme/                    frontend-plugin
    │     Shell, branding, global nav, base sidebar
    │
    ├── portal-extension-common/         common-library  ← SDK boundary
    │     Serialisable plugin manifest, PluginManifest, CapabilityContribution,
    │     CapabilityEntryPoint, CapabilityLaunch, ExperienceDefinition,
    │     SettingsContribution, EntitlementDefinition, OperationDescriptor.
    │     No React, no Node, no runtime dependencies beyond TypeScript types.
    │
    ├── portal-extension-api/            web-library  ← SDK boundary
    │     Frontend API refs and typed React bindings.
    │     ContributionRegistry (singleton), usePortalExtensions(),
    │     useExtensionTabs(), useExtensionCards(), useExtensionActions(),
    │     registerCapability(), EXPERIENCE_IDS constants.
    │
    ├── portal-extension-host/           frontend-plugin
    │     The runtime host: ExperienceSlot, ExtensionRenderer,
    │     DynamicExtensionDiscovery (RHDH Scalprum), ErrorBoundary per slot,
    │     permission gating, CSS custom property injection.
    │     Depends on portal-extension-api and portal-plugin-sdk.
    │
    ├── portal-plugin-sdk/               web-library  ← SDK boundary
    │     usePortalContext() (organizationId, apiClient, user),
    │     BUI design tokens, RJSF custom widget registration.
    │     What plugin authors import for consistent UI and auth context.
    │
    ├── portal-plugin-node/              node-library  ← SDK boundary
    │     Identity middleware (organizationId, userId from Backstage auth),
    │     audit event emitter, health push to host status registry.
    │     createPortalPlugin(), portalPlugin.middleware.
    │
    └── portal-health-backend/           backend-plugin
          Health aggregation endpoint. GET /api/portal-health/status
          returns a JSON snapshot of all plugin HealthRegistry states
          (populated via portal-plugin-node's pushHealthStatus()).
          Consumed by PortalHealthStatus in portal-extension-host.
```

---

## 4. Design Decisions (Aligned with Architecture)

### 4.1 Plugin manifest model

Every plugin publishes a `PluginManifest`. The host (`portal-extension-host`) validates
it before activation. Invalid or incompatible manifests fail locally without stopping the portal.

```typescript
// from portal-extension-common
export interface PluginManifest {
  id: string;
  version: string;
  /** Host contract version this plugin was built against */
  apiVersion: string;
  capabilities: CapabilityContribution[];
  settings?: SettingsContribution;
  entitlements: EntitlementDefinition[];
  operations?: OperationDescriptor[];
}
```

### 4.2 Experiences (host-owned, not plugin-owned)

The host declares named UX regions. Plugins contribute capabilities _into_ them.
No plugin creates an experience by registering. Unknown `experienceId` values are rejected.

```typescript
// Initial set of experiences (portal-extension-host declares these)
export const EXPERIENCE_IDS = {
  CONTENT_QUALITY: 'content-quality-assessment',
  CONTENT_AUTHORING: 'content-authoring',
  CONTENT_MIGRATION: 'content-migration',
  SELF_SERVICE: 'self-service', // templates, tasks, history
} as const;
```

### 4.3 Capability contributions with typed launches

```typescript
export interface CapabilityContribution {
  id: string;
  ownerPlugin: string;
  experienceId: string; // must match an EXPERIENCE_IDS value
  displayName: string;
  description: string;
  appliesToContentTypes: string[] | '*'; // primary type gate — evaluated statically
  entryPoints: CapabilityEntryPoint[];
  order?: number;
  minimumHostApiVersion: string;
}

export interface CapabilityEntryPoint {
  id: string;
  kind: ContributionKind;
  surface: EntrySurface;
  appliesToContentTypes: string[]; // narrower than capability-level
  label: string;
  launches: CapabilityLaunch; // no handler URL; no arbitrary fetch
  requiredPermission?: PermissionRequirement;
  filter?: (entity: Entity) => boolean; // additional UI predicate only
}

export type LaunchType = 'slot' | 'workflow' | 'operation';

export interface CapabilityLaunch {
  type: LaunchType;
  moduleName?: string; // 'slot': federated module mounted into targetSlot
  targetSlot?: string; // 'slot': named layout zone inside the experience
  workflowId?: string; // 'workflow': host-routed guided flow; no plugin URL
  operationId?: string; // 'operation': registered server-side operation, audited
}
```

**Why no `handler()`:** Any server-side effect goes through `operationId`. The handler
lives on the plugin backend behind permission, audit, and identity pipeline. The plugin
manifest has no `apiEndpoint` or `handlerPath` — this is a security invariant (architecture
doc §9.2, rule 8 from §2.5). Pure UI/navigation (open a dialog, navigate to a route)
may use a thin `onActivate` callback in the `slot` launch type, scoped strictly to UI state.

### 4.4 Content type IDs

The following type IDs are canonical. Plugins use these exact strings in `appliesToContentTypes`.

| Type ID                            | What it is                                                    |
| ---------------------------------- | ------------------------------------------------------------- |
| `collection`                       | Ansible collection (Galaxy v3, Pulp, or OCI artifact)         |
| `execution-environment-definition` | `execution-environment.yml` in source control                 |
| `execution-environment-image`      | Built OCI image with digest, manifest, trust evidence         |
| `playbook-repository`              | Git repository containing playbooks/roles                     |
| `*`                                | Any content type (global settings, non-content surfaces only) |

**`execution-environment-definition` and `execution-environment-image` are two distinct
types.** A definition lists what was _requested_ to be built; an image records what the
build _actually resolved_. Entry points differ: "Build" hangs off a definition; "Trust
signals" and "Content inventory" hang off a built image.

### 4.5 Backward compatibility aliases (current self-service pages)

The current self-service detail pages (`RepositoryDetailsPage`, `CollectionDetailsPage`,
`EEDetailsPage`) are re-registered as capabilities targeting the appropriate experiences
during the transition. The PoC's `EXTENSION_POINTS` constants become compatibility
aliases — they are not the primary API.

| PoC ID (alias, deprecated)                | Target experience + kind                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `rhaap.git-repository.detail.tabs`        | `content-authoring` experience, `page-tab` on `playbook-repository`              |
| `rhaap.collection.detail.tabs`            | `content-quality-assessment` experience, `page-tab` on `collection`              |
| `rhaap.execution-environment.detail.tabs` | `content-authoring` experience, `page-tab` on `execution-environment-definition` |

### 4.6 Developer SDK contracts

```typescript
// portal-plugin-sdk (frontend)
import { usePortalContext, registerWidget } from '@ansible/portal-plugin-sdk';

const { organizationId, apiClient } = usePortalContext();
// apiClient is the typed automation-content-client — the only transport
// organizationId comes from authenticated Backstage session

// portal-plugin-node (backend)
import { createPortalPlugin } from '@ansible/portal-plugin-node';

const portalPlugin = createPortalPlugin({ pluginId: 'my-plugin' });
// req.portalContext.organizationId — from Backstage auth, not caller-supplied
// req.portalContext.userId

portalPlugin.pushHealthStatus({ state: 'READY', message: 'Workers healthy.' });
```

Settings get/save go through registered operation IDs only. No `apiEndpoint` on
`SettingsContribution` — the handler lives on the plugin backend.

### 4.7 Shared module requirement (RHDH)

`portal-extension-api` must be in RHDH `sharedPackages` scope — it is the singleton
registry bus. Plugins declare it as `peerDependency` only, never `--embed-package`.

```yaml
# dynamic-plugins.yaml
sharedPackages:
  - package: '@ansible/portal-extension-api'
    version: '^1.0.0'
```

---

## 5. Ordered Work Packages

Phases below are sequenced by dependency. Each phase produces artifacts other phases
or other teams (ANSTRAT-1758) can build against.

### Phase 1 — Shared component library (`portal-plugin-sdk` frontend subset)

**Output:** `@ansible/portal-plugin-sdk` (or interim `@ansible/backstage-rhaap-react`)
published to the workspace. Component library and hooks that any plugin can import.

**Work (extract from self-service, add new):**

| Item                                                              | Source                                   | Status                                                                                                                                    |
| ----------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeaderSection`                                               | `self-service/components/common/`        | ✅ Done — `backstage-rhaap-react/src/components/PageHeaderSection/`                                                                       |
| `SyncDialog`, `SyncProgressPopover`                               | `self-service/components/common/`        | ✅ Done — `backstage-rhaap-react/src/components/SyncDialog/`, `SyncProgressPopover/`                                                      |
| `EmptyState`, `EntityLinkButton`, `SkeletonLoader`                | `self-service/components/common/`        | ✅ Done — `backstage-rhaap-react/src/components/`                                                                                         |
| `ScmIntegrationAuthError`                                         | `self-service/components/common/`        | ✅ Done — `backstage-rhaap-react/src/components/ScmIntegrationAuthError/`                                                                 |
| `NotificationProvider`, `NotificationStack`, `notificationStore`  | `self-service/components/notifications/` | ✅ Done — `backstage-rhaap-react/src/notifications/`                                                                                      |
| `syncPollingService` (DI callbacks)                               | `self-service/components/notifications/` | ✅ Done — `addInvalidator(fn)` callback DI implemented in `syncPollingService.ts`                                                         |
| `PaginatedEntityCache`, `usePagination`, `useCacheSubscription`   | `self-service/components/common/cache/`  | ✅ Done — `backstage-rhaap-react/src/cache/`                                                                                              |
| `useIsSuperuser`, `useSyncStatusPolling`                          | `self-service/hooks/`                    | ✅ Done — `backstage-rhaap-react/src/hooks/`                                                                                              |
| Style hooks, icons, types, constants                              | `self-service/components/common/`        | ✅ Done — `backstage-rhaap-react/src/styles/`, `icons/`, `types.ts`, `utils/constants.ts`                                                 |
| `RhaapThemeProvider` (MUI v4 → `PortalThemeProvider`)             | New                                      | ✅ Done — `backstage-rhaap-react/src/theme/RhaapThemeProvider.tsx`; rename to `PortalThemeProvider` in Phase 7                            |
| Static design tokens (`rhaapTokens`)                              | New                                      | ✅ Done — `backstage-rhaap-react/src/theme/tokens.ts`                                                                                     |
| CSS custom properties from `useTheme()` (`--portal-color-*` vars) | New                                      | ✅ Done — `ContributionWrapper` in `portal-extension-host` injects 10 `--portal-color-*` vars; `tokens.ts` has full JSDoc reference table |
| `usePortalContext()` (organizationId, apiClient)                  | New                                      | ⚠️ Partial — `organizationId` done (`portal-plugin-sdk/src/hooks/usePortalContext.ts`); `apiClient` blocked on ANSTRAT-1758               |
| BUI design tokens                                                 | New                                      | ❌ Not started                                                                                                                            |
| RJSF widget registration                                          | New                                      | ❌ Not started                                                                                                                            |
| Re-export shims in self-service                                   | New                                      | ✅ Done — `self-service/src/components/common/index.ts`, `notifications/index.ts`, etc. re-export from `backstage-rhaap-react`            |
| **Fix PoC test failures**                                         | —                                        | ✅ Done — all 196 suites, 3961 tests passing                                                                                              |

**Prerequisite:** ~~Refactor `syncPollingService` to accept cache-invalidation callbacks
(currently hardcodes `invalidateCollections` and `gitReposCache` imports).~~ Done — `addInvalidator(fn)` DI is implemented.

---

### Phase 2 — Extension contracts (`portal-extension-common` + `portal-extension-api`)

**Output:** `@ansible/portal-extension-common` and `@ansible/portal-extension-api`
published to the workspace. The contracts other plugins and the host depend on.

**Work:**

| Item                                                                 | Notes                                         | Status                                                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PluginManifest`, `CapabilityContribution`, `CapabilityEntryPoint`   | Per §4.1–4.3                                  | ✅ Done — `backstage-rhaap-extension-api/src/manifest.ts` has complete type definitions                                                                |
| `CapabilityLaunch` (`slot \| workflow \| operation`)                 | Replaces `handler()` for server effects       | ✅ Done — discriminated union `SlotLaunch \| WorkflowLaunch \| OperationLaunch`; `followOn` on `OperationLaunch`; `contentType` on `ActionContext`     |
| `ExperienceDefinition`, `EXPERIENCE_IDS`                             | Per §4.2                                      | ✅ Done — `SELF_SERVICE` removed (portal-scaffolder is a plugin, not a host experience); three experiences declared                                    |
| `registerManifest()` + `subscribeToManifests()`                      | Dynamic discovery (Gap 3)                     | ✅ Done — `registry.ts` + top-level export; replay-on-subscribe; `DynamicExtensionDiscovery` subscribes automatically                                  |
| `appliesToContentTypes` on all contribution types                    | Per §4.4                                      | ✅ Done — on `TabContribution`, `CardContribution`, `ActionContribution` (types.ts) and `CapabilityContribution`, `CapabilityEntryPoint` (manifest.ts) |
| `SettingsContribution` (operationId-based, no apiEndpoint)           | Per §4.6                                      | ✅ Done — `manifest.ts`                                                                                                                                |
| `EntitlementDefinition`                                              | Per §4.6                                      | ✅ Done — `manifest.ts`                                                                                                                                |
| `OperationDescriptor` (stub — full impl is ANSTRAT-1758)             | Enough for `operationId` references           | ✅ Done — stub in `manifest.ts`; full execution mode / idempotency fields deferred to Phase 5                                                          |
| `ContributionRegistry` singleton                                     | ✅ Done (PoC) — rename + move to this package | ✅ Done — `backstage-rhaap-extension-api/src/registry.ts`; moves to `portal-extension-api` package in Phase 7                                          |
| `EXTENSION_POINTS` constants as compatibility aliases                | Per §4.5                                      | ✅ Done — `backstage-rhaap-extension-api/src/extensionPoints.ts`                                                                                       |
| `CONTENT_TYPES` constants                                            | Per §4.4                                      | ✅ Done — `extensionPoints.ts`                                                                                                                         |
| `useExtensionTabs`, `useExtensionCards`, `useExtensionActions` hooks | ✅ Done (PoC)                                 | ✅ Done — `backstage-rhaap-extension-api/src/hooks/index.ts`                                                                                           |
| Convenience registration helpers                                     | ✅ Done (PoC)                                 | ✅ Done — `backstage-rhaap-extension-api/src/helpers/` (collection, git-repository, execution-environment, template)                                   |
| `ContributionRegistry.reset()` for test isolation                    | ✅ Done (PoC)                                 | ✅ Done                                                                                                                                                |
| Full unit test coverage                                              | Per existing test strategy                    | ✅ Done — `registry.test.ts` (contentType filtering, entity filtering, priority sort, enable/disable, subscribe/unsubscribe, reset)                    |
| `sharedPackages` documentation                                       | RHDH `dynamic-plugins.yaml` example           | ❌ Not started                                                                                                                                         |

---

### Phase 3 — Extension host (`portal-extension-host`)

**Output:** `@ansible/portal-extension-host` — the runtime that renders contributions.
Lives in `portal-core`, not in self-service.

**Work:**

| Item                                            | Notes                                                                                                            | Status                                                                                                                                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExtensionRenderer`                             | Renders contributions: `PortalThemeProvider` → `ErrorBoundary` → `Suspense` → component                          | ✅ Done — `self-service/src/extensions/ExtensionRenderer.tsx` (`ExtensionTabContent`, `ExtensionCardContent`, `ExtensionActionMenuItem`, `useActionActivation`); moves to `portal-extension-host` in Phase 7    |
| `DynamicExtensionDiscovery` (dynamic discovery) | Third-party manifest subscription + first-party prop validation                                                  | ✅ Done — subscribes to `contributionRegistry.subscribeToManifests()` (replay-on-subscribe); first-party `manifests` prop validated on mount; Scalprum references removed (RHDH 2.1 uses NFS); 67 tests passing |
| `ExperienceSlot` component                      | Named layout zone that stacks registered contributions for an experience + slot                                  | ✅ Done — `self-service/src/extensions/ExperienceSlot.tsx` (`ExperienceCardSlot`, `ExperienceTabContent`)                                                                                                       |
| Manifest validation on plugin load              | Reject incompatible `apiVersion`; log, do not crash                                                              | ✅ Done — `self-service/src/extensions/validateManifest.ts`; validates semver compatibility, known `experienceId`s, and `minimumHostApiVersion`; wired in `DynamicExtensionDiscovery`                           |
| Permission gating per contribution              | `PermissionGate` wrapper using `requiredPermission` field                                                        | ✅ Done — `usePermission` gating in `ExtensionTabContent`, `ExtensionCardContent`, `useActionActivation`                                                                                                        |
| `filter()` as additional predicate              | Applied after `appliesToContentTypes` static gate                                                                | ✅ Done — `safeFilter()` in `registry.ts`                                                                                                                                                                       |
| `onActivate` for pure-UI slot launches          | Thin callback for navigation/dialog only; no network                                                             | ✅ Done — `useActionActivation` in `ExtensionRenderer.tsx`                                                                                                                                                      |
| Error boundary per slot                         | Individual contribution crash does not take down the page                                                        | ✅ Done — `ErrorBoundary.tsx` (class component, `getDerivedStateFromError`)                                                                                                                                     |
| CSS custom properties injection                 | Via `useTheme()`, theme-adaptive `--portal-color-*` vars on `display: contents` wrapper                          | ✅ Done — `ContributionWrapper.tsx` + `usePortalCssTokens()` in `portal-extension-host`; both `ExtensionTabContent` and `ExtensionCardContent` wrapped; 10 vars documented in `tokens.ts` JSDoc                 |
| Handler safety (`try/catch` + error logging)    | For `onActivate` callbacks                                                                                       | ✅ Done — `ExtensionActionMenuItem` catches and logs `onActivate` rejections                                                                                                                                    |
| RJSF settings shell                             | Renders `SettingsContribution` schema; `onLoad`/`onSave` callbacks; RJSF v5 + ajv8                               | ✅ Done — `SettingsShell<T>` in `portal-extension-host`; exported with `SettingsShellProps`, `SettingsLoader`, `SettingsSaver` types; `@rjsf/*` in peerDeps                                                     |
| Health display aggregator                       | `portal-health-backend` exposes `GET /api/portal-health/status`; `PortalHealthStatus` component polls every 30 s | ✅ Done — `portal-health-backend` Backstage backend plugin + `PortalHealthStatus`/`usePortalHealthStatus` in `portal-extension-host`                                                                            |
| `DynamicExtensionDiscovery` no-op fallback      | Detects Scalprum absence cleanly                                                                                 | ✅ Done — `useIsDynamicEnvironment()` hook; `DynamicExtensionDiscovery` is a no-op in standard Backstage                                                                                                        |

---

### Phase 4 — Wire self-service as a first-party contributor

**Output:** Self-service detail pages (RepositoryDetailsPage, CollectionDetailsPage,
EEDetailsPage) registered as capability contributions. Proves the SDK before ANSTRAT-1758
and partner integrations depend on it.

**Work:**

| Item                                                           | Notes                                                                                                                                                                                                  | Status  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `RepositoryDetailsPage` tabs → `useExtensionTabs`              | ✅ Done (PoC)                                                                                                                                                                                          | ✅ Done |
| `EEDetailsPage` tabs → `useExtensionTabs`                      | ✅ Done (PoC)                                                                                                                                                                                          | ✅ Done |
| `CollectionDetailsPage` tabs → `useExtensionTabs`              | ✅ Done (PoC)                                                                                                                                                                                          | ✅ Done |
| Register built-in tabs as `CapabilityEntryPoint` contributions | `selfServiceManifest.ts` declares all capabilities; validated on startup via `DynamicExtensionDiscovery` mounted in `RouteView`; full slot-based activation (component extraction) deferred to Phase 6 | ✅ Done |
| `GitRepositoriesPage` list tabs → extension support            | `useExtensionTabs(GIT_REPO_LIST_TABS)` wired; extension tabs append after Catalog + CI Activity; `activeExtTabIndex` state for in-page switching; 4 new tests                                          | ✅ Done |
| All affected tests updated                                     | Fixed in previous session (192 suites); 4 new extension tab tests added this session (196 suites, 3961 tests)                                                                                          | ✅ Done |
| Full verification (tsc, lint, test)                            | tsc: 0 errors; lint: 0 errors; tests: all pass                                                                                                                                                         | ✅ Done |

---

### Phase 5 — `portal-plugin-node` (backend SDK)

**Output:** `@ansible/backstage-rhaap-node` — server-side SDK for portal backend plugins.
(Interim name; renamed to `@ansible/portal-plugin-node` in Phase 7.)
**Location:** `plugins/backstage-rhaap-node/`

**Work:**

| Item                                        | Notes                                                                                                                                                                                                                             | Status                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `createPortalPlugin()` factory              | Returns `PortalPlugin` with `createMiddleware`, `pushHealthStatus`, `emitAuditEvent`, `withLogger`                                                                                                                                | ✅ Done — `createPortalPlugin.ts`                                             |
| Identity middleware                         | `createIdentityMiddleware({ httpAuth, userInfo, logger })` — attaches `req.portalContext` with `userId`, `organizationId`, `userEntityRef`; derived from Backstage user entity ref namespace; never blocks unauthenticated routes | ✅ Done — `middleware.ts`                                                     |
| `PortalContext` type + Express augmentation | `req.portalContext?: PortalContext` statically typed in all consumers                                                                                                                                                             | ✅ Done — `types.ts`                                                          |
| Health push                                 | `pushHealthStatus(status)` + `HealthRegistry` singleton per plugin; `subscribe()`; `getAllHealthStatuses()` for host aggregation; initial state `UNKNOWN`                                                                         | ✅ Done — `healthRegistry.ts`                                                 |
| Audit event emitter                         | `AuditEmitter.emit(event)` → structured `info` log entry with plugin, operationId, userId, organizationId, outcome, timestamp                                                                                                     | ✅ Done — `auditEmitter.ts` (Phase 5: log only; durable store in later phase) |
| Organization-keyed DB helpers               | `withOrganization(orgId, fn)` — rejects empty orgId; trims whitespace; makes key unavoidable at call site                                                                                                                         | ✅ Done — `withOrganization.ts`                                               |
| Full unit test coverage                     | 34 tests: `parseEntityRef`, `createIdentityMiddleware`, `HealthRegistry`, `withOrganization`, `AuditEmitter`, `createPortalPlugin` integration                                                                                    | ✅ Done — `createPortalPlugin.test.ts`                                        |
| tsc + lint                                  | tsc: 0 errors; lint: 0 errors                                                                                                                                                                                                     | ✅ Done                                                                       |

---

### Phase 6 — Content extraction (self-service → content workspace)

**Dependency:** ANSTRAT-1758 must publish `automation-content-client` and declare the
content type IDs before this phase begins.

**Work (§7.3 of architecture doc):**

| Component                                        | Moves to                                                           | Constraint                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `CollectionsCatalog`                             | `automation-content-module-collection` (ANSTRAT-1758)              | No circular dep: self-service imports content by published version only |
| `GitRepositories`                                | `automation-content` (ANSTRAT-1758)                                | Same                                                                    |
| `ExecutionEnvironments` (built image view)       | `automation-content-module-execution-environment` (ANSTRAT-1758)   |                                                                         |
| `ExecutionEnvironments` (definition catalog)     | Stays in `self-service` → `portal-scaffolder`                      | This is authoring, not content browsing                                 |
| `LandingPage`, `Home`                            | `portal-core` (`portal-theme`)                                     |                                                                         |
| `SignInPage`, `AAPLogoutButton`, `AppThemeFixer` | `portal-core` / `aap` workspace                                    |                                                                         |
| Seven scaffolder pickers                         | Re-implemented against `content.collections.list` operation (§7.5) | Contract agreed with ANSTRAT-1758 first                                 |

**The seven pickers boundary (§7.5):** ANSTRAT-1758 declares a registered operation
and typed client method (e.g., `content.collections.list`) with schema and permission.
Self-service owns the field component and calls it through the published client.
This is the first concrete contract the two Jiras need to agree on.

---

### Phase 7 — Rename and restructure

**Dependency:** Phases 1–4 complete; packages stable enough to rename before any external publish.

| Current name                     | Target name                 | Notes                                                            | Status                                                                                                                                                      |
| -------------------------------- | --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backstage-rhaap-react`          | `portal-plugin-sdk`         | Move to `workspaces/portal-core/` (deferred)                     | ✅ Package name `@ansible/portal-plugin-sdk`; directory renamed to `plugins/portal-plugin-sdk/`                                                             |
| `backstage-rhaap-extension-api`  | `portal-extension-api`      | Move to `workspaces/portal-core/` (deferred)                     | ✅ Package name `@ansible/portal-extension-api`; directory renamed to `plugins/portal-extension-api/`                                                       |
| `backstage-rhaap-node`           | `portal-plugin-node`        | Move to `workspaces/portal-core/` (deferred)                     | ✅ Package name `@ansible/portal-plugin-node`; directory renamed to `plugins/portal-plugin-node/`                                                           |
| _(host, in self-service)_        | `portal-extension-host`     | Move to `workspaces/portal-core/` (deferred)                     | ✅ Standalone package `@ansible/portal-extension-host` at `plugins/portal-extension-host/`; `self-service/src/extensions/` are thin re-export shims         |
| _(new)_                          | `portal-core`               | Singleton provider for RHDH dynamic plugin deployment            | ✅ Done — `plugins/portal-core/` frontend-plugin; bundles `portal-extension-api` + `portal-extension-host`; `self-service` moved both to `peerDependencies` |
| `plugin-backstage-self-service`  | `portal-scaffolder`         | Plugin ID: `portal-scaffolder`, keep `/self-service/*` redirects | ✅ Package name `@ansible/portal-scaffolder`; plugin ID `portal-scaffolder`; manifest IDs updated; route paths `/self-service/*` preserved                  |
| `ansible-backstage-plugins` repo | `automation-portal-plugins` | Coordinate with all teams; GitHub redirects old paths            | ❌ Deferred — coordination required                                                                                                                         |

---

## 6. Contracts Published for Other Teams

The following packages are the boundary that ANSTRAT-1758 (content management) and
partner integrations build against. They must be versioned and stable.

| Package                            | Consumers                              | What it provides                                                         |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `@ansible/portal-extension-common` | ANSTRAT-1758, partner plugins          | `PluginManifest`, `CapabilityContribution`, `CapabilityLaunch`, type IDs |
| `@ansible/portal-extension-api`    | ANSTRAT-1758 frontend, partner plugins | `ContributionRegistry`, `useExtensionTabs`, `registerCapability()`       |
| `@ansible/portal-plugin-sdk`       | ANSTRAT-1758 frontend, partner plugins | `usePortalContext()`, BUI tokens, widget registration                    |
| `@ansible/portal-plugin-node`      | ANSTRAT-1758 backend, partner plugins  | Identity middleware, audit emit, health push                             |

**Semver policy:** Pre-1.0.0 minor bumps may include breaking changes (documented in
changelog). Once 1.0.0 ships: extension point IDs and `PluginManifest` shape are
additive-only across minor versions. Breaking changes require a major bump with a
migration guide.

---

## 7. The Content/Self-Service Boundary Agreement Needed Now

From architecture §7.6 — this is the one thing that blocks parallel progress:

> Settle the shape of the seven scaffolder picker operations and the client that calls
> them, and everything else in the split follows.

**What needs agreement between ANSTRAT-2497 (us) and ANSTRAT-1758 (content team):**

1. The operation ID and input/output schema for `content.collections.list`
2. The operation ID and input/output schema for `content.executionEnvironments.listBaseImages`
3. The operation ID and input/output schema for `content.executionEnvironments.listTags`
4. Whether these operations go through `automation-content-client` or a separate picker API
5. Permission requirement for each (who can call the picker in a template form)

Once these five questions are answered, the seven scaffolder pickers can be re-implemented
against the published client, and Phase 6 can begin without blocking either team.

---

## 8. Open Questions

| Question                                                                                                                                                                                                                                                                                                     | Owner                      | Blocking |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | -------- |
| **NFS slot activation design** — With RHDH 2.1 removing Scalprum, `type: 'slot'` + `moduleName` no longer maps to an API. Should `targetSlot` become an NFS mount point ID? Option 1 (recommended): reframe as NFS mount point. Option 2: use webpack `import()` directly. Needs design session with Ganesh. | Portal core + Ganesh       | Phase 6  |
| Should experiences have sub-experiences or nested slots?                                                                                                                                                                                                                                                     | Portal core + content team | Phase 2  |
| Can `portal-extension-host` be a standard Backstage plugin (not just a React component) to support backend-side manifest validation?                                                                                                                                                                         | Portal core                | Phase 3  |
| `portal-plugin.yaml` delivery manifest (§9.1 of architecture doc) — who builds the aggregator?                                                                                                                                                                                                               | Release engineering        | Phase 7  |
| Tenant isolation: single-org deployments must still key all queries by `organizationId` — does the node SDK enforce this at the middleware layer or at the DB helper layer?                                                                                                                                  | Portal core                | Phase 5  |
| Gitea support for `playbook-repository` type — deliver or dated deviation?                                                                                                                                                                                                                                   | Content team               | Phase 6  |

---

## 9. Workspace and Repository Structure

See [canonical architecture §2.2](https://github.com/ansible/ansible-rhdh-plugins/blob/portal-plugin-research/.sdlc/research/plugin-factory/Content%20Experience%20Architecture.md) for the full layout. This ticket's packages live in `workspaces/portal-core/`. For reference:

```
automation-portal-plugins/
├── workspaces/
│   ├── portal-core/         ← this ticket
│   │   └── plugins/
│   │       ├── portal-theme/
│   │       ├── portal-extension-common/
│   │       ├── portal-extension-api/
│   │       ├── portal-extension-host/
│   │       ├── portal-plugin-sdk/
│   │       └── portal-plugin-node/
│   │
│   ├── content/             ← ANSTRAT-1758
│   ├── self-service/        ← this ticket (portal-scaffolder)
│   └── aap/                 ← AAP integration team
```

Package naming convention: `@ansible/backstage-plugin-<name>` for installable plugins,
`@ansible/portal-<name>` for SDK/host packages, matching upstream Backstage community
plugin convention.

---

## 10. Documentation Deliverables

| Document                       | Location                                                  | Content                                            | Status       |
| ------------------------------ | --------------------------------------------------------- | -------------------------------------------------- | ------------ |
| This guide                     | `docs/next/portal-plugin-factory-implementation-guide.md` | Implementation plan, phases, contracts             | ✅ This file |
| PoC arch doc                   | `docs/architecture/self-service-extension-sdk.md`         | PoC decisions + alignment notes (§12)              | ✅ Done      |
| Component library README       | `plugins/portal-plugin-sdk/README.md`                     | All exported components, props, examples           | ❌           |
| Extension SDK README           | `plugins/portal-extension-api/README.md`                  | How to register capabilities, all extension points | ❌           |
| Community developer quickstart | `docs/sdk/quickstart.md`                                  | End-to-end: build a plugin that adds a tab         | ❌           |
| Design tokens reference        | `docs/sdk/design-tokens.md`                               | CSS custom properties, JS tokens, theme guidance   | ❌           |
| RHDH dynamic plugin guide      | `docs/sdk/rhdh-dynamic-plugins.md`                        | Registration, Scalprum, declarative config         | ❌           |
| Internal migration guide       | `docs/sdk/migration-from-self-service.md`                 | How to update imports from old locations           | ❌           |
