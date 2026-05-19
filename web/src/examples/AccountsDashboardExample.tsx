"use client";

import { useState } from "react";
import { AccountGrid, AccountDetailsModal } from "@/components/dashboard";
import { useAccounts } from "@/hooks/useAccounts";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";

export default function AccountsDashboardExample() {
  const { accounts, loading, error, refetch, refreshAccount, isConnected } = useAccounts({
    autoFetch: true,
    enableWebSocket: true,
  });

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const selectedAccount = accounts.find((acc) => acc.id === selectedAccountId) || null;

  const handleViewDetails = (id: string) => {
    setSelectedAccountId(id);
  };

  const handleCloseModal = () => {
    setSelectedAccountId(null);
  };

  const handleRefresh = async (id: string) => {
    await refreshAccount(id);
  };

  const handleRefreshAll = async () => {
    await refetch();
  };

  return (
    <div className="min-h-screen bg-bg p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-text-main mb-2">
                Account Dashboard
              </h1>
              <p className="text-text-muted">
                Monitor and manage your Claude API accounts
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                variant={isConnected ? "success" : "error"}
                size="md"
                dot
              >
                {isConnected ? "Connected" : "Disconnected"}
              </Badge>
              <Button
                variant="outline"
                size="md"
                icon="refresh"
                onClick={handleRefreshAll}
                loading={loading}
              >
                Refresh All
              </Button>
              <Button
                variant="primary"
                size="md"
                icon="add"
              >
                Add Account
              </Button>
            </div>
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-surface border border-border-subtle rounded-[14px] p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-[10px] bg-brand-500/10">
                  <span className="material-symbols-outlined text-[24px] text-brand-500">
                    account_circle
                  </span>
                </div>
                <div>
                  <p className="text-sm text-text-muted">Total Accounts</p>
                  <p className="text-2xl font-bold text-text-main">{accounts.length}</p>
                </div>
              </div>
            </div>

            <div className="bg-surface border border-border-subtle rounded-[14px] p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-[10px] bg-green-500/10">
                  <span className="material-symbols-outlined text-[24px] text-green-500">
                    check_circle
                  </span>
                </div>
                <div>
                  <p className="text-sm text-text-muted">Active</p>
                  <p className="text-2xl font-bold text-text-main">
                    {accounts.filter((a) => a.status === "active").length}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-surface border border-border-subtle rounded-[14px] p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-[10px] bg-yellow-500/10">
                  <span className="material-symbols-outlined text-[24px] text-yellow-500">
                    warning
                  </span>
                </div>
                <div>
                  <p className="text-sm text-text-muted">Quota Exceeded</p>
                  <p className="text-2xl font-bold text-text-main">
                    {accounts.filter((a) => a.status === "quota_exceeded").length}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-surface border border-border-subtle rounded-[14px] p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-[10px] bg-red-500/10">
                  <span className="material-symbols-outlined text-[24px] text-red-500">
                    block
                  </span>
                </div>
                <div>
                  <p className="text-sm text-text-muted">Expired</p>
                  <p className="text-2xl font-bold text-text-main">
                    {accounts.filter((a) => a.status === "expired").length}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-[14px]">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-red-500">error</span>
              <div>
                <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                  Error loading accounts
                </p>
                <p className="text-xs text-red-600/80 dark:text-red-400/80">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Account Grid */}
        <AccountGrid
          accounts={accounts}
          loading={loading}
          onRefresh={handleRefresh}
          onViewDetails={handleViewDetails}
          onAddAccount={() => console.log("Add account clicked")}
        />

        {/* Account Details Modal */}
        <AccountDetailsModal
          isOpen={selectedAccountId !== null}
          onClose={handleCloseModal}
          account={selectedAccount}
        />
      </div>
    </div>
  );
}
