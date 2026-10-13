# Portal Core plugins Explanation

### **The big picture**

Imagine the Portal is a **shopping mall**:

- A **plugin** is a shop.
- The **frontend** is the shop’s display/UI.
- The **backend** is the shop’s staff/services.
- The **host** is the mall infrastructure that decides where and how shops appear.
- The **manifest** is the shop’s registration form: _“I’m called APME, I provide these things, and I can perform these operations.”_
- An **operation** is something the shop can actually do: _“trigger a scan”, “create a repository”, etc._

The important architectural rule is:

**Plugins tell the Portal what they can do through a common contract, and the Portal decides how those capabilities are exposed.**

---

## **1\. Why do we need** **`portal-extension-common`****?**

Previously, you essentially had this:

```text
portal-extension-api
        │
        ├── PluginManifest
        ├── OperationDescriptor
        ├── React types
        ├── React hooks
        └── frontend registration
```

The problem is that **backend plugins don’t need React**.

Suppose APME’s backend wants to say:

“I support an operation called `apme.scans.trigger`.”

It needs `OperationDescriptor`.

But if `OperationDescriptor` lives inside `portal-extension-api`, the backend has to depend on a **frontend/React package** just to get one data structure.

That’s wrong conceptually.

So you extract the things that **every plugin needs**, regardless of frontend/backend:

```text
portal-extension-common
        │
        ├── PluginManifest
        ├── OperationDescriptor
        ├── CapabilityContribution
        ├── CONTENT_TYPES
        └── EXTENSION_POINTS
```

No React.

No browser.

No Node-specific code.

Just the **shared language**.

---

## **2\. Think of** **`portal-extension-common`** **as the dictionary**

This is probably the most important mental model.

`portal-extension-common` doesn’t **do** anything.

It defines:

“These are the words and structures that Portal plugins are allowed to use when talking to Portal.”

For example:

```ts
interface OperationDescriptor {
  id: string;
  version: string;
  description: string;
  permission: ...;
  exposure: ...;
  idempotent: boolean;
}
```

That’s basically a **contract**.

It doesn’t execute the operation.

It doesn’t create an HTTP endpoint.

It doesn’t render anything.

It just says:

“If you want to tell Portal about an operation, describe it like this.”

That’s why both frontend and backend can depend on it.

---

## **3\. Now look at** **`portal-extension-api`**

This is where things become frontend-specific.

`portal-extension-common` says:

“This is what a plugin contribution looks like.”

`portal-extension-api` says:

“Here’s how a **React plugin** registers that contribution.”

For example:

```ts
registerGitRepoDetailTab({
  id: 'apme.quality-tab',
  label: 'Quality',
  component: lazy(...)
});
```

The common package doesn’t know anything about:

```text
React
Component
lazy()
hooks
browser
rendering
```

But `portal-extension-api` does.

So:

```text
portal-extension-common
          ↑
          │
portal-extension-api
```

You can think:

```text
common = WHAT
api    = HOW frontend plugins register it
```

---

## **4\. And then** **`portal-extension-host`**

This is the other side of the equation.

A plugin says:

“I have a Quality tab.”

`portal-extension-api` provides the mechanism for registering it.

But **who actually renders it?**

That’s `portal-extension-host`.

So the flow is:

```text
APME
 │
 │ registerGitRepoDetailTab(...)
 ▼
portal-extension-api
 │
 │ stores contribution
 ▼
ContributionRegistry
 │
 │
 ▼
portal-extension-host
 │
 │ renders contribution
 ▼
GitRepositoriesPage
 │
 ▼
User sees "Quality" tab
```

This separation is useful because the plugin doesn’t need to know how the Portal renders things.

The plugin simply says:

“Here is my contribution.”

The host says:

“Okay, I’ll render it.”

---

## **5\. So what’s** **`portal-core`** **doing?**

This one is slightly confusing because **it doesn’t actually provide functionality to the user**.

Its main job is making sure everyone is talking to the **same** **`ContributionRegistry`**.

Imagine this:

```text
APME plugin
    │
    ▼
Registry A

Self-service plugin
    │
    ▼
Registry B
```

APME registers:

```text
"Quality tab"
```

into Registry A.

But Self-Service reads Registry B.

So Self-Service sees:

```text
nothing
```

Even though APME registered the tab correctly.

That’s disastrous.

`portal-core` solves this through RHDH module federation:

