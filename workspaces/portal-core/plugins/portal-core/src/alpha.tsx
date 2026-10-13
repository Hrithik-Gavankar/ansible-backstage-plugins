import {
  createFrontendPlugin,
  ApiBlueprint,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { Navigate } from 'react-router-dom';
import { compatWrapper } from '@backstage/core-compat-api';
import { createPortalContributionProvider } from '@ansible/portal-extension-host/alpha';
import {
  portalOperationsApiFactory,
  portalEntitlementsApiFactory,
} from '@ansible/portal-extension-api';

/** NFS host: contribution ownership belongs to `portal`, not a contributor. */
export default createFrontendPlugin({
  pluginId: 'portal',
  extensions: [
    PageBlueprint.make({
      name: 'landing',
      params: {
        path: '/',
        noHeader: true,
        loader: async () =>
          compatWrapper(<Navigate to="/self-service" replace />),
      },
    }),
    createPortalContributionProvider(),
    ApiBlueprint.make({
      name: 'operations',
      params: define => define(portalOperationsApiFactory),
    }),
    ApiBlueprint.make({
      name: 'entitlements',
      params: define => define(portalEntitlementsApiFactory),
    }),
  ],
});
