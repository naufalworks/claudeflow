"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";

export interface LatencyDataPoint {
  timestamp: string;
  p50: number;
  p95: number;
  p99: number;
}

export interface LatencyChartProps {
  data: LatencyDataPoint[];
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
              {entry.value.toFixed(0)}ms
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LatencyChart({ data, className }: LatencyChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-[300px]", className)}>
        <div className="text-center text-text-muted">
          <span className="material-symbols-outlined text-[48px] mb-2 block">
            speed
          </span>
          <p className="text-sm">No latency data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart
          data={data}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
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
            tickFormatter={(value) => `${value}ms`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: '12px' }}
            iconType="line"
          />
          <Line
            type="monotone"
            dataKey="p50"
            name="p50 (Median)"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="p95"
            name="p95"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="p99"
            name="p99"
            stroke="#ef4444"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
