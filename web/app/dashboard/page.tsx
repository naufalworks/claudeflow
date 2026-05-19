"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import AccountGrid from "@/components/dashboard/AccountGrid";
import Badge from "@/components/ui/Badge";
import { useAccounts } from "@/hooks/useAccounts";

// Dynamic imports for heavy components
const AccountDetailsModal = dynamic(
  () => import("@/components/dashboard/AccountDetailsModal"),
  {
    ssr: false,
  }
);

export default function DashboardPage() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Fetch accounts with real-time updates
  const {
    accounts,
    loading: accountsLoading,
    error: accountsError,
    refetch: refetchAccounts,
    refreshAccount,
    isConnected,
    connectionStatus,
  } = useAccounts({
    autoFetch: true,
    enableWebSocket: true,
  });

  const handleViewDetails = (id: string) => {
    setSelectedAccountId(id);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedAccountId(null);
  };

  const handleAddAccount = () => {
    window.location.href = "/dashboard/accounts";
  };

  const selectedAccount = accounts.find((acc) => acc.id === selectedAccountId) || null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border-subtle bg-surface">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-text-main mb-1">Dashboard</h1>
              <p className="text-sm text-text-muted">
                Monitor your Claude accounts and usage in real-time
              </p>
            </div>
            <Badge variant={isConnected ? "success" : "warning"} size="md" dot>
              {isConnected ? "Socket connected" : "Socket connecting"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 gap-6">
          {/* Account Grid - Full width */}
          <div>
            {accountsError ? (
              <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  <span className="material-symbols-outlined text-red-600">error</span>
                  <h3 className="text-lg font-semibold text-red-600">Error Loading Accounts</h3>
                </div>
                <p className="text-sm text-red-600/80">{accountsError}</p>
                <button
                  onClick={() => refetchAccounts()}
                  className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : (
              <AccountGrid
                accounts={accounts}
                loading={accountsLoading}
                onRefresh={refreshAccount}
                onViewDetails={handleViewDetails}
                onAddAccount={handleAddAccount}
              />
            )}
          </div>
        </div>
      </div>

      {/* Account Details Modal */}
      <AccountDetailsModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        account={selectedAccount}
      />
    </div>
  );
}
