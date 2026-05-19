"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";

export interface CostSavingsDataPoint {
  accountId: string;
  costSaved: number;
  cacheHitRate: number;
  totalRequests: number;
}

export interface CostSavingsChartProps {
  data: CostSavingsDataPoint[];
  className?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    payload: CostSavingsDataPoint;
  }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0].payload;

  return (
    <div className="bg-surface border border-border-subtle rounded-[10px] p-3 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-semibold text-text-main mb-2">{label}</p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-text-muted">Cost Saved</span>
          <span className="text-xs font-semibold text-green-500">
            ${data.costSaved.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-text-muted">Cache Hit Rate</span>
          <span className="text-xs font-semibold text-text-main">
            {data.cacheHitRate.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-text-muted">Total Requests</span>
          <span className="text-xs font-semibold text-text-main">
            {data.totalRequests.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

const COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#6366f1",
];

export default function CostSavingsChart({ data, className }: CostSavingsChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-[300px]", className)}>
        <div className="text-center text-text-muted">
          <span className="material-symbols-outlined text-[48px] mb-2 block">
            savings
          </span>
          <p className="text-sm">No cost savings data available</p>
        </div>
      </div>
    );
  }

  // Sort data by cost saved (descending)
  const sortedData = [...data].sort((a, b) => b.costSaved - a.costSaved);

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={sortedData}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis
            dataKey="accountId"
            stroke="var(--text-muted)"
            style={{ fontSize: '12px' }}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis
            stroke="var(--text-muted)"
            style={{ fontSize: '12px' }}
            tickFormatter={(value) => `$${value}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: '12px' }}
            iconType="square"
          />
          <Bar
            dataKey="costSaved"
            name="Cost Saved ($)"
            radius={[8, 8, 0, 0]}
          >
            {sortedData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
