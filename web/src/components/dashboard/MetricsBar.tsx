"use client";

import { motion } from "framer-motion";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ServerMessage } from "@/lib/websocket-client";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface MetricsData {
  activeRequests: number;
  avgLatency: number;
  successRate: number;
  nextQuotaReset: string;
}

export interface MetricsBarProps {
  metrics?: MetricsData;
  wsUrl?: string;
  className?: string;
}

type MetricStatus = "good" | "warning" | "critical";

interface MetricCardProps {
  icon: string;
  label: string;
  value: string | number;
  status: MetricStatus;
  subtitle?: string;
  "data-testid"?: string;
}

const STATUS_COLORS: Record<MetricStatus, string> = {
  good: "text-green-500 bg-green-500/10",
  warning: "text-yellow-500 bg-yellow-500/10",
  critical: "text-red-500 bg-red-500/10",
};

const STATUS_BORDER: Record<MetricStatus, string> = {
  good: "border-green-500/30",
  warning: "border-yellow-500/30",
  critical: "border-red-500/30",
};

function MetricCard({ icon, label, value, status, subtitle, "data-testid": dataTestId }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "flex items-center gap-3 p-4 rounded-[12px] bg-surface border transition-all",
        STATUS_BORDER[status],
        "hover:shadow-[var(--shadow-soft)]"
      )}
      data-testid={dataTestId}
    >
      <div className={cn("p-2.5 rounded-[10px]", STATUS_COLORS[status])}>
        <span className="material-symbols-outlined text-[24px]">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-muted mb-0.5">{label}</p>
        <motion.p
          key={value}
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.2 }}
          className="text-2xl font-bold text-text-main"
        >
          {value}
        </motion.p>
        {subtitle && (
          <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>
        )}
      </div>
    </motion.div>
  );
}

export default function MetricsBar({
  metrics: initialMetrics,
  wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:3130",
  className,
}: MetricsBarProps) {
  const [metrics, setMetrics] = useState<MetricsData>(
    initialMetrics || {
      activeRequests: 0,
      avgLatency: 0,
      successRate: 100,
      nextQuotaReset: new Date(Date.now() + 3600000).toISOString(),
    }
  );

  // WebSocket connection for real-time updates
  useWebSocket({
    url: wsUrl,
    channels: ["usage", "quota"],
    autoConnect: true,
    onUsageEvent: (message: ServerMessage) => {
      setMetrics((prev) => ({
        ...prev,
        activeRequests: (message.data?.activeRequests as number) ?? prev.activeRequests,
        avgLatency: (message.data?.avgLatency as number) ?? prev.avgLatency,
        successRate: (message.data?.successRate as number) ?? prev.successRate,
      }));
    },
    onQuotaUpdate: (message: ServerMessage) => {
      setMetrics((prev) => ({
        ...prev,
        nextQuotaReset: (message.data?.nextReset as string) ?? prev.nextQuotaReset,
      }));
    },
  });

  // Update metrics from props
  useEffect(() => {
    if (initialMetrics) {
      setMetrics(initialMetrics);
    }
  }, [initialMetrics]);

  // Determine status for each metric
  const getActiveRequestsStatus = (): MetricStatus => {
    if (metrics.activeRequests > 50) return "critical";
    if (metrics.activeRequests > 20) return "warning";
    return "good";
  };

  const getLatencyStatus = (): MetricStatus => {
    if (metrics.avgLatency > 2000) return "critical";
    if (metrics.avgLatency > 1000) return "warning";
    return "good";
  };

  const getSuccessRateStatus = (): MetricStatus => {
    if (metrics.successRate < 90) return "critical";
    if (metrics.successRate < 95) return "warning";
    return "good";
  };

  const getQuotaResetStatus = (): MetricStatus => {
    const resetTime = new Date(metrics.nextQuotaReset).getTime();
    const now = Date.now();
    const hoursUntilReset = (resetTime - now) / (1000 * 60 * 60);

    if (hoursUntilReset < 1) return "critical";
    if (hoursUntilReset < 6) return "warning";
    return "good";
  };

  const formatLatency = (ms: number): string => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatTimeUntilReset = (): string => {
    const resetTime = new Date(metrics.nextQuotaReset).getTime();
    const now = Date.now();
    const diff = resetTime - now;

    if (diff < 0) return "Resetting...";

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon="trending_up"
          label="Active Requests"
          value={metrics.activeRequests}
          status={getActiveRequestsStatus()}
          data-testid="total-requests"
        />
        <MetricCard
          icon="speed"
          label="Avg Latency"
          value={formatLatency(metrics.avgLatency)}
          status={getLatencyStatus()}
        />
        <MetricCard
          icon="check_circle"
          label="Success Rate"
          value={`${metrics.successRate.toFixed(1)}%`}
          status={getSuccessRateStatus()}
        />
        <MetricCard
          icon="schedule"
          label="Next Quota Reset"
          value={formatTimeUntilReset()}
          status={getQuotaResetStatus()}
          subtitle={new Date(metrics.nextQuotaReset).toLocaleTimeString()}
        />
      </div>
    </div>
  );
}
