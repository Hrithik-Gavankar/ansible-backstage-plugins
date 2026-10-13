import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { PortalEntitlementsClient } from './entitlements';

describe('entitlement client', () => {
  const getBaseUrl = jest
    .fn()
    .mockResolvedValue('https://portal/api/portal-operations');
  const fetch = jest.fn();
  const client = new PortalEntitlementsClient(
    { getBaseUrl } as unknown as DiscoveryApi,
    { fetch } as FetchApi,
  );
  it('uses discovery and authenticated fetch, sending IDs only', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ allowed: true, organizationId: 'default' }),
    });
    await expect(
      client.check('apme.scanning', 'component:default/repo'),
    ).resolves.toEqual({ allowed: true, organizationId: 'default' });
    expect(getBaseUrl).toHaveBeenCalledWith('portal-operations');
    expect(fetch).toHaveBeenCalledWith(
      'https://portal/api/portal-operations/entitlements/apme.scanning?entityRef=component%3Adefault%2Frepo',
    );
  });
  it.each([{}, { allowed: 'true' }, { allowed: true, organizationId: 123 }])(
    'rejects malformed decisions %j',
    async decision => {
      fetch.mockResolvedValue({ ok: true, json: async () => decision });
      await expect(
        client.check('apme.scanning', 'component:default/repo'),
      ).rejects.toThrow('Invalid entitlement decision');
    },
  );
  it('does not convert backend failure to an allow decision', async () => {
    fetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(
      client.check('apme.scanning', 'component:default/repo'),
    ).rejects.toThrow('HTTP 403');
  });
});