```text
                 portal-core
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
portal-extension-api   portal-extension-host
          │
          ▼
  ONE ContributionRegistry
          ▲
          │
    ┌─────┴─────┐
    │           │
   APME    Self-Service
```

So `portal-core` is basically saying:

**“Everyone use this one shared copy.”**

That’s why it’s a **singleton provider**, not really a UI plugin.

---

## **6\. Now the backend side**

This is where `portal-extension-common` becomes particularly important.

Imagine APME has a backend operation:

```text
Trigger quality scan
```

The backend declares:

```ts
{
  id: 'apme.scans.trigger',
  version: '1.0.0',
  ...
}
```

That declaration is an `OperationDescriptor`.

The backend doesn’t need:

```text
React
React hooks
ContributionRegistry
browser APIs
```

It only needs:

```text
portal-extension-common
```

So:

```text
                 portal-extension-common
                    /              \
                   /                \
                  ▼                  ▼
          Frontend world       Backend world
                │                    │
                ▼                    ▼
    portal-extension-api    portal-plugin-node
                │                    │
                ▼                    ▼
    portal-extension-host      APME backend
```

This is the main reason the new package exists.

---

## **7\. What is an** **`OperationDescriptor`** **actually doing?**

This is probably the most important backend concept in the whole design.

Suppose APME exposes:

```text
POST /api/apme/scans
```

A naive frontend might directly call:

```ts
fetch('/api/apme/scans');
```

But your architecture doesn’t want plugins doing that.

Instead, the frontend says:

```text
"I want to execute operation:
 apme.scans.trigger"
```

The Portal knows:

```text
apme.scans.trigger
        ↓
APME backend
        ↓
appropriate handler
```

The descriptor provides the metadata needed to make that connection.

For example:

```text
OperationDescriptor
       │
       ├── id
       │     └── apme.scans.trigger
       │
       ├── permission
       │     └── who can execute it?
       │
       ├── exposure
       │     └── REST?
       │
       ├── idempotent
       │     └── safe to repeat?
       │
       └── auditCategory
             └── how should it be audited?
```

So the descriptor is essentially:

**“Here is a machine-readable description of an action my backend supports.”**

---

## **8\. Why is** **`operationId`** **better than a hardcoded URL?**

This is an important security/architecture decision.

Without the operation abstraction:

```text
Frontend
   │
   │ POST /api/apme/scans
   ▼
APME
```

Now the frontend knows too much about the backend.

With your model:

```text
Frontend
   │
   │ execute("apme.scans.trigger")
   ▼
Portal
   │
   │ resolves operation
   ▼
APME backend
```

The frontend doesn’t need to know:

```text
Where is APME?
What URL does it use?
Which endpoint handles it?
What exposure mechanism does it use?
```

The Portal owns that mapping.

That’s what your statement means by:

**all server effects go through** **`operationId`\*\*\*\*, not** **`apiEndpoint`\*\*\*\*.**

It creates a controlled boundary between the frontend and backend.

---

## **9\. Then what’s** **`portal-plugin-node`** **?**

This is a different concern.

`portal-extension-common` tells the backend:

“Here’s the vocabulary for describing your plugin.”

`portal-plugin-node` gives the backend:

“Here’s the actual machinery you need to build a Portal backend plugin.”

For example:

```ts
createPortalPlugin({
  pluginId: 'apme',
});
```

Then it gives you things like:

```text
createMiddleware()
pushHealthStatus()
emitAuditEvent()
```

So:

### **`portal-extension-common`**

```text
What does my plugin declare?
```

### **`portal-plugin-node`**

```text
How do I implement my backend plugin?
```

That’s an important distinction.

---

## **10.** **`req.portalContext`** **is another useful example**

Suppose the user calls:

```text
POST /api/apme/scans
```

The backend needs to know:

```text
Which user?
Which organization?
Which Backstage entity?
```

`portal-plugin-node` middleware handles that.

Conceptually:

```text
HTTP request
     │
     ▼
portal-plugin-node middleware
     │
     │ extracts Backstage identity
     ▼
req.portalContext
     │
     ├── organizationId
     ├── userId
     └── userEntityRef
     │
     ▼
APME backend
     │
     ▼
DB query scoped to organization
```

So `portal-plugin-node` is concerned with **runtime backend behavior**.

`portal-extension-common` is concerned with **shared contracts**.

