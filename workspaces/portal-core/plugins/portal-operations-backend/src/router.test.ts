import express from 'express';
import request from 'supertest';
import { mockServices } from '@backstage/backend-test-utils';
import { createRouter } from './router';
import type { PortalOperations } from '@ansible/portal-plugin-node';

describe('operation transport', () => {
  const execute = jest.fn();
  const httpAuth = mockServices.httpAuth.mock();
  const userInfo = mockServices.userInfo.mock();
  const permissions = mockServices.permissions.mock();
  const app = express();
  app.use(
    createRouter({
      operations: { execute } as unknown as PortalOperations,
      httpAuth,
      userInfo,
      permissions,
    }),
  );
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(err.name === 'InputError' ? 400 : 401)
        .json({ error: err.message });
    },
  );
  beforeEach(() => {
    jest.clearAllMocks();
    httpAuth.credentials.mockResolvedValue({
      $$type: '@backstage/BackstageCredentials',
      principal: { type: 'user', userEntityRef: 'user:acme/alice' },
      expiresAt: undefined,
    });
    userInfo.getUserInfo.mockResolvedValue({
      userEntityRef: 'user:acme/alice',
      ownershipEntityRefs: [],
    });
    execute.mockResolvedValue({ jobId: '123' });
  });
  it('passes authenticated context and the canonical subject to the dispatcher', async () => {
    await request(app)
      .post('/apme.quality.scan')
      .send({ subject: { entityRef: 'component:acme/repo' } })
      .expect(200, { result: { jobId: '123' } });
    expect(httpAuth.credentials).toHaveBeenCalledWith(expect.anything(), {
      allow: ['user'],
    });
    expect(execute).toHaveBeenCalledWith(
      'apme.quality.scan',
      expect.objectContaining({
        subject: { entityRef: 'component:acme/repo' },
      }),
      expect.objectContaining({ organizationId: 'acme', userId: 'alice' }),
      permissions,
    );
  });
  it.each([
    {},
    { subject: {} },
    { subject: { entityRef: 123 } },
    {
      subject: { entityRef: 'component:acme/repo' },
      organizationId: 'another-org',
    },
    { subject: { entityRef: 'component:acme/repo', projectId: '123' } },
    { subject: { entityRef: 'component:acme/repo' }, input: [] },
  ])('rejects malformed requests: %j', async body => {
    await request(app).post('/apme.quality.scan').send(body).expect(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not invoke on authentication failure', async () => {
    httpAuth.credentials.mockRejectedValue(new Error('Unauthenticated'));
    await request(app)
      .post('/apme.quality.scan')
      .send({ subject: { entityRef: 'component:acme/repo' } })
      .expect(401);
    expect(execute).not.toHaveBeenCalled();
  });
});
