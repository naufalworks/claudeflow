'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAccounts } from '@/hooks/useAccounts';
import { Account } from '@/store/accounts-store';
import AccountDetailsModal from '@/components/dashboard/AccountDetailsModal';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { NoAccountsEmptyState, NoSearchResultsEmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';

type SortField = 'id' | 'provider' | 'status' | 'quota' | 'requestCount';
type SortDirection = 'asc' | 'desc';

type KiroLoginState = {
  sessionId: string;
  verificationUri: string;
  verificationUriComplete: string;
  userCode: string;
  expiresIn: number;
  interval: number;
};

export default function AccountsPage() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('requestCount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [kiroLogin, setKiroLogin] = useState<KiroLoginState | null>(null);
  const [addStatus, setAddStatus] = useState<
    'idle' | 'starting' | 'pending' | 'complete' | 'error'
  >('idle');
  const [addError, setAddError] = useState<string | null>(null);
  const [refreshingAccountIds, setRefreshingAccountIds] = useState<Set<string>>(new Set());

  const { accounts, loading, error, refetch, refreshAccount } = useAccounts({
    autoFetch: true,
    enableWebSocket: true,
  });

  // Filter and sort accounts
  const filteredAndSortedAccounts = useMemo(() => {
    let filtered = accounts;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (acc) =>
          acc.id.toLowerCase().includes(query) ||
          acc.provider.toLowerCase().includes(query) ||
          acc.status.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case 'id':
          aVal = a.id;
          bVal = b.id;
          break;
        case 'provider':
          aVal = a.provider;
          bVal = b.provider;
          break;
        case 'status':
          aVal = a.status;
          bVal = b.status;
          break;
        case 'quota':
          aVal = a.quota?.requestsPerMinuteUsed || 0;
          bVal = b.quota?.requestsPerMinuteUsed || 0;
          break;
        case 'requestCount':
          aVal = a.requestCount || 0;
          bVal = b.requestCount || 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [accounts, searchQuery, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleViewDetails = (id: string) => {
    setSelectedAccountId(id);
    setIsModalOpen(true);
  };

  const handleRefreshAccount = async (id: string) => {
    setRefreshingAccountIds((current) => new Set(current).add(id));
    try {
      await refreshAccount(id);
    } finally {
      setRefreshingAccountIds((current) => {
        const updated = new Set(current);
        updated.delete(id);
        return updated;
      });
    }
  };

  const openAddAccountModal = async () => {
    setIsAddModalOpen(true);
    setAddStatus('starting');
    setAddError(null);
    setKiroLogin(null);

    try {
      const login = await apiClient.startKiroLogin();
      setKiroLogin(login);
      setAddStatus('pending');
    } catch (error) {
      setAddStatus('error');
      setAddError(error instanceof Error ? error.message : 'Failed to start AWS Builder ID login');
    }
  };

  const closeAddAccountModal = () => {
    setIsAddModalOpen(false);
    setKiroLogin(null);
    setAddStatus('idle');
    setAddError(null);
  };

  useEffect(() => {
    if (!kiroLogin || addStatus !== 'pending') return;

    const pollMs = Math.max((kiroLogin.interval || 5) * 1000, 5000);
    const timer = window.setInterval(async () => {
      try {
        const result = await apiClient.pollKiroLogin(kiroLogin.sessionId);
        if (result.status === 'complete') {
          window.clearInterval(timer);
          setAddStatus('complete');
          await refetch();
          window.setTimeout(closeAddAccountModal, 1200);
        }
      } catch (error) {
        window.clearInterval(timer);
        setAddStatus('error');
        setAddError(error instanceof Error ? error.message : 'AWS authorization failed');
      }
    }, pollMs);

    return () => window.clearInterval(timer);
  }, [kiroLogin, addStatus, refetch]);

  const handleToggleSelect = (id: string) => {
    const newSelected = new Set(selectedAccounts);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedAccounts(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedAccounts.size === filteredAndSortedAccounts.length) {
      setSelectedAccounts(new Set());
    } else {
      setSelectedAccounts(new Set(filteredAndSortedAccounts.map((acc) => acc.id)));
    }
  };

  const handleBulkTest = async () => {
    console.log('Testing accounts:', Array.from(selectedAccounts));
    // TODO: Implement bulk test
  };

  const handleBulkRemove = async () => {
    if (confirm(`Remove ${selectedAccounts.size} accounts?`)) {
      console.log('Removing accounts:', Array.from(selectedAccounts));
      // TODO: Implement bulk remove
    }
  };

  const getStatusVariant = (status: Account['status']) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'quota_exceeded':
        return 'warning';
      case 'expired':
        return 'error';
      case 'expiring':
        return 'warning';
      default:
        return 'default';
    }
  };

  const selectedAccount = accounts.find((acc) => acc.id === selectedAccountId) || null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border-subtle bg-surface">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-text-main mb-1">Accounts</h1>
              <p className="text-sm text-text-muted">Manage your Claude API accounts</p>
            </div>
            <Button
              variant="primary"
              size="md"
              icon="add"
              onClick={openAddAccountModal}
              className="min-w-[140px] text-white border border-brand-600"
            >
              Add Account
            </Button>
          </div>

          {/* Search and Filters */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Input
                type="text"
                placeholder="Search accounts by ID, email, or status..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {selectedAccounts.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-muted">{selectedAccounts.size} selected</span>
                <Button variant="secondary" size="sm" onClick={handleBulkTest}>
                  Test All
                </Button>
                <Button variant="danger" size="sm" onClick={handleBulkRemove}>
                  Remove All
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {error ? (
          <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-red-600">{error}</p>
            <Button variant="primary" size="sm" onClick={refetch} className="mt-4">
              Retry
            </Button>
          </div>
        ) : loading && accounts.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-text-muted">Loading accounts...</p>
            </div>
          </div>
        ) : accounts.length === 0 ? (
          <NoAccountsEmptyState onAddAccount={openAddAccountModal} />
        ) : filteredAndSortedAccounts.length === 0 ? (
          <NoSearchResultsEmptyState query={searchQuery} onClear={() => setSearchQuery('')} />
        ) : (
          <div className="bg-surface border border-border-subtle rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-2 border-b border-border-subtle">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedAccounts.size === filteredAndSortedAccounts.length}
                        onChange={handleSelectAll}
                        className="rounded border-border-subtle"
                      />
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-main"
                      onClick={() => handleSort('id')}
                    >
                      <div className="flex items-center gap-1">
                        ID
                        {sortField === 'id' && (
                          <span className="material-symbols-outlined text-[16px]">
                            {sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-main"
                      onClick={() => handleSort('provider')}
                    >
                      <div className="flex items-center gap-1">
                        Provider
                        {sortField === 'provider' && (
                          <span className="material-symbols-outlined text-[16px]">
                            {sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-main"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center gap-1">
                        Status
                        {sortField === 'status' && (
                          <span className="material-symbols-outlined text-[16px]">
                            {sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-main"
                      onClick={() => handleSort('quota')}
                    >
                      <div className="flex items-center gap-1">
                        Quota Usage
                        {sortField === 'quota' && (
                          <span className="material-symbols-outlined text-[16px]">
                            {sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-main"
                      onClick={() => handleSort('requestCount')}
                    >
                      <div className="flex items-center gap-1">
                        Requests
                        {sortField === 'requestCount' && (
                          <span className="material-symbols-outlined text-[16px]">
                            {sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                        )}
                      </div>
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {filteredAndSortedAccounts.map((account) => {
                    const isRefreshing = refreshingAccountIds.has(account.id);
                    return (
                      <tr key={account.id} className="hover:bg-surface-2/50 transition-colors">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedAccounts.has(account.id)}
                            onChange={() => handleToggleSelect(account.id)}
                            className="rounded border-border-subtle"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-mono text-text-main">
                            {account.id.slice(0, 8)}...
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-main">{account.provider}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={getStatusVariant(account.status)} size="sm" dot>
                            {account.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-surface-3 rounded-full h-2 max-w-[100px]">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all',
                                  account.quota && account.quota.requestsPerMinute
                                    ? (account.quota.requestsPerMinuteUsed /
                                        account.quota.requestsPerMinute) *
                                        100 >
                                      80
                                      ? 'bg-red-500'
                                      : (account.quota.requestsPerMinuteUsed /
                                            account.quota.requestsPerMinute) *
                                            100 >
                                          60
                                        ? 'bg-yellow-500'
                                        : 'bg-green-500'
                                    : 'bg-gray-500'
                                )}
                                style={{
                                  width:
                                    account.quota && account.quota.requestsPerMinute
                                      ? `${Math.min((account.quota.requestsPerMinuteUsed / account.quota.requestsPerMinute) * 100, 100)}%`
                                      : '0%',
                                }}
                              />
                            </div>
                            <span className="text-xs text-text-muted whitespace-nowrap">
                              {account.quota
                                ? `${((account.quota.requestsPerMinuteUsed / account.quota.requestsPerMinute) * 100).toFixed(0)}%`
                                : 'N/A'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-muted">
                            {account.requestCount || 0}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleRefreshAccount(account.id)}
                              disabled={isRefreshing}
                              className="p-1 rounded transition-colors hover:bg-surface-3 disabled:cursor-wait disabled:opacity-70"
                              title={isRefreshing ? 'Refreshing...' : 'Refresh'}
                              aria-label={`Refresh ${account.id}`}
                            >
                              <span
                                className={cn(
                                  'material-symbols-outlined text-[18px] text-text-muted',
                                  isRefreshing && 'animate-spin text-brand-500'
                                )}
                              >
                                refresh
                              </span>
                            </button>
                            <button
                              onClick={() => handleViewDetails(account.id)}
                              className="p-1 hover:bg-surface-3 rounded transition-colors"
                              title="View Details"
                            >
                              <span className="material-symbols-outlined text-[18px] text-text-muted">
                                visibility
                              </span>
                            </button>
                            <button
                              onClick={async () => {
                                if (
                                  !confirm(`Are you sure you want to delete account ${account.id}?`)
                                )
                                  return;

                                try {
                                  await apiClient.deleteAccount(account.id);
                                  // Refresh accounts list
                                  await refetch();
                                } catch (error) {
                                  console.error('Error deleting account:', error);
                                  alert(
                                    `Failed to delete account: ${error instanceof Error ? error.message : 'Unknown error'}`
                                  );
                                }
                              }}
                              className="p-1 hover:bg-red-500/10 rounded transition-colors"
                              title="Remove"
                            >
                              <span className="material-symbols-outlined text-[18px] text-red-500">
                                delete
                              </span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border-subtle bg-surface p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-text-main">Add AWS Builder ID Account</h2>
                <p className="mt-1 text-sm text-text-muted">
                  Authorize with AWS. No email or password is stored here.
                </p>
              </div>
              <button
                onClick={closeAddAccountModal}
                className="rounded p-1 hover:bg-surface-3"
                aria-label="Close"
              >
                <span className="material-symbols-outlined text-text-muted">close</span>
              </button>
            </div>

            {addStatus === 'starting' && (
              <div className="py-8 text-center">
                <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
                <p className="text-sm text-text-muted">Starting AWS device login...</p>
              </div>
            )}

            {kiroLogin && (addStatus === 'pending' || addStatus === 'complete') && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
                  <p className="mb-2 text-sm text-text-muted">Open this AWS login link:</p>
                  <a
                    href={kiroLogin.verificationUriComplete || kiroLogin.verificationUri}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-sm font-medium text-brand-500 hover:underline"
                  >
                    {kiroLogin.verificationUriComplete || kiroLogin.verificationUri}
                  </a>
                </div>
                <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
                  <p className="mb-2 text-sm text-text-muted">Enter code:</p>
                  <div className="font-mono text-3xl font-bold tracking-widest text-text-main">
                    {kiroLogin.userCode}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-text-muted">
                  {addStatus === 'complete' ? (
                    <>
                      <span className="material-symbols-outlined text-green-500">check_circle</span>
                      Account added. Refreshing...
                    </>
                  ) : (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                      Waiting for AWS authorization...
                    </>
                  )}
                </div>
              </div>
            )}

            {addStatus === 'error' && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">
                {addError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              {addStatus === 'error' && (
                <Button variant="secondary" size="sm" onClick={openAddAccountModal}>
                  Try Again
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={closeAddAccountModal}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Account Details Modal */}
      <AccountDetailsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        account={selectedAccount}
      />
    </div>
  );
}
