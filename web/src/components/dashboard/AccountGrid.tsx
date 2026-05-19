"use client";

import { cn } from "@/lib/utils";
import AccountCard from "./AccountCard";
import AccountCardSkeleton from "./AccountCardSkeleton";
import { Account } from "@/store/accounts-store";
import Button from "@/components/ui/Button";

export interface AccountGridProps {
  accounts: Account[];
  loading?: boolean;
  onRefresh?: (id: string) => void;
  onViewDetails?: (id: string) => void;
  onAddAccount?: () => void;
  className?: string;
}

function EmptyState({ onAddAccount }: { onAddAccount?: () => void }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center mb-4">
        <span className="material-symbols-outlined text-[32px] text-text-muted">
          account_circle
        </span>
      </div>
      <h3 className="text-lg font-semibold text-text-main mb-2">
        No accounts configured
      </h3>
      <p className="text-sm text-text-muted mb-6 text-center max-w-sm">
        Add your first Claude account to start routing requests and monitoring usage.
      </p>
      {onAddAccount && (
        <Button
          variant="primary"
          size="md"
          icon="add"
          onClick={onAddAccount}
          className="min-w-[140px] text-white border border-brand-600"
        >
          Add Account
        </Button>
      )}
    </div>
  );
}

export default function AccountGrid({
  accounts,
  loading = false,
  onRefresh,
  onViewDetails,
  onAddAccount,
  className,
}: AccountGridProps) {
  // Show loading skeletons
  if (loading && accounts.length === 0) {
    return (
      <div
        className={cn(
          "grid gap-6",
          "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
          "auto-rows-fr",
          className
        )}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <AccountCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // Show empty state
  if (!loading && accounts.length === 0) {
    return (
      <div className={cn("w-full", className)}>
        <EmptyState onAddAccount={onAddAccount} />
      </div>
    );
  }

  // Show accounts grid
  return (
    <div
      className={cn(
        "grid gap-6",
        "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
        "auto-rows-fr",
        className
      )}
    >
      {accounts.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          onRefresh={onRefresh}
          onViewDetails={onViewDetails}
        />
      ))}
    </div>
  );
}
