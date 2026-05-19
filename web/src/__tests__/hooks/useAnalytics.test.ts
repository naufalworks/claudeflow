import { renderHook, waitFor, act } from '@testing-library/react';
import { useAnalytics } from '@/hooks/useAnalytics';

// Mock fetch
global.fetch = jest.fn();

describe('useAnalytics', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fetches analytics on mount when autoFetch is true', async () => {
    const mockData = {
      metrics: {
        totalRequests: 1000,
        totalTokens: 50000,
        totalCost: 25.5,
      },
      insights: [
        { type: 'info' as const, title: 'Test', description: 'Test insight' },
      ],
      timestamp: '2026-05-11T06:44:08.280Z',
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const { result } = renderHook(() => useAnalytics({ autoFetch: true }));

    await waitFor(() => {
      expect(result.current.metrics).toEqual(mockData.metrics);
      expect(result.current.insights).toEqual(mockData.insights);
      expect(result.current.lastUpdated).toBe(mockData.timestamp);
    });

    expect(global.fetch).toHaveBeenCalledWith('/admin/analytics');
  });

  it('does not fetch analytics on mount when autoFetch is false', () => {
    renderHook(() => useAnalytics({ autoFetch: false }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses custom apiUrl when provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ metrics: {}, insights: [], timestamp: '2026-05-11T06:44:08.280Z' }),
    });

    renderHook(() => useAnalytics({ apiUrl: '/custom/analytics' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/custom/analytics');
    });
  });

  it('returns loading state during fetch', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    const { result } = renderHook(() => useAnalytics());

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });
  });

  it('handles fetch error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
    });

    const { result } = renderHook(() => useAnalytics());

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to fetch analytics: Internal Server Error');
      expect(result.current.loading).toBe(false);
    });
  });

  it('handles network error', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAnalytics());

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
      expect(result.current.loading).toBe(false);
    });

    expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch analytics:', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('refetch calls fetchAnalytics', async () => {
    const mockData = {
      metrics: { totalRequests: 500 },
      insights: [],
      timestamp: '2026-05-11T06:44:08.280Z',
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const { result } = renderHook(() => useAnalytics({ autoFetch: false }));

    await act(async () => {
      await result.current.refetch();
    });

    expect(global.fetch).toHaveBeenCalledWith('/admin/analytics');
    expect(result.current.metrics).toEqual(mockData.metrics);
  });

  it('sets up refresh interval when specified', async () => {
    jest.useFakeTimers();

    const mockData = {
      metrics: { totalRequests: 100 },
      insights: [],
      timestamp: '2026-05-11T06:44:08.280Z',
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    renderHook(() => useAnalytics({ refreshInterval: 5000 }));

    // Initial fetch
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Advance time by 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    // Advance time by another 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  it('clears interval on unmount', async () => {
    jest.useFakeTimers();

    const mockData = {
      metrics: {},
      insights: [],
      timestamp: '2026-05-11T06:44:08.280Z',
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const { unmount } = renderHook(() => useAnalytics({ refreshInterval: 5000 }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    unmount();

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    // Should not fetch after unmount
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('handles missing metrics and insights gracefully', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ timestamp: '2026-05-11T06:44:08.280Z' }),
    });

    const { result } = renderHook(() => useAnalytics());

    await waitFor(() => {
      expect(result.current.metrics).toBeNull();
      expect(result.current.insights).toEqual([]);
    });
  });

  it('sets lastUpdated to current time if timestamp is missing', async () => {
    const beforeFetch = new Date().toISOString();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ metrics: {}, insights: [] }),
    });

    const { result } = renderHook(() => useAnalytics());

    await waitFor(() => {
      expect(result.current.lastUpdated).toBeTruthy();
      if (result.current.lastUpdated) {
        expect(new Date(result.current.lastUpdated).getTime()).toBeGreaterThanOrEqual(
          new Date(beforeFetch).getTime()
        );
      }
    });
  });
});
