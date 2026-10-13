import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { registerGitRepositoryAction } from './actions/registerGitRepository';
import { portalOperationsServiceRef } from '@ansible/portal-plugin-node';

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'apme',
  register(reg) {
    reg.registerInit({
      deps: {
        actions: scaffolderActionsExtensionPoint,
        auth: coreServices.auth,
        userInfo: coreServices.userInfo,
        permissions: coreServices.permissions,
        operations: portalOperationsServiceRef,
      },
      async init({ actions, auth, userInfo, permissions, operations }) {
        actions.addActions(
          registerGitRepositoryAction({
            auth,
            userInfo,
            permissions,
            operations,
          }),
        );
      },
    });
  },
});
