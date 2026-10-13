import express from 'express';
import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';
import type {
  HttpAuthService,
  UserInfoService,
  PermissionsService,
} from '@backstage/backend-plugin-api';
import type { PortalOperations } from '@ansible/portal-plugin-node';

export function createRouter(options: {
  operations: PortalOperations;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  permissions: PermissionsService;
}): express.Router {
  const router = express.Router();
  router.post(
    '/:operationId',
    express.json({ limit: '64kb' }),
    async (req, res) => {
      // Backstage currently exports Express 4 request types; this router uses
      // Express 5. Adapt only this platform seam, not operation contracts.
      const credentials = await options.httpAuth.credentials(
        req as unknown as Parameters<HttpAuthService['credentials']>[0],
        { allow: ['user'] },
      );
      const identity = await options.userInfo.getUserInfo(credentials);
      const user = parseEntityRef(identity.userEntityRef);
      const body = req.body;
      if (
        !body ||
        typeof body.subject?.entityRef !== 'string' ||
        Object.keys(body).some(key => !['subject', 'input'].includes(key)) ||
        Object.keys(body.subject).some(key => key !== 'entityRef') ||
        (body.input !== undefined &&
          (body.input === null ||
            typeof body.input !== 'object' ||
            Array.isArray(body.input)))
      ) {
        throw new InputError(
          'Expected subject.entityRef and optional object input',
        );
      }
      let entityRef: string;
      try {
        entityRef = stringifyEntityRef(parseEntityRef(body.subject.entityRef));
      } catch {
        throw new InputError('Invalid subject entity reference');
      }
      const result = await options.operations.execute(
        req.params.operationId,
        {
          subject: { entityRef },
          input: body.input,
        },
        {
          credentials,
          userEntityRef: identity.userEntityRef,
          userId: user.name,
          organizationId: user.namespace,
        },
        options.permissions,
      );
      res.json({ result });
    },
  );
  return router;
}
