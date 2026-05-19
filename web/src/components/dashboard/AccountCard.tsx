"use client";

import Card from "@/components/ui/Card";
import { Account } from "@/store/accounts-store";

export interface AccountCardProps {
  account: Account;
  onRefresh?: (id: string) => void;
  onViewDetails?: (id: string) => void;
  className?: string;
}

function formatDuration(target?: number): string {
  if (!target) return "unknown";
  const diff = Math.max(0, target - Date.now());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function AccountCard({ account, onRefresh, className }: AccountCardProps) {
  const quota = account.provider === "kiro-oauth" ? account.kiroCreditQuota : undefined;
  const remainingPercent = quota ? Math.round((quota.remaining / quota.limit) * 100) : undefined;

  return (
    <Card padding="md" elev className={className}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-text-main">Kiro</div>
          <div className="mt-1 truncate font-mono text-xs text-text-muted">{account.id}</div>
        </div>
        {onRefresh && (
          <button onClick={() => onRefresh(account.id)} className="rounded border border-border-subtle px-3 py-1.5 text-sm text-text-main hover:bg-surface-2">
            Refresh
          </button>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-border-subtle bg-surface-2 p-4">
        {quota ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Credit remaining</span>
              <span className="font-semibold text-text-main">{quota.remaining} / {quota.limit}</span>
            </div>
            <div className="h-2 rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-green-500" style={{ width: `${remainingPercent}%` }} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-green-600">{remainingPercent}% left</span>
              <span className="text-text-muted">reset {formatDuration(quota.resetTime)}</span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-text-muted">
            Quota unknown. No verified Kiro quota source detected yet.
          </div>
        )}
      </div>
    </Card>
  );
}
