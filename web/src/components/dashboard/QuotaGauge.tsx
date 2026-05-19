"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const sizes = {
  sm: { size: 60, strokeWidth: 6, fontSize: "text-xs" },
  md: { size: 80, strokeWidth: 8, fontSize: "text-sm" },
  lg: { size: 100, strokeWidth: 10, fontSize: "text-base" },
} as const;

export interface QuotaGaugeProps {
  percentage: number;
  label?: string;
  size?: keyof typeof sizes;
  className?: string;
  "data-testid"?: string;
}

export default function QuotaGauge({
  percentage,
  label,
  size = "md",
  className,
  "data-testid": dataTestId,
}: QuotaGaugeProps) {
  const config = sizes[size];
  const radius = (config.size - config.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  // Color based on percentage
  const getColor = () => {
    if (percentage >= 90) return "text-red-500";
    if (percentage >= 80) return "text-yellow-500";
    return "text-green-500";
  };

  const getStrokeColor = () => {
    if (percentage >= 90) return "#ef4444";
    if (percentage >= 80) return "#eab308";
    return "#22c55e";
  };

  return (
    <div className={cn("flex flex-col items-center gap-2", className)} data-testid={dataTestId}>
      <div className="relative" style={{ width: config.size, height: config.size }}>
        <svg
          width={config.size}
          height={config.size}
          className="transform -rotate-90"
        >
          {/* Background circle */}
          <circle
            cx={config.size / 2}
            cy={config.size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={config.strokeWidth}
            className="text-surface-3"
          />
          {/* Progress circle */}
          <motion.circle
            cx={config.size / 2}
            cy={config.size / 2}
            r={radius}
            fill="none"
            stroke={getStrokeColor()}
            strokeWidth={config.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </svg>
        {/* Percentage text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn("font-bold", getColor(), config.fontSize)}>
            {Math.round(percentage)}%
          </span>
        </div>
      </div>
      {label && (
        <span className="text-xs text-text-muted font-medium">{label}</span>
      )}
    </div>
  );
}
