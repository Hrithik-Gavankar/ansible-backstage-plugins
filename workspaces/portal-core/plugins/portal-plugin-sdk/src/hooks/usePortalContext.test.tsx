/* eslint-disable no-console */
import { renderHook, waitFor } from '@testing-library/react';
import { usePortalContext } from './usePortalContext';
import { identityApiRef } from '@backstage/core-plugin-api';
import { TestApiProvider } from '@backstage/test-utils';
import type { ReactNode } from 'react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeIdentityApi = (userEntityRef: string | undefined) => ({
  getBackstageIdentity: jest.fn().mockResolvedValue({ userEntityRef }),
  getCredentials: jest.fn(),
  getProfileInfo: jest.fn(),
  signOut: jest.fn(),
});

const makeWrapper =
  (userEntityRef: string | undefined) =>
  ({ children }: { children: ReactNode }) => (
    <TestApiProvider apis={[[identityApiRef, makeIdentityApi(userEntityRef)]]}>
      {children}
    </TestApiProvider>
  );

const makeFailWrapper =
  (error: Error) =>
  ({ children }: { children: ReactNode }) => {
    const failingApi = {
      getBackstageIdentity: jest.fn().mockRejectedValue(error),
      getCredentials: jest.fn(),
      getProfileInfo: jest.fn(),
      signOut: jest.fn(),
    };
    return (
      <TestApiProvider apis={[[identityApiRef, failingApi]]}>
        {children}
      </TestApiProvider>
    );
  };

// ── usePortalContext ──────────────────────────────────────────────────────────

describe('usePortalContext', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the namespace as organizationId', async () => {
    const { result } = renderHook(() => usePortalContext(), {
      wrapper: makeWrapper('user:red-hat/alice'),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.organizationId).toBe('red-hat');
    expect(result.current.error).toBeNull();
  });

  it('returns "default" for the default namespace', async () => {
    const { result } = renderHook(() => usePortalContext(), {
      wrapper: makeWrapper('user:default/alice'),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.organizationId).toBe('default');
  });

  it('falls back to "default" when userEntityRef is undefined (guest)', async () => {
    const { result } = renderHook(() => usePortalContext(), {
      wrapper: makeWrapper(undefined),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.organizationId).toBe('default');
    expect(result.current.error).toBeNull();
  });

  it('starts in loading state with empty organizationId', () => {
    const { result } = renderHook(() => usePortalContext(), {
      wrapper: makeWrapper('user:default/alice'),
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.organizationId).toBe('');
  });

  it('sets error and falls back to "default" when identity API rejects', async () => {
    const { result } = renderHook(() => usePortalContext(), {
      wrapper: makeFailWrapper(new Error('Auth failure')),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Auth failure');
    expect(result.current.organizationId).toBe('default');
  });

  it('wraps non-Error rejections in an Error', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => {
      const api = {
        getBackstageIdentity: jest.fn().mockRejectedValue('string error'),
        getCredentials: jest.fn(),
        getProfileInfo: jest.fn(),
        signOut: jest.fn(),
      };
      return (
        <TestApiProvider apis={[[identityApiRef, api]]}>
          {children}
        </TestApiProvider>
      );
    };

    const { result } = renderHook(() => usePortalContext(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe(
      'Failed to resolve portal context',
    );
  });
});
