import { mockServices } from '@backstage/backend-test-utils';
import type { CatalogClient } from '@backstage/catalog-client';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type { IApmeService } from '@ansible/backstage-apme-common';
import { PortalOperations } from '@ansible/portal-plugin-node';
import { registerApmeOperations } from './operations';
import { ManualGitRepositoryProvider } from './providers/ManualGitRepositoryProvider';
import type { EntityProviderConnection } from '@backstage/plugin-catalog-node';

describe('APME scan operation', () => {
  const getEntityByRef = jest.fn();
  const getProjectByRepoUrl = jest.fn();
  const triggerScan = jest.fn();
  const applyMutation = jest.fn();
  const deleteProject = jest.fn();
  let manualProvider: ManualGitRepositoryProvider;
  const permissions = mockServices.permissions.mock();
  const registry = () => {
    const operations = new PortalOperations(mockServices.logger.mock());
    registerApmeOperations({
      manualProvider,
      operations,
      permissions,
      auth: mockServices.auth(),
      catalogClient: { getEntityByRef } as unknown as CatalogClient,
      apmeService: {
        getProjectByRepoUrl,
        triggerScan,
        deleteProject,
      } as unknown as IApmeService,
      resolveScanVersion: async () => '2.16',
      resolveEnableAi: async () => false,
    });
    return operations;
  };
  const context = {
    credentials: {
      $$type: '@backstage/BackstageCredentials' as const,
      principal: { type: 'user', userEntityRef: 'user:acme/alice' },
    },
    userId: 'alice',
    userEntityRef: 'user:acme/alice',
    organizationId: 'acme',
  };
  const subject = { entityRef: 'component:acme/repo' };
  const entity = {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: 'repo',
      namespace: 'acme',
      annotations: {
        'backstage.io/source-location': 'url:https://github.com/acme/repo',
      },
    },
    spec: { type: 'git-repository', repository_default_branch: 'main' },
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    manualProvider = new ManualGitRepositoryProvider();
    await manualProvider.connect({
      applyMutation,
    } as unknown as EntityProviderConnection);
    permissions.authorize.mockResolvedValue([
      { result: AuthorizeResult.ALLOW },
    ]);
    getEntityByRef.mockResolvedValue(entity);
    getProjectByRepoUrl.mockResolvedValue({ id: 'trusted-project' });
    triggerScan.mockResolvedValue({ scanId: 'scan-1', status: 'pending' });
  });
  const manualEntity = {
    ...entity,
    metadata: {
      ...entity.metadata,
      annotations: {
        ...entity.metadata.annotations,
        'ansible.io/registration-method': 'manual',
      },
    },
  };
  it('deregisters only the Portal provider entry and preserves gateway data', async () => {
    getEntityByRef.mockResolvedValue(manualEntity);
    await expect(
      registry().execute(
        'apme.repository.deregister',
        { subject },
        context,
        permissions,
      ),
    ).resolves.toEqual({ entityRef: subject.entityRef, subjectRemoved: true });
    expect(applyMutation).toHaveBeenCalledWith({
      type: 'delta',
      added: [],
      removed: [
        { entity: manualEntity, locationKey: 'ManualGitRepositoryProvider' },
      ],
    });
    expect(deleteProject).not.toHaveBeenCalled();
    expect(triggerScan).not.toHaveBeenCalled();
  });
  it('requires deregistration permission before catalog lookup', async () => {
    permissions.authorize.mockResolvedValue([{ result: AuthorizeResult.DENY }]);
    await expect(
      registry().execute(
        'apme.repository.deregister',
        { subject },
        context,
        permissions,
      ),
    ).rejects.toThrow();
    expect(getEntityByRef).not.toHaveBeenCalled();
    expect(applyMutation).not.toHaveBeenCalled();
  });
  it('rejects crawler-owned and cross-organization deregistration', async () => {
    await expect(
      registry().execute(
        'apme.repository.deregister',
        { subject },
        context,
        permissions,
      ),
    ).rejects.toThrow('manually');
    getEntityByRef.mockResolvedValue({
      ...manualEntity,
      metadata: { ...manualEntity.metadata, namespace: 'other' },
    });
    await expect(
      registry().execute(
        'apme.repository.deregister',
        { subject },
        context,
        permissions,
      ),
    ).rejects.toThrow('organization');
    expect(applyMutation).not.toHaveBeenCalled();
  });
  it('rejects scan requests against stale catalog data after removal', async () => {
    getEntityByRef.mockResolvedValue(manualEntity);
    const operations = registry();
    await operations.execute(
      'apme.repository.deregister',
      { subject },
      context,
      permissions,
    );
    await expect(
      operations.execute(
        'apme.quality.scan',
        { subject },
        context,
        permissions,
      ),
    ).rejects.toThrow('no longer tracked');
    expect(triggerScan).not.toHaveBeenCalled();
  });
  it('resolves the project from authoritative catalog data and forwards identity', async () => {
    await expect(
      registry().execute(
        'apme.quality.scan',
        { subject },
        context,
        permissions,
      ),
    ).resolves.toEqual({ scanId: 'scan-1', status: 'pending' });
    expect(getProjectByRepoUrl).toHaveBeenCalledWith(
      'https://github.com/acme/repo',
      'main',
    );
    expect(triggerScan).toHaveBeenCalledWith('trusted-project', {
      ansibleVersion: '2.16',
      enableAi: false,
      userIdentity: { userEntityRef: 'user:acme/alice' },
    });
  });
  it('rejects caller-provided project IDs', async () => {
    await expect(
      registry().execute(
        'apme.quality.scan',
        { subject, input: { projectId: 'someone-elses-project' } },
        context,
        permissions,
      ),
    ).rejects.toThrow('schema');
    expect(triggerScan).not.toHaveBeenCalled();
  });
  it('rejects a subject the user cannot read', async () => {
    permissions.authorize
      .mockResolvedValueOnce([{ result: AuthorizeResult.ALLOW }])
      .mockResolvedValueOnce([{ result: AuthorizeResult.DENY }]);
    await expect(
      registry().execute(
        'apme.quality.scan',
        { subject },
        context,
        permissions,
      ),
    ).rejects.toThrow('access denied');
    expect(getEntityByRef).not.toHaveBeenCalled();
    expect(triggerScan).not.toHaveBeenCalled();
  });
  it('rejects a repository outside the organization', async () => {
    getEntityByRef.mockResolvedValue({
      ...entity,
      metadata: { ...entity.metadata, namespace: 'other' },
    });
    await expect(
      registry().execute(
        'apme.quality.scan',
        { subject },
        context,
        permissions,
      ),
    ).rejects.toThrow('organization');
    expect(triggerScan).not.toHaveBeenCalled();
  });
  it('rejects unsupported entities and missing APME projects', async () => {
    getEntityByRef.mockResolvedValue({
      ...entity,
      spec: { type: 'collection' },
    });
    await expect(
      registry().execute(
        'apme.quality.scan',
        { subject },
        context,
        permissions,
      ),
    ).rejects.toThrow('Git repository');
    getEntityByRef.mockResolvedValue(entity);
    getProjectByRepoUrl.mockResolvedValue(null);
    await expect(
      registry().execute(
        'apme.quality.scan',
        { subject },
        context,
        permissions,
      ),
    ).rejects.toThrow('no APME project');
    expect(triggerScan).not.toHaveBeenCalled();
  });
});
