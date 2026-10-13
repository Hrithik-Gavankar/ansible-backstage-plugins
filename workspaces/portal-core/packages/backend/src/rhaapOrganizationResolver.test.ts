import { ConfigReader } from '@backstage/config';
import type { BackstageCredentials } from '@backstage/backend-plugin-api';
import { RhaapOrganizationResolver } from './rhaapOrganizationResolver';

const credentials: BackstageCredentials = {
  $$type: '@backstage/BackstageCredentials',
  principal: { type: 'user', userEntityRef: 'user:unrelated/alice' },
  expiresAt: undefined,
};

describe('RHAAP deployment organization adapter', () => {
  it.each([
    [{ dev: { orgs: ' Default ' } }, 'default'],
    [{ dev: { orgs: [' Default '] } }, 'default'],
    [{ dev: { orgs: 'Default, Other' } }, 'default'],
    [
      { dev: { orgs: ['Default', 'Other'], multiOrgEnabled: false } },
      'default',
    ],
    [{ dev: { orgs: ['Default'], multiOrgEnabled: true } }, 'default'],
    [{ dev: { orgs: 'Default,Default', multiOrgEnabled: true } }, 'default'],
    [{ dev: { orgs: 'Default' }, prod: { orgs: 'DEFAULT' } }, 'default'],
    [{ dev: { orgs: ['Default', 'Other'], multiOrgEnabled: true } }, undefined],
    [{ dev: { orgs: 'Default' }, prod: { orgs: 'Other' } }, undefined],
    [{ dev: {} }, undefined],
    [{ dev: { orgs: '' } }, undefined],
    [{ dev: { orgs: [] } }, undefined],
    [{ dev: { orgs: ['Default', 123] } }, undefined],
    [{ dev: { orgs: 'Default', multiOrgEnabled: 'invalid' } }, undefined],
    [{}, undefined],
  ])('resolves configured providers %j to %j', async (providers, expected) => {
    const resolver = new RhaapOrganizationResolver(
      new ConfigReader({
        catalog: { providers: { rhaap: providers } },
        portal: { organization: { id: 'must-not-override' } },
      }),
    );
    await expect(resolver.resolve(credentials)).resolves.toBe(expected);
  });

  it('denies when no RHAAP providers exist, without inferring from identity', async () => {
    const resolver = new RhaapOrganizationResolver(new ConfigReader({}));
    await expect(resolver.resolve(credentials)).resolves.toBeUndefined();
  });
});
