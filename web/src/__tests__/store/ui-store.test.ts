import { renderHook, act, waitFor } from '@testing-library/react';
import { useUIStore } from '@/store/ui-store';

describe('useUIStore', () => {
  beforeEach(() => {
    // Clear store state before each test
    useUIStore.setState({
      theme: 'system',
      sidebarOpen: true,
      commandPaletteOpen: false,
      keyboardShortcutsModalOpen: false,
    });
    localStorage.clear();
  });

  describe('theme', () => {
    it('defaults to system theme', () => {
      const { result } = renderHook(() => useUIStore());
      expect(result.current.theme).toBe('system');
    });

    it('toggles theme in correct order: light -> dark -> system -> light', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setTheme('light');
      });
      expect(result.current.theme).toBe('light');

      act(() => {
        result.current.toggleTheme();
      });
      expect(result.current.theme).toBe('dark');

      act(() => {
        result.current.toggleTheme();
      });
      expect(result.current.theme).toBe('system');

      act(() => {
        result.current.toggleTheme();
      });
      expect(result.current.theme).toBe('light');
    });

    it('sets theme directly', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(result.current.theme).toBe('dark');
    });
  });

  describe('sidebar', () => {
    it('defaults to open', () => {
      const { result } = renderHook(() => useUIStore());
      expect(result.current.sidebarOpen).toBe(true);
    });

    it('toggles sidebar state', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.toggleSidebar();
      });
      expect(result.current.sidebarOpen).toBe(false);

      act(() => {
        result.current.toggleSidebar();
      });
      expect(result.current.sidebarOpen).toBe(true);
    });

    it('sets sidebar state directly', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setSidebarOpen(false);
      });
      expect(result.current.sidebarOpen).toBe(false);

      act(() => {
        result.current.setSidebarOpen(true);
      });
      expect(result.current.sidebarOpen).toBe(true);
    });
  });

  describe('command palette', () => {
    it('defaults to closed', () => {
      const { result } = renderHook(() => useUIStore());
      expect(result.current.commandPaletteOpen).toBe(false);
    });

    it('opens command palette', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(true);
    });

    it('closes command palette', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openCommandPalette();
        result.current.closeCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(false);
    });
  });

  describe('keyboard shortcuts modal', () => {
    it('defaults to closed', () => {
      const { result } = renderHook(() => useUIStore());
      expect(result.current.keyboardShortcutsModalOpen).toBe(false);
    });

    it('toggles keyboard shortcuts modal', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.toggleKeyboardShortcutsModal();
      });
      expect(result.current.keyboardShortcutsModalOpen).toBe(true);

      act(() => {
        result.current.toggleKeyboardShortcutsModal();
      });
      expect(result.current.keyboardShortcutsModalOpen).toBe(false);
    });
  });

  describe('persistence', () => {
    it('persists theme and sidebar state to localStorage', async () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setTheme('dark');
        result.current.setSidebarOpen(false);
      });

      await waitFor(() => {
        const stored = localStorage.getItem('claudeflow-ui');
        expect(stored).toBeTruthy();
        if (stored) {
          const parsed = JSON.parse(stored);
          expect(parsed.state.theme).toBe('dark');
          expect(parsed.state.sidebarOpen).toBe(false);
        }
      });
    });

    it('does not persist command palette state', async () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openCommandPalette();
      });

      await waitFor(() => {
        const stored = localStorage.getItem('claudeflow-ui');
        if (stored) {
          const parsed = JSON.parse(stored);
          expect(parsed.state.commandPaletteOpen).toBeUndefined();
        }
      });
    });

    it('rehydrates state from localStorage', async () => {
      const mockState = {
        state: {
          theme: 'dark',
          sidebarOpen: false,
        },
        version: 0,
      };

      localStorage.setItem('claudeflow-ui', JSON.stringify(mockState));

      const { result } = renderHook(() => useUIStore());

      await waitFor(() => {
        expect(result.current.theme).toBe('dark');
        expect(result.current.sidebarOpen).toBe(false);
      });
    });
  });
});
