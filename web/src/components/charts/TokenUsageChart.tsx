"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";

export interface TokenUsageDataPoint {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

export interface TokenUsageChartProps {
  data: TokenUsageDataPoint[];
  className?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const total = payload.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <div className="bg-surface border border-border-subtle rounded-[10px] p-3 shadow-[var(--shadow-soft)]">
      <p className="text-xs text-text-muted mb-2">
        {new Date(label || "").toLocaleTimeString()}
      </p>
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-xs text-text-main">{entry.name}</span>
            </div>
            <span className="text-xs font-semibold text-text-main">
              {entry.value.toLocaleString()}
            </span>
          </div>
        ))}
        <div className="pt-1 mt-1 border-t border-border-subtle">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-text-muted">Total</span>
            <span className="text-xs font-bold text-text-main">
              {total.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TokenUsageChart({ data, className }: TokenUsageChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-[300px]", className)}>
        <div className="text-center text-text-muted">
          <span className="material-symbols-outlined text-[48px] mb-2 block">
            bar_chart
          </span>
          <p className="text-sm">No token usage data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart
          data={data}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="inputTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="outputTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="cacheTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(value) => new Date(value).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
            stroke="var(--text-muted)"
            style={{ fontSize: '12px' }}
          />
          <YAxis
            stroke="var(--text-muted)"
            style={{ fontSize: '12px' }}
            tickFormatter={(value) => {
              if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
              if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
              return value.toString();
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: '12px' }}
            iconType="circle"
          />
          <Area
            type="monotone"
            dataKey="inputTokens"
            name="Input Tokens"
            stroke="#3b82f6"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#inputTokens)"
          />
          <Area
            type="monotone"
            dataKey="outputTokens"
            name="Output Tokens"
            stroke="#8b5cf6"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#outputTokens)"
          />
          <Area
            type="monotone"
            dataKey="cacheTokens"
            name="Cache Tokens"
            stroke="#10b981"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#cacheTokens)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
