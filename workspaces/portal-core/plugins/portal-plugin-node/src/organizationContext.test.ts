import { ConfigReader } from '@backstage/config';
import { mockServices } from '@backstage/backend-test-utils';
import {
  assertEntityOrganization,
  organizationCatalogNamespaces,
  PORTAL_ORGANIZATION_ANNOTATION,
  resolvePortalContext,
} from './organizationContext';

describe('trusted Portal organization context', () => {
  const credentials = {
    $$type: '@backstage/BackstageCredentials' as const,
    principal: { type: 'user', userEntityRef: 'user:default/alice' },
  };
  const userInfo = mockServices.userInfo.mock();
  const organizations = { resolve: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
    userInfo.getUserInfo.mockResolvedValue({
      userEntityRef: 'user:default/alice',
      ownershipEntityRefs: [],
    });
    organizations.resolve.mockResolvedValue('engineering');
  });
  it('does not confuse identity namespace with deployment organization', async () => {
    await expect(
      resolvePortalContext({ credentials, userInfo, organizations }),
    ).resolves.toEqual({
      userId: 'alice',
      userEntityRef: 'user:default/alice',
      organizationId: 'engineering',
    });
    expect(organizations.resolve).toHaveBeenCalledWith(credentials);
  });
  it.each([undefined, '', '  '])(
    'rejects unresolved organization %j',
    async value => {
      organizations.resolve.mockResolvedValue(value);
      await expect(
        resolvePortalContext({ credentials, userInfo, organizations }),
      ).rejects.toThrow('missing or ambiguous');
    },
  );
  it('denies resolver failure', async () => {
    organizations.resolve.mockRejectedValue(new Error('Unavailable'));
    await expect(
      resolvePortalContext({ credentials, userInfo, organizations }),
    ).rejects.toThrow('could not be resolved');
  });
  it('rejects service callers and invalid identities', async () => {
    await expect(
      resolvePortalContext({
        credentials: await mockServices.auth().getOwnServiceCredentials(),
        userInfo,
        organizations,
      }),
    ).rejects.toThrow('authenticated user');
    expect(organizations.resolve).not.toHaveBeenCalled();
    userInfo.getUserInfo.mockResolvedValue({
      userEntityRef: 'not-a-user-ref',
      ownershipEntityRefs: [],
    });
    await expect(
      resolvePortalContext({ credentials, userInfo, organizations }),
    ).rejects.toThrow('identity');
  });
});

describe('host-owned catalog partition policy', () => {
  const entity = { metadata: { namespace: 'default' } };
  const config = (
    catalogMappings: Array<{ organizationId: string; namespaces?: string[] }>,
  ) => new ConfigReader({ portal: { organization: { catalogMappings } } });
  it('preserves default deployments without configuration changes', () => {
    expect(
      organizationCatalogNamespaces(new ConfigReader({}), 'default'),
    ).toEqual(['default']);
    expect(() =>
      assertEntityOrganization(entity, 'default', new ConfigReader({})),
    ).not.toThrow();
  });
  it('does not assume every default entity belongs to a non-default organization', () => {
    expect(() =>
      assertEntityOrganization(entity, 'engineering', new ConfigReader({})),
    ).toThrow('outside');
  });
  it('permits an explicit compatibility mapping without changing entity refs', () => {
    const policy = config([
      { organizationId: 'engineering', namespaces: ['default', 'engineering'] },
    ]);
    expect(organizationCatalogNamespaces(policy, 'engineering')).toEqual([
      'default',
      'engineering',
    ]);
    expect(() =>
      assertEntityOrganization(entity, 'engineering', policy),
    ).not.toThrow();
  });
  it('rejects an explicitly different organization even within a mapped namespace', () => {
    const policy = config([
      { organizationId: 'engineering', namespaces: ['default'] },
    ]);
    expect(() =>
      assertEntityOrganization(
        {
          metadata: {
            namespace: 'default',
            annotations: { [PORTAL_ORGANIZATION_ANNOTATION]: 'sales' },
          },
        },
        'engineering',
        policy,
      ),
    ).toThrow('outside');
  });
  it.each([
    [{ organizationId: 'engineering', namespaces: [] }],
    [{ organizationId: 'engineering', namespaces: ['*'] }],
    [{ organizationId: 'engineering', namespaces: ['default', 'default'] }],
    [
      { organizationId: 'engineering', namespaces: ['default'] },
      { organizationId: 'sales', namespaces: ['default'] },
    ],
    [
      { organizationId: 'engineering', namespaces: ['default'] },
      { organizationId: 'engineering', namespaces: ['engineering'] },
    ],
    [{ organizationId: 'engineering' }],
  ])('rejects invalid or overlapping namespace mappings %j', (...mappings) => {
    expect(() =>
      organizationCatalogNamespaces(config(mappings), 'engineering'),
    ).toThrow('Invalid or ambiguous');
  });
  it('cannot implicitly claim a namespace already assigned to another organization', () => {
    expect(() =>
      organizationCatalogNamespaces(
        config([{ organizationId: 'engineering', namespaces: ['default'] }]),
        'default',
      ),
    ).toThrow('ambiguous');
  });
});
