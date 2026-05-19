"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import Button from "./Button";

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: string;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    icon?: string;
  };
  illustration?: ReactNode;
  className?: string;
}

export default function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
  secondaryAction,
  illustration,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-6 text-center",
        className
      )}
      role="status"
      aria-live="polite"
    >
      {/* Illustration or Icon */}
      {illustration ? (
        <div className="mb-6">{illustration}</div>
      ) : (
        <div className="mb-6 p-6 rounded-full bg-surface-2 border border-border-subtle">
          <span className="material-symbols-outlined text-[64px] text-text-muted">
            {icon}
          </span>
        </div>
      )}

      {/* Title */}
      <h3 className="text-xl font-semibold text-text-main mb-2">{title}</h3>

      {/* Description */}
      {description && (
        <p className="text-sm text-text-muted max-w-md mb-6">{description}</p>
      )}

      {/* Actions */}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3">
          {action && (
            <Button
              variant="primary"
              size="md"
              icon={action.icon}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant="outline"
              size="md"
              icon={secondaryAction.icon}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Preset empty states for common scenarios
export function NoAccountsEmptyState({ onAddAccount }: { onAddAccount: () => void }) {
  return (
    <EmptyState
      icon="account_circle"
      title="No accounts yet"
      description="Add your first Claude API account to start tracking usage and managing your workflow."
      action={{
        label: "Add Account",
        icon: "add",
        onClick: onAddAccount,
      }}
    />
  );
}

export function NoActivityEmptyState() {
  return (
    <EmptyState
      icon="history"
      title="No activity yet"
      description="Your account activity and usage history will appear here once you start making API requests."
    />
  );
}

export function NoAnalyticsEmptyState() {
  return (
    <EmptyState
      icon="analytics"
      title="No analytics data"
      description="Analytics and insights will be available once you have some usage data to analyze."
    />
  );
}

export function NoSearchResultsEmptyState({ query, onClear }: { query: string; onClear?: () => void }) {
  return (
    <EmptyState
      icon="search_off"
      title="No results found"
      description={`We couldn't find anything matching "${query}". Try adjusting your search terms.`}
      action={
        onClear
          ? {
              label: "Clear Search",
              icon: "close",
              onClick: onClear,
            }
          : undefined
      }
    />
  );
}
