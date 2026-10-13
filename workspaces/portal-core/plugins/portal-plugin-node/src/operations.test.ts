import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { createBackendPlugin } from '@backstage/backend-plugin-api';
import {
  AuthorizeResult,
  createPermission,
} from '@backstage/plugin-permission-common';
import { PortalOperations, portalOperationsServiceRef } from './operations';

describe('PortalOperations', () => {
  const logger = mockServices.logger.mock();
  const permissions = mockServices.permissions.mock();
  const credentials = mockServices.auth().getOwnServiceCredentials();
  const context = {
    credentials: {} as Awaited<typeof credentials>,
    userId: 'alice',
    userEntityRef: 'user:acme/alice',
    organizationId: 'acme',
  };
  const request = { subject: { entityRef: 'component:acme/repo' }, input: {} };
  const descriptor = {
    id: 'test.scan',
    version: '1.0.0',
    exposure: { rest: true },
    permission: createPermission({
      name: 'test.scan',
      attributes: { action: 'create' },
    }),
    inputSchema: { type: 'object', additionalProperties: false },
  };
  let registry: PortalOperations;
  let handler: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new PortalOperations(logger);
    handler = jest.fn().mockResolvedValue({ jobId: 'scan-1' });
    permissions.authorize.mockResolvedValue([
      { result: AuthorizeResult.ALLOW },
    ]);
    registry.register({ pluginId: 'test', descriptor, handler });
  });

  it('authorizes, invokes and audits a registered handler', async () => {
    await expect(
      registry.execute('test.scan', request, context, permissions),
    ).resolves.toEqual({ jobId: 'scan-1' });
    expect(handler).toHaveBeenCalledWith(request, context);
    expect(logger.info).toHaveBeenCalledWith(
      '[portal-audit]',
      expect.objectContaining({ outcome: 'SUCCESS', organizationId: 'acme' }),
    );
  });
  it('does not execute a denied operation', async () => {
    permissions.authorize.mockResolvedValue([{ result: AuthorizeResult.DENY }]);
    await expect(
      registry.execute('test.scan', request, context, permissions),
    ).rejects.toThrow('permission denied');
    expect(handler).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[portal-audit]',
      expect.objectContaining({ outcome: 'FAILURE' }),
    );
  });
  it('rejects extra input fields before executing', async () => {
    await expect(
      registry.execute(
        'test.scan',
        { ...request, input: { projectId: 'untrusted' } },
        context,
        permissions,
      ),
    ).rejects.toThrow('schema');
    expect(handler).not.toHaveBeenCalled();
  });
  it('rejects unknown and unexposed operations', async () => {
    await expect(
      registry.execute('unknown', request, context, permissions),
    ).rejects.toThrow('not available');
    registry.register({
      pluginId: 'test',
      descriptor: { ...descriptor, id: 'test.internal', exposure: {} },
      handler,
    });
    await expect(
      registry.execute('test.internal', request, context, permissions),
    ).rejects.toThrow('not available');
    expect(handler).not.toHaveBeenCalled();
  });
  it('rejects duplicate or unowned registrations', () => {
    expect(() =>
      registry.register({ pluginId: 'test', descriptor, handler }),
    ).toThrow('Duplicate');
    expect(() =>
      registry.register({ pluginId: 'other', descriptor, handler }),
    ).toThrow('owner-prefixed');
  });
  it('audits handler failure without logging private input or backend errors', async () => {
    handler.mockRejectedValue(new Error('secret upstream token'));
    await expect(
      registry.execute('test.scan', request, context, permissions),
    ).rejects.toThrow('secret');
    expect(logger.info).toHaveBeenCalledWith(
      '[portal-audit]',
      expect.objectContaining({
        outcome: 'FAILURE',
        input: { entityRef: 'component:acme/repo' },
      }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret');
  });
  it('validates output before reporting success', async () => {
    registry.register({
      pluginId: 'test',
      descriptor: {
        ...descriptor,
        id: 'test.output',
        outputSchema: { type: 'string' },
      },
      handler,
    });
    await expect(
      registry.execute('test.output', request, context, permissions),
    ).rejects.toThrow('output');
  });

  it('shares the injected root registry across different backend plugins', async () => {
    const instances: PortalOperations[] = [];
    const makePlugin = (pluginId: string) =>
      createBackendPlugin({
        pluginId,
        register(env) {
          env.registerInit({
            deps: { operations: portalOperationsServiceRef },
            async init({ operations }) {
              instances.push(operations);
            },
          });
        },
      });
    const backend = await startTestBackend({
      features: [makePlugin('contributor'), makePlugin('host')],
    });
    try {
      expect(instances).toHaveLength(2);
      expect(instances[0]).toBe(instances[1]);
      instances[0].register({ pluginId: 'test', descriptor, handler });
      await expect(
        instances[1].execute('test.scan', request, context, permissions),
      ).resolves.toEqual({ jobId: 'scan-1' });
    } finally {
      await backend.stop();
    }
  });
});
