/**
 * UI Store
 *
 * Manages UI state including theme, sidebar visibility, and command palette.
 * Persists theme preference to localStorage.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
  commandPaletteOpen: boolean;
  keyboardShortcutsModalOpen: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleKeyboardShortcutsModal: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      sidebarOpen: true,
      commandPaletteOpen: false,
      keyboardShortcutsModalOpen: false,

      toggleTheme: () => {
        const { theme } = get();
        const nextTheme: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
        set({ theme: nextTheme });
      },

      setTheme: (theme: Theme) => {
        set({ theme });
      },

      toggleSidebar: () => {
        set((state) => ({ sidebarOpen: !state.sidebarOpen }));
      },

      setSidebarOpen: (open: boolean) => {
        set({ sidebarOpen: open });
      },

      openCommandPalette: () => {
        set({ commandPaletteOpen: true });
      },

      closeCommandPalette: () => {
        set({ commandPaletteOpen: false });
      },

      toggleKeyboardShortcutsModal: () => {
        set((state) => ({ keyboardShortcutsModalOpen: !state.keyboardShortcutsModalOpen }));
      },
    }),
    {
      name: 'claudeflow-ui',
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
);