---

## **10b\. `portal-health-backend` — the health aggregation endpoint**

`portal-plugin-node` provides `pushHealthStatus()` so each backend plugin can
**report** its health. But where does that data go? Into `portal-health-backend`.

```text
APME backend
      │
      └── portalPlugin.pushHealthStatus({ state: 'READY', message: '...' })
                  │
                  ▼
         process-level HealthRegistry (key: 'apme')
                  │
                  ▼
         GET /api/portal-health/status
         (portal-health-backend Backstage plugin)
                  │
                  ▼
         usePortalHealthStatus() hook
         (in portal-extension-host)
                  │
                  ▼
         <PortalHealthStatus />
         (renders table of plugin health states)
```

`portal-health-backend` is a thin Backstage backend plugin — it simply reads
from the same in-process `HealthRegistry` and exposes it over HTTP. No database,
no async scheduling, no external calls. Register it in `backend/src/index.ts`:

```ts
backend.add(import('@ansible/portal-health-backend'));
```

The frontend `PortalHealthStatus` component (in `portal-extension-host`) polls
`/api/portal-health/status` every 30 seconds and renders per-plugin status chips:
**Ready** (green), **Degraded** (amber), **Unavailable** (red), **Unknown** (grey).

---

## **10c\. Phase 3 host components in `portal-extension-host`**

Three components were added to complete the Phase 3 host infrastructure:

### `ContributionWrapper` / `usePortalCssTokens`

Every contributed component (tab, card) is now wrapped in a `display: contents`
div that injects 10 CSS custom properties derived from `useTheme()`:

```text
--portal-color-primary         palette.primary.main
--portal-color-primary-light   palette.primary.light
--portal-color-primary-dark    palette.primary.dark
--portal-color-error           palette.error.main
--portal-color-warning         palette.warning.main
--portal-color-success         palette.success.main
--portal-color-text-primary    palette.text.primary
--portal-color-text-secondary  palette.text.secondary
--portal-color-background      palette.background.default
--portal-color-surface         palette.background.paper
```

Plugin authors use them without importing MUI or Backstage theme utilities:

```tsx
<div style={{ color: 'var(--portal-color-primary)' }}>
  <span style={{ color: 'var(--portal-color-text-secondary)' }}>…</span>
</div>
```

`display: contents` means the wrapper generates no layout box — it doesn't
break flexbox/grid containers while still allowing CSS variables to cascade.

### `PortalHealthStatus` / `usePortalHealthStatus`

See §10b above. Import from `@ansible/portal-extension-host`:

```tsx
import { PortalHealthStatus } from '@ansible/portal-extension-host';
// Drop anywhere a host page needs to surface plugin operational health
<PortalHealthStatus pollIntervalMs={30_000} />;
```

### `SettingsShell<T>`

A generic RJSF v5 settings form for plugin settings pages. Portal plugins that
contribute a `SettingsContribution` render their settings as a `<SettingsShell>`:

```tsx
import { SettingsShell } from '@ansible/portal-extension-host';

export const MyPluginSettings = () => (
  <SettingsShell
    schema={myJsonSchema7}
    uiSchema={{ apiToken: { 'ui:widget': 'password' } }}
    onLoad={async () => myApi.getSettings()}
    onSave={async data => myApi.saveSettings(data)}
  />
);
```

Lifecycle: `onLoad()` on mount → RJSF validates in real-time → `onSave(data)` on
submit → Backstage `alertApiRef` feedback (success or error). Reset button
re-calls `onLoad()` to discard local edits.

---

## **11\. Where does** **`portal-plugin-sdk`****fit?**

That’s basically the frontend equivalent of `portal-plugin-node`.

For example:

```text
Frontend plugin
      │
      ├── portal-extension-api
      │       └── "register my extension"
      │
      └── portal-plugin-sdk
              └── "give me common Portal UI/context"
```

So:

