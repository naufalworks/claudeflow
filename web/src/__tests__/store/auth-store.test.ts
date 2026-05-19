import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuthStore } from '@/store/auth-store';

describe('useAuthStore', () => {
  beforeEach(() => {
    // Clear store state before each test
    useAuthStore.setState({ apiKey: null, isAuthenticated: false });
    localStorage.clear();
    document.cookie = '';
  });

  describe('login', () => {
    it('sets apiKey and isAuthenticated to true', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.login('test-api-key');
      });

      expect(result.current.apiKey).toBe('test-api-key');
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('trims whitespace from apiKey', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.login('  test-api-key  ');
      });

      expect(result.current.apiKey).toBe('test-api-key');
    });

    it('throws error for empty apiKey', () => {
      const { result } = renderHook(() => useAuthStore());

      expect(() => {
        act(() => {
          result.current.login('');
        });
      }).toThrow('API key cannot be empty');
    });

    it('throws error for whitespace-only apiKey', () => {
      const { result } = renderHook(() => useAuthStore());

      expect(() => {
        act(() => {
          result.current.login('   ');
        });
      }).toThrow('API key cannot be empty');
    });

    it('sets authentication cookie', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.login('test-api-key');
      });

      expect(document.cookie).toContain('claudeflow-auth=true');
    });
  });

  describe('logout', () => {
    it('clears apiKey and sets isAuthenticated to false', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.login('test-api-key');
      });

      expect(result.current.isAuthenticated).toBe(true);

      act(() => {
        result.current.logout();
      });

      expect(result.current.apiKey).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('clears authentication cookie', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.login('test-api-key');
        result.current.logout();
      });

      expect(document.cookie).toContain('expires=Thu, 01 Jan 1970');
    });
  });

  describe('checkAuth', () => {
    it('returns true when apiKey is valid', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.login('test-api-key');
      });

      const isValid = result.current.checkAuth();
      expect(isValid).toBe(true);
    });

    it('returns false when apiKey is null', () => {
      const { result } = renderHook(() => useAuthStore());

      const isValid = result.current.checkAuth();
      expect(isValid).toBe(false);
    });

    it('returns false when apiKey is empty string', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        useAuthStore.setState({ apiKey: '', isAuthenticated: true });
      });

      const isValid = result.current.checkAuth();
      expect(isValid).toBe(false);
    });

    it('syncs isAuthenticated state when mismatched', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        useAuthStore.setState({ apiKey: 'test-key', isAuthenticated: false });
      });

      act(() => {
        result.current.checkAuth();
      });

      expect(result.current.isAuthenticated).toBe(true);
    });
  });

  describe('persistence', () => {
    it('persists state to localStorage', async () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.login('test-api-key');
      });

      await waitFor(() => {
        const stored = localStorage.getItem('claudeflow-auth');
        expect(stored).toBeTruthy();
        if (stored) {
          const parsed = JSON.parse(stored);
          expect(parsed.state.apiKey).toBe('test-api-key');
          expect(parsed.state.isAuthenticated).toBe(true);
        }
      });
    });

    it('rehydrates state from localStorage', async () => {
      const mockState = {
        state: {
          apiKey: 'stored-api-key',
          isAuthenticated: true,
        },
        version: 0,
      };

      localStorage.setItem('claudeflow-auth', JSON.stringify(mockState));

      const { result } = renderHook(() => useAuthStore());

      await waitFor(() => {
        expect(result.current.apiKey).toBe('stored-api-key');
        expect(result.current.isAuthenticated).toBe(true);
      });
    });
  });
});
