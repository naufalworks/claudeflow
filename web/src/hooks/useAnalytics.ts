/**
 * useAnalytics Hook
 *
 * React hook for fetching analytics data from the ClaudeFlow admin API.
 * Provides metrics, insights, and error handling.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../lib/api-client';

export interface AnalyticsMetrics {
  totalRequests?: number;
  totalTokens?: number;
  totalCost?: number;
  averageLatency?: number;
  errorRate?: number;
  activeAccounts?: number;
  [key: string]: unknown;
}

export interface AnalyticsInsight {
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  description: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface AnalyticsData {
  metrics: AnalyticsMetrics;
  insights: AnalyticsInsight[];
  timestamp: string;
}

export interface UseAnalyticsOptions {
  autoFetch?: boolean;
  refreshInterval?: number;
  apiUrl?: string;
}

export interface UseAnalyticsReturn {
  metrics: AnalyticsMetrics | null;
  insights: AnalyticsInsight[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  lastUpdated: string | null;
}

export function useAnalytics(options: UseAnalyticsOptions = {}): UseAnalyticsReturn {
  const { autoFetch = true, refreshInterval, apiUrl = '/admin/analytics' } = options;

  const [metrics, setMetrics] = useState<AnalyticsMetrics | null>(null);
  const [insights, setInsights] = useState<AnalyticsInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Get API key from auth store (same method as apiClient)
      const getAPIKey = (): string | null => {
        if (typeof window === 'undefined') return null;
        try {
          const authState = localStorage.getItem('claudeflow-auth');
          if (!authState) return null;
          const parsed = JSON.parse(authState);
          return parsed.state?.apiKey || null;
        } catch {
          return null;
        }
      };

      const apiKey = getAPIKey();
      if (!apiKey) {
        throw new Error('Not authenticated');
      }

      // Use fetch directly for /admin/analytics since apiClient doesn't have this method
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:20129'}${apiUrl}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch analytics: ${response.statusText}`);
      }

      const data: AnalyticsData = await response.json();

      setMetrics(data.metrics || null);
      setInsights(data.insights || []);
      setLastUpdated(data.timestamp || new Date().toISOString());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('Failed to fetch analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  // Fetch on mount if autoFetch is enabled
  useEffect(() => {
    if (autoFetch) {
      fetchAnalytics();
    }
  }, [autoFetch, fetchAnalytics]);

  // Set up refresh interval if specified
  useEffect(() => {
    if (refreshInterval && refreshInterval > 0) {
      const intervalId = setInterval(() => {
        fetchAnalytics();
      }, refreshInterval);

      return () => clearInterval(intervalId);
    }
  }, [refreshInterval, fetchAnalytics]);

  return {
    metrics,
    insights,
    loading,
    error,
    refetch: fetchAnalytics,
    lastUpdated,
  };
}