<div class="joplin-table-wrapper"><table border="1" cellspacing="0" cellpadding="8" width="100%" style="width: 100%; border-collapse: collapse; border: 1px solid;" class="jop-noMdConv"><thead class="jop-noMdConv"><tr class="jop-noMdConv"><th style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p><b class="jop-noMdConv">Package</b></p></th><th style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p><b class="jop-noMdConv">Think of it as</b></p></th></tr></thead><tbody class="jop-noMdConv"><tr class="jop-noMdConv"><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p><code class="jop-noMdConv">portal-extension-common</code></p></td><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p>Shared vocabulary</p></td></tr><tr class="jop-noMdConv"><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p><code class="jop-noMdConv">portal-extension-api</code></p></td><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p>Frontend registration API</p></td></tr><tr class="jop-noMdConv"><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p><code class="jop-noMdConv">portal-extension-host</code></p></td><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p>Frontend rendering engine</p></td></tr><tr class="jop-noMdConv"><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p><code class="jop-noMdConv">portal-core</code></p></td><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p>Singleton/glue for RHDH</p></td></tr><tr class="jop-noMdConv"><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p><code class="jop-noMdConv">portal-plugin-sdk</code></p></td><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p>Frontend developer toolkit</p></td></tr><tr class="jop-noMdConv"><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p><code class="jop-noMdConv">portal-plugin-node</code></p></td><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p>Backend developer toolkit</p></td></tr><tr class="jop-noMdConv"><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p><code class="jop-noMdConv">portal-health-backend</code></p></td><td style="border: 1px solid; padding: 8px 12px; white-space: nowrap;" class="jop-noMdConv"><p>Health aggregation HTTP endpoint</p></td></tr></tbody></table></div>

---

## **12\. The whole architecture in one picture**

I’d simplify your original diagram to this:

```text
                         PORTAL
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
     FRONTEND WORLD               BACKEND WORLD
              │                         │
              │                         │
     ┌────────┴────────┐          ┌─────┴─────────┐
     │                 │          │               │
     ▼                 ▼          ▼               ▼
extension-api    plugin-sdk   plugin-node   extension-common
     │                 │          │               ▲
     │                 │          │               │
     ▼                 │          │               │
extension-host         │          │               │
     │                 │          │               │
     └────────┬────────┘          │               │
              │                   │               │
              ▼                   ▼               │
         Portal UI          Backend plugins       │
              │             (APME, etc.)          │
              │                   │               │
              └──────────┬────────┴───────────────┘
                         │
                         ▼
                SHARED CONTRACTS
              Manifest / Operations /
              Capabilities / etc.
```

With `portal-core` sitting underneath the frontend side as the RHDH federation glue.

---

## **13\. The most important distinction**

If you remember only **one thing**, remember this:

### **`common`**

**What can a plugin say?**

```text
PluginManifest
OperationDescriptor
CapabilityContribution
```

### **`api`**

**How does a frontend plugin register things?**

```text
registerGitRepoDetailTab()
registerGitRepoListAction()
useExtensionTabs()
```

### **`host`**

**How does Portal render those things?**

```text
ExperienceTabContent
ExperienceCardSlot
ErrorBoundary
```

### **`plugin-sdk`**

**What reusable UI/context can plugin authors use?**

```text
usePortalContext()
Buttons
Notifications
Theme utilities
```

### **`plugin-node`**

**What reusable backend infrastructure can plugin authors use?**

```text
createPortalPlugin()
Middleware
Health
Audit
```

### **`portal-core`**

**How do all the frontend plugins share the same runtime/registry in RHDH?**

```text
Module Federation singleton
```

---

## **14\. And finally, what happens with APME?**

An APME plugin effectively has **two halves**:

```text
                       APME
                        │
             ┌──────────┴──────────┐
             │                     │
             ▼                     ▼
        APME Frontend         APME Backend
             │                     │
             │                     │
             ▼                     ▼
 extension-api              extension-common
             │                     │
             ▼                     ▼
    register Quality tab    declare scan operation
             │                     │
             ▼                     ▼
     extension-host          Portal operation registry
             │                     │
             ▼                     ▼
       Portal UI             APME implementation
```

And the shared manifest connects the two worlds:

```text
                    PluginManifest
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
       UI capabilities          Backend operations
             │                       │
       "Quality tab"          "Trigger scan"
             │                       │
             └───────────┬───────────┘
                         ▼
                     APME plugin
```

That’s why **`portal-extension-common`** **is more than just a package split**.

It establishes a clean architectural boundary:

**Frontend and backend plugins can speak the same Portal extension language without either side having to depend on the other’s runtime.**

And specifically for **ANSTRAT-2497**, this is what makes the plugin factory extensible beyond purely frontend contributions: a future backend/content plugin can participate in the same manifest/capability/operation model without dragging React into its Node.js dependency graph.
