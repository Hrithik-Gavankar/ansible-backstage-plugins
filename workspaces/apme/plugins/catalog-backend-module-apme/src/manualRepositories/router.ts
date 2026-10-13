import PromiseRouter from 'express-promise-router';
import type { Router } from 'express';
import type {
  HttpAuthService,
  PermissionsService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';
import type { PortalOperations } from '@ansible/portal-plugin-node';
import { apmeRepositoryRegisterOperation } from '@ansible/backstage-apme-common/operations';
import { jsonBody } from '../jsonBody';

/** Legacy transport adapter. The operation alone owns validation and mutation. */
export function createManualRepositoriesRouter(options: {
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  permissions: PermissionsService;
  operations: PortalOperations;
}): Router {
  const router = PromiseRouter();
  router.post('/apme/repositories', jsonBody, async (req, res) => {
    const credentials = await options.httpAuth.credentials(
      req as unknown as Parameters<HttpAuthService['credentials']>[0],
      { allow: ['user'] },
    );
    const identity = await options.userInfo.getUserInfo(credentials);
    const user = parseEntityRef(identity.userEntityRef);
    const submitted = req.body?.entity;
    if (
      submitted?.kind !== 'Component' ||
      submitted.spec?.type !== 'git-repository' ||
      submitted.metadata?.annotations?.['ansible.io/registration-method'] !==
        'manual'
    ) {
      throw new InputError('Invalid manual repository entity');
    }
    const annotations = submitted.metadata.annotations;
    const result = (await options.operations.execute(
      apmeRepositoryRegisterOperation.id,
      {
        subject: { entityRef: identity.userEntityRef },
        input: {
          sourceControlProvider: annotations['ansible.io/scm-provider'],
          repositoryOwner: annotations['ansible.io/scm-organization'],
          repositoryName: annotations['ansible.io/scm-repository'],
          repositoryUrl: annotations['backstage.io/view-url'],
          defaultBranch: submitted.spec.repository_default_branch ?? 'main',
          ...(typeof submitted.metadata.description === 'string'
            ? { description: submitted.metadata.description }
            : {}),
        },
      },
      {
        credentials,
        userEntityRef: identity.userEntityRef,
        userId: user.name,
        organizationId: user.namespace,
      },
      options.permissions,
    )) as { entityRef: string };
    res.status(201).json({ success: true, entityRef: result.entityRef });
  });
  return router as unknown as Router;
}
