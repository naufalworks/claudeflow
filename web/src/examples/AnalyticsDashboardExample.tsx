"use client";

import { useState } from "react";
import ActivityStream from "@/components/dashboard/ActivityStream";
import MetricsBar from "@/components/dashboard/MetricsBar";
import PredictiveStatus, { Prediction } from "@/components/dashboard/PredictiveStatus";
import TokenUsageChart, { TokenUsageDataPoint } from "@/components/charts/TokenUsageChart";
import LatencyChart, { LatencyDataPoint } from "@/components/charts/LatencyChart";
import CostSavingsChart, { CostSavingsDataPoint } from "@/components/charts/CostSavingsChart";
import Card from "@/components/ui/Card";

/**
 * Analytics Dashboard Example
 *
 * Demonstrates the usage of Phase 2.2 components:
 * - ActivityStream: Real-time event feed
 * - MetricsBar: Key metrics display
 * - PredictiveStatus: Warning alerts
 * - TokenUsageChart: Token usage over time
 * - LatencyChart: Latency percentiles
 * - CostSavingsChart: Cost savings by account
 */

// Sample data generators
function generateTokenUsageData(): TokenUsageDataPoint[] {
  const data: TokenUsageDataPoint[] = [];
  const now = Date.now();

  for (let i = 23; i >= 0; i--) {
    data.push({
      timestamp: new Date(now - i * 3600000).toISOString(),
      inputTokens: Math.floor(Math.random() * 50000) + 10000,
      outputTokens: Math.floor(Math.random() * 30000) + 5000,
      cacheTokens: Math.floor(Math.random() * 20000) + 2000,
    });
  }

  return data;
}

function generateLatencyData(): LatencyDataPoint[] {
  const data: LatencyDataPoint[] = [];
  const now = Date.now();

  for (let i = 23; i >= 0; i--) {
    const baseLatency = 500 + Math.random() * 300;
    data.push({
      timestamp: new Date(now - i * 3600000).toISOString(),
      p50: baseLatency,
      p95: baseLatency * 1.5 + Math.random() * 200,
      p99: baseLatency * 2 + Math.random() * 400,
    });
  }

  return data;
}

function generateCostSavingsData(): CostSavingsDataPoint[] {
  return [
    { accountId: "acc-001", costSaved: 45.32, cacheHitRate: 78.5, totalRequests: 1250 },
    { accountId: "acc-002", costSaved: 32.18, cacheHitRate: 65.2, totalRequests: 980 },
    { accountId: "acc-003", costSaved: 28.94, cacheHitRate: 71.8, totalRequests: 850 },
    { accountId: "acc-004", costSaved: 19.76, cacheHitRate: 58.3, totalRequests: 620 },
    { accountId: "acc-005", costSaved: 15.42, cacheHitRate: 52.1, totalRequests: 450 },
  ];
}

export default function AnalyticsDashboardExample() {
  const [predictions, setPredictions] = useState<Prediction[]>([
    {
      id: "pred-1",
      type: "quota_exhaustion",
      severity: "high",
      title: "Quota Exhaustion Warning",
      message: "Account acc-001 will exhaust quota in approximately 2 hours at current usage rate.",
      actionLabel: "View Account",
      onAction: () => console.log("Navigate to account details"),
      timestamp: new Date().toISOString(),
    },
    {
      id: "pred-2",
      type: "performance_degradation",
      severity: "medium",
      title: "Performance Degradation Detected",
      message: "Average latency has increased by 35% in the last hour.",
      actionLabel: "View Metrics",
      onAction: () => console.log("Navigate to metrics"),
      timestamp: new Date().toISOString(),
    },
  ]);

  const handleDismissPrediction = (id: string) => {
    setPredictions((prev) => prev.filter((p) => p.id !== id));
    console.log("Dismissed prediction:", id);
  };

  const tokenUsageData = generateTokenUsageData();
  const latencyData = generateLatencyData();
  const costSavingsData = generateCostSavingsData();

  return (
    <div className="min-h-screen bg-bg p-6">
      <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text-main mb-2">
            Analytics Dashboard
          </h1>
          <p className="text-text-muted">
            Real-time monitoring and analytics for ClaudeFlow
          </p>
        </div>

        {/* Predictive Status Alerts */}
        <PredictiveStatus
          predictions={predictions}
          onDismiss={handleDismissPrediction}
          autoDismissDelay={10000}
        />

        {/* Metrics Bar */}
        <MetricsBar
          metrics={{
            activeRequests: 12,
            avgLatency: 650,
            successRate: 98.5,
            nextQuotaReset: new Date(Date.now() + 7200000).toISOString(),
          }}
          wsUrl="ws://localhost:8080"
        />

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Token Usage" icon="token" padding="md">
            <TokenUsageChart data={tokenUsageData} />
          </Card>

          <Card title="Latency Percentiles" icon="speed" padding="md">
            <LatencyChart data={latencyData} />
          </Card>
        </div>

        {/* Cost Savings */}
        <Card title="Cost Savings by Account" icon="savings" padding="md">
          <CostSavingsChart data={costSavingsData} />
        </Card>

        {/* Activity Stream */}
        <ActivityStream
          maxHeight={600}
          autoScroll={true}
          wsUrl="ws://localhost:8080"
        />
      </div>
    </div>
  );
}
