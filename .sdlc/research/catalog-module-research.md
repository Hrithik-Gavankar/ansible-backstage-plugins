# Catalog Backend Module Research — Split Analysis

> **Architecture reference:** [Content Experience Architecture](https://github.com/ansible/ansible-rhdh-plugins/blob/portal-plugin-research/.sdlc/research/plugin-factory/Content%20Experience%20Architecture.md) (§2.2 workspace layout, §7.3–§7.4 provider boundaries)
>
> **Scope:** Analyze the monolithic `catalog-backend-module-rhaap` and determine the minimal split that preserves entity refs, operator URLs, and downstream consumers.

---

## 1. Goal

The catalog backend module today is a single package that registers entity providers for AAP identity, job templates, PAH collections, Git-hosted Ansible content, and execution environments — all under one `moduleId: 'rhaap'`. These concerns belong to different domains and should be independently deployable.

Per the Content Experience Architecture §2.2, the target is one workspace per experience:

| New module                              | Workspace                     | Owns                                                                       |
| --------------------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `catalog-backend-module-aap`            | `workspaces/aap/plugins/`     | `AAPEntityProvider`, `AAPJobTemplateProvider`, AAP sync routes             |
| `catalog-backend-module-portal-content` | `workspaces/content/plugins/` | `PAHCollectionProvider`, `AnsibleGitContentsProvider`, content sync routes |
| EE provider (scaffolder-owned)          | `workspaces/scaffolder/`      | `EEEntityProvider`, `/ansible/ee` routes                                   |

The original package is retained as a deprecated shim during migration.

---

## 2. Current State

### 2.1 Module Identity

```
workspaces/aap/plugins/catalog-backend-module-rhaap/
├── src/
│   ├── module.ts              # Backend module registration
│   ├── router.ts              # HTTP routes (~1200 lines)
│   └── providers/
│       ├── AAPEntityProvider.ts
│       ├── AAPJobTemplateProvider.ts
│       ├── PAHCollectionProvider.ts
│       ├── AnsibleGitContentsProvider.ts
│       ├── EEEntityProvider.ts
│       ├── config.ts          # Shared config reading
│       └── SyncStateTracker.ts
└── config.d.ts
```

**Package:** `@ansible/backstage-plugin-catalog-backend-module-rhaap`
**Backstage role:** `backend-plugin-module` (`pluginId: catalog`, `moduleId: rhaap`)

### 2.2 Entity Providers

| Provider                     | Config Key                | Source                      | Catalog Output                           | Schedule          |
| ---------------------------- | ------------------------- | --------------------------- | ---------------------------------------- | ----------------- |
| `AAPEntityProvider`          | `sync.orgsUsersTeams`     | AAP Controller              | `User`, `Group` (org/team), `aap-admins` | Per env           |
| `AAPJobTemplateProvider`     | `sync.jobTemplates`       | AAP job templates + surveys | `Template` entities                      | Same; can disable |
| `PAHCollectionProvider`      | `sync.pahCollections`     | PAH via ansible service     | Collection entities                      | Per repository    |
| `AnsibleGitContentsProvider` | `sync.ansibleGitContents` | GitHub/GitLab crawl         | Repos + collections                      | Per org           |
| `EEEntityProvider`           | _(on-demand)_             | `POST /ansible/ee`          | `Component` (execution-environment)      | Delta mutations   |

### 2.3 HTTP Routes

| Route Group        | Path(s)                                        | Auth                      | Target Module       |
| ------------------ | ---------------------------------------------- | ------------------------- | ------------------- |
| Health             | `GET /health`                                  | Open                      | All                 |
| AAP identity sync  | `POST /ansible/sync/from-aap/orgs_users_teams` | Superuser                 | AAP                 |
| AAP templates sync | `POST /ansible/sync/from-aap/job_templates`    | Superuser                 | AAP                 |
| Sync status        | `GET /ansible/sync/status`                     | `catalogEntityRead`       | Aggregator / shared |
| PAH content sync   | `POST /ansible/sync/from-aap/content`          | Superuser                 | Content             |
| SCM content sync   | `POST /ansible/sync/from-scm/content`          | Superuser                 | Content             |
| EE register        | `POST /ansible/ee`                             | Service credentials only  | Scaffolder          |
| EE build           | `POST /ansible/ee/build`                       | User + EE view permission | Scaffolder          |
| Git helpers        | `GET /ansible/git/*`                           | Authenticated + perms     | Content             |

### 2.4 Permissions

Registered in `module.ts` via `ansiblePermissions`:

| Permission                            | Current Enforcement                     |
| ------------------------------------- | --------------------------------------- |
| `catalogEntityReadPermission`         | Sync status, git helpers                |
| `executionEnvironmentsViewPermission` | EE build, git file-content              |
| `gitRepositoriesViewPermission`       | Git routes                              |
| `collectionsViewPermission`           | Git file-content (any-of)               |
| `templatesViewPermission`             | Registered; enforced in self-service UI |

### 2.5 Downstream Consumers

| Consumer                             | Uses                                  | Contract                                                                                          |
| ------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `auth-backend-module-rhaap-provider` | Catalog `User` entities from AAP sync | Required by `usernameMatchingUser` unless `dangerouslyAllowSignInWithoutUserInCatalog` is enabled |
| Scaffolder autocomplete              | Collections, templates from catalog   | Entity query via catalog search API                                                               |
| Self-service UI                      | EE catalog entities + HTTP routes     | Entity shape + `/ansible/ee/build` URL                                                            |
| 3rd-party factory plugins            | Catalog entity kinds + annotations    | SDK contract (stable entity refs)                                                                 |

---

## 3. What Stays, What Moves

### 3.1 Entity Providers

| Provider                     | Decision       | Destination                             | Notes                                      |
| ---------------------------- | -------------- | --------------------------------------- | ------------------------------------------ |
| `AAPEntityProvider`          | **AAP**        | `catalog-backend-module-aap`            | Identity sync; auth-provider depends on it |
| `AAPJobTemplateProvider`     | **AAP**        | `catalog-backend-module-aap`            | Follows AAP identity                       |
| `PAHCollectionProvider`      | **Content**    | `catalog-backend-module-portal-content` | Uses `syncCollectionsByRepositories`       |
| `AnsibleGitContentsProvider` | **Content**    | `catalog-backend-module-portal-content` | SCM crawl                                  |
| `EEEntityProvider`           | **Scaffolder** | `scaffolder-backend-module-portal`      | Definition-path concern                    |

### 3.2 HTTP Routes

| Route Group       | Decision       | Destination                             | URL Stability   |
| ----------------- | -------------- | --------------------------------------- | --------------- |
| AAP sync triggers | **AAP**        | `catalog-backend-module-aap`            | Same paths      |
| Sync status       | **Shared**     | Each module registers own               | Aggregation TBD |
| PAH content sync  | **Content**    | `catalog-backend-module-portal-content` | Same paths      |
| SCM content sync  | **Content**    | `catalog-backend-module-portal-content` | Same paths      |
| EE register/build | **Scaffolder** | `scaffolder-backend-module-portal`      | Same paths      |
| Git helpers       | **Content**    | `catalog-backend-module-portal-content` | Same paths      |

### 3.3 Shared Infrastructure

| Component          | Decision                                                                    |
| ------------------ | --------------------------------------------------------------------------- |
| `config.ts`        | Per-module copy; each module reads only its config keys                     |
| `SyncStateTracker` | Duplicated or extracted to common; `/ansible/sync/status` needs aggregation |
| `entityParser.ts`  | AAP parsing stays in AAP module; content parsing moves to content module    |
| Backstage signals  | Each module registers its own refresh signals                               |

### 3.4 Permissions

| Permission                            | Post-Split Owner        |
| ------------------------------------- | ----------------------- |
| `catalogEntityReadPermission`         | Shared (Backstage core) |
| `executionEnvironmentsViewPermission` | Scaffolder module       |
| `gitRepositoriesViewPermission`       | Content module          |
| `collectionsViewPermission`           | Content module          |
| `templatesViewPermission`             | Self-service UI         |

---

## 4. Design Decisions

### 4.1 Minimal split preserves operator experience

The split creates 2-3 independently deployable modules instead of one. Operators who need only AAP identity sync can load `catalog-backend-module-aap` alone. Operators who need content browsing add `catalog-backend-module-portal-content`.

### 4.2 URL paths stay stable

All HTTP routes keep their current paths. The module serving the route changes, but the URL contract is preserved. RHDH `dynamic-plugins.yaml` changes from one entry to multiple.

### 4.3 Entity refs stay stable

Entity references (`user:default/alice`, `template:default/my-job`, etc.) are unchanged. The provider producing them changes, but downstream consumers see no difference.

### 4.4 Sync status aggregation

If providers split across modules, `/ansible/sync/status` must aggregate results. Options:

1. Each module exposes its own status endpoint, UI aggregates
2. A thin aggregator route queries all modules (complex)
3. Status moves to a shared backend service

**Recommended:** Option 1 — each module owns its status; self-service UI aggregates.

### 4.5 PAHCollectionProvider transition

`PAHCollectionProvider` calls `syncCollectionsByRepositories` from `IAAPService`. When the AAP integration split removes this method from the published interface, the provider must either:

- Import from the backward-compatibility shim until the content workspace claims it
- Move to a content-owned service contract

**Recommended:** Provider stays in catalog-module with shim import until content workspace is ready.

---

## 5. Phases

### Phase 0 — Contract Inventory

| Item                                                  | Status |
| ----------------------------------------------------- | ------ |
| Document all entity provider outputs (kinds, refs)    | ✅     |
| Document all HTTP routes with auth requirements       | ✅     |
| Map downstream consumers to entity/route dependencies | ✅     |
| Identify sync status aggregation requirements         | ✅     |

### Phase 1 — Split the Backend Module

| Item                                                                       | Notes                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| Create `workspaces/aap/plugins/catalog-backend-module-aap/`                | AAP providers + sync routes. `moduleId: 'aap'`           |
| Create `workspaces/content/plugins/catalog-backend-module-portal-content/` | Content providers + routes. `moduleId: 'portal-content'` |
| Move EE provider + routes to scaffolder module                             | Coordinate with scaffolder split                         |
| Split `config.d.ts` per module                                             | AAP owns AAP keys; content owns content keys             |
| Deprecate original package                                                 | Retained as shim with deprecation warning                |

**Verification:** All catalog tests pass; entity sync works end-to-end in dev app.

### Phase 2 — URL Compatibility Layer

| Item                                               | Notes                                 |
| -------------------------------------------------- | ------------------------------------- |
| Verify all routes work with split modules          | Same paths, different backing modules |
| Update RHDH `dynamic-plugins.yaml` examples        | Multiple plugin entries               |
| Document operator migration from monolith to split | Changelog entry                       |

### Phase 3 — Content Workspace Independence

| Item                                               | Notes                       |
| -------------------------------------------------- | --------------------------- |
| `PAHCollectionProvider` uses content-owned service | Drop AAP service dependency |
| Git content provider fully independent             | No AAP imports              |
| Content module has zero AAP workspace imports      | Clean boundary              |

---

## 6. Contracts

| Consumer                | Contract                                       | Provided by                    |
| ----------------------- | ---------------------------------------------- | ------------------------------ |
| Auth provider           | Catalog `User` entities with stable refs       | AAP catalog module             |
| Scaffolder autocomplete | Catalog entity query API unchanged             | Backstage catalog core         |
| Self-service UI         | EE entity shape + HTTP URLs unchanged          | Scaffolder catalog module      |
| Operators               | Multiple dynamic plugin entries instead of one | Updated `dynamic-plugins.yaml` |

**Semver:** Internal split — minor bump on new packages; major bump on deprecated shim with breaking removal timeline.

---

## 7. Operator Impact

| Area                        | Before (Today)                      | After (Proposed)                                |
| --------------------------- | ----------------------------------- | ----------------------------------------------- |
| `dynamic-plugins.yaml`      | One `catalog-backend-module-rhaap`  | 2-3 entries (aap, content, scaffolder-owned EE) |
| Config keys                 | All under `catalog.providers.rhaap` | Split per module                                |
| Sync URLs                   | All on catalog backend              | Same paths, different modules                   |
| Minimal AAP-only deployment | Load full module, ignore content    | Load only `catalog-backend-module-aap`          |

**Migration:** Operators update `dynamic-plugins.yaml` to replace the single entry with the split modules they need. Config keys are backward-compatible.

---

## 8. Open Questions

| Question                                                           | Decision Needed By |
| ------------------------------------------------------------------ | ------------------ |
| Should sync status be aggregated server-side or client-side?       | Phase 1            |
| Should `PAHCollectionProvider` stay in catalog or move to content? | Phase 1            |
| What is the minimal dynamic plugin set for AAP-only identity sync? | Phase 1            |
| Should Git helpers move to content or stay with catalog?           | Phase 1            |

---

## 9. Source File Map

| Concern             | Current Path                                                           | Target                                                 |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| AAP providers       | `catalog-backend-module-rhaap/src/providers/AAP*.ts`                   | `catalog-backend-module-aap/src/providers/`            |
| Content providers   | `catalog-backend-module-rhaap/src/providers/PAH*.ts`, `AnsibleGit*.ts` | `catalog-backend-module-portal-content/src/providers/` |
| EE provider         | `catalog-backend-module-rhaap/src/providers/EE*.ts`                    | `scaffolder-backend-module-portal/src/providers/`      |
| AAP sync routes     | `catalog-backend-module-rhaap/src/router.ts` (partial)                 | `catalog-backend-module-aap/src/router.ts`             |
| Content sync routes | `catalog-backend-module-rhaap/src/router.ts` (partial)                 | `catalog-backend-module-portal-content/src/router.ts`  |
| EE routes           | `catalog-backend-module-rhaap/src/router.ts` (partial)                 | `scaffolder-backend-module-portal/src/router.ts`       |
| Config              | `catalog-backend-module-rhaap/config.d.ts`                             | Split per module                                       |
| Module registration | `catalog-backend-module-rhaap/src/module.ts`                           | Split per module                                       |

---

## 10. Alignment with Sibling Efforts

| Related Effort        | Relevance                                                               |
| --------------------- | ----------------------------------------------------------------------- |
| AAP integration split | Defines `IAAPService` boundary; catalog uses it via `ansibleServiceRef` |
| Scaffolder split      | EE provider + routes move to scaffolder-owned module                    |
| Content workspace     | PAH and Git providers eventually move here                              |
| Portal core           | ContributionRegistry; no direct catalog dependency                      |

---

## 11. References

| Document                             | Description                                       |
| ------------------------------------ | ------------------------------------------------- |
| Content Experience Architecture      | Target architecture (§7.3–7.4 catalog boundaries) |
| AAP Integration Implementation Guide | AAP workspace split — keep/leave tables           |
| Scaffolder Implementation Guide      | Scaffolder action split                           |
| `docs/plugins/catalog.md`            | Official operator catalog documentation           |
