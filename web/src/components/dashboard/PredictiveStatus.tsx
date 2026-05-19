"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export type PredictionType = "quota_exhaustion" | "token_expiry" | "performance_degradation";

export interface Prediction {
  id: string;
  type: PredictionType;
  severity: "low" | "medium" | "high";
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  timestamp: string;
}

export interface PredictiveStatusProps {
  predictions: Prediction[];
  onDismiss?: (id: string) => void;
  autoDismissDelay?: number;
  className?: string;
}

const SEVERITY_COLORS = {
  low: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-600 dark:text-blue-400",
    icon: "text-blue-500",
  },
  medium: {
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
    text: "text-yellow-600 dark:text-yellow-400",
    icon: "text-yellow-500",
  },
  high: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-600 dark:text-red-400",
    icon: "text-red-500",
  },
};

const TYPE_ICONS: Record<PredictionType, string> = {
  quota_exhaustion: "warning",
  token_expiry: "schedule",
  performance_degradation: "speed",
};

interface PredictionAlertProps {
  prediction: Prediction;
  onDismiss: (id: string) => void;
  autoDismissDelay: number;
}

function PredictionAlert({ prediction, onDismiss, autoDismissDelay }: PredictionAlertProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isHovered && autoDismissDelay > 0) {
      const id = setTimeout(() => {
        onDismiss(prediction.id);
      }, autoDismissDelay);
      setTimeoutId(id);

      return () => clearTimeout(id);
    } else if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
  }, [isHovered, autoDismissDelay, prediction.id, onDismiss]);

  const colors = SEVERITY_COLORS[prediction.severity];

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.95 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "flex items-start gap-3 p-4 rounded-[12px] border shadow-[var(--shadow-soft)]",
        colors.bg,
        colors.border,
        "backdrop-blur-sm"
      )}
    >
      <div className={cn("flex-shrink-0 mt-0.5", colors.icon)}>
        <span className="material-symbols-outlined text-[24px]">
          {TYPE_ICONS[prediction.type]}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <h4 className={cn("font-semibold text-sm mb-1", colors.text)}>
          {prediction.title}
        </h4>
        <p className="text-sm text-text-main mb-2">{prediction.message}</p>

        <div className="flex items-center gap-2">
          {prediction.actionLabel && prediction.onAction && (
            <button
              onClick={prediction.onAction}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
                colors.text,
                "hover:bg-black/5 dark:hover:bg-white/5"
              )}
            >
              {prediction.actionLabel}
            </button>
          )}
          <span className="text-xs text-text-muted">
            {new Date(prediction.timestamp).toLocaleTimeString()}
          </span>
        </div>
      </div>

      <button
        onClick={() => onDismiss(prediction.id)}
        className="flex-shrink-0 p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        aria-label="Dismiss"
      >
        <span className="material-symbols-outlined text-[20px] text-text-muted">
          close
        </span>
      </button>
    </motion.div>
  );
}

export default function PredictiveStatus({
  predictions,
  onDismiss,
  autoDismissDelay = 10000,
  className,
}: PredictiveStatusProps) {
  const [visiblePredictions, setVisiblePredictions] = useState<Prediction[]>(predictions);

  useEffect(() => {
    setVisiblePredictions(predictions);
  }, [predictions]);

  const handleDismiss = (id: string) => {
    setVisiblePredictions((prev) => prev.filter((p) => p.id !== id));
    onDismiss?.(id);
  };

  if (visiblePredictions.length === 0) {
    return null;
  }

  return (
    <div className={cn("fixed top-4 right-4 z-50 w-full max-w-md space-y-3", className)}>
      <AnimatePresence mode="popLayout">
        {visiblePredictions.map((prediction) => (
          <PredictionAlert
            key={prediction.id}
            prediction={prediction}
            onDismiss={handleDismiss}
            autoDismissDelay={autoDismissDelay}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
