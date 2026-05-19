/**
 * Authentication Store
 *
 * Manages authentication state including API key storage and validation.
 * Persists to localStorage for session continuity and syncs with cookies for middleware.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  apiKey: string | null;
  isAuthenticated: boolean;
  login: (apiKey: string) => void;
  logout: () => void;
  checkAuth: () => boolean;
}

/**
 * Set authentication cookie for middleware
 */
function setAuthCookie(isAuthenticated: boolean) {
  if (typeof document === 'undefined') return;

  if (isAuthenticated) {
    document.cookie = 'claudeflow-auth=true; path=/; max-age=31536000; SameSite=Lax';
  } else {
    document.cookie = 'claudeflow-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      apiKey: null,
      isAuthenticated: false,

      login: (apiKey: string) => {
        if (!apiKey || apiKey.trim().length === 0) {
          throw new Error('API key cannot be empty');
        }
        set({ apiKey: apiKey.trim(), isAuthenticated: true });
        setAuthCookie(true);
      },

      logout: () => {
        set({ apiKey: null, isAuthenticated: false });
        setAuthCookie(false);
      },

      checkAuth: () => {
        const state = get();
        const isValid = state.apiKey !== null && state.apiKey.trim().length > 0;
        if (state.isAuthenticated !== isValid) {
          set({ isAuthenticated: isValid });
          setAuthCookie(isValid);
        }
        return isValid;
      },
    }),
    {
      name: 'claudeflow-auth',
      partialize: (state) => ({
        apiKey: state.apiKey,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // Sync cookie on rehydration
        if (state) {
          setAuthCookie(state.isAuthenticated);
        }
      },
    }
  )
);
