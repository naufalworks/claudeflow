"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import QuotaGauge from "./QuotaGauge";
import { Account } from "@/store/accounts-store";
import { cn } from "@/lib/utils";

export interface AccountDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | null;
  className?: string;
}

type TabType = "overview" | "quota" | "performance" | "history";

function getStatusVariant(status: Account["status"]) {
  switch (status) {
    case "active":
      return "success";
    case "quota_exceeded":
      return "warning";
    case "expired":
      return "error";
    case "expiring":
      return "warning";
    default:
      return "default";
  }
}

function formatDate(dateString?: string): string {
  if (!dateString) return "N/A";
  return new Date(dateString).toLocaleString();
}

function formatNumber(num?: number): string {
  if (num === undefined) return "0";
  return num.toLocaleString();
}

function calculateQuotaPercentage(quota?: Account["quota"]): number {
  if (!quota || !quota.requestsPerMinute) return 0;
  return (quota.requestsPerMinuteUsed / quota.requestsPerMinute) * 100;
}

function OverviewTab({ account }: { account: Account }) {
  const quotaPercentage = calculateQuotaPercentage(account.quota);

  return (
    <div className="space-y-6">
      {/* Status Section */}
      <div>
        <h3 className="text-sm font-semibold text-text-main mb-3">Status</h3>
        <Card.Section>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Current Status</span>
            <Badge variant={getStatusVariant(account.status)} size="md" dot>
              {account.status}
            </Badge>
          </div>
        </Card.Section>
      </div>

      {/* Account Information */}
      <div>
        <h3 className="text-sm font-semibold text-text-main mb-3">Account Information</h3>
        <Card.Section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Account ID</span>
            <span className="text-sm font-mono text-text-main">{account.id}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Provider</span>
            <span className="text-sm text-text-main">{account.provider}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Request Count</span>
            <span className="text-sm text-text-main">{formatNumber(account.requestCount)}</span>
          </div>
        </Card.Section>
      </div>

      {/* Quick Stats */}
      <div>
        <h3 className="text-sm font-semibold text-text-main mb-3">Usage Summary</h3>
        <div className="grid grid-cols-2 gap-3">
          <Card.Section>
            <div className="flex flex-col">
              <span className="text-xs text-text-muted mb-1">Total Requests</span>
              <span className="text-xl font-bold text-text-main">
                {formatNumber(account.requestCount)}
              </span>
            </div>
          </Card.Section>
          <Card.Section>
            <div className="flex flex-col">
              <span className="text-xs text-text-muted mb-1">Tokens Used Today</span>
              <span className="text-xl font-bold text-text-main">
                {formatNumber(account.quota?.tokensPerDayUsed || 0)}
              </span>
            </div>
          </Card.Section>
          <Card.Section className="col-span-2">
            <div className="flex flex-col">
              <span className="text-xs text-text-muted mb-1">Cost Efficiency</span>
              <span className="text-xl font-bold text-text-main">
                {account.costEfficiency.toFixed(2)}x
              </span>
            </div>
          </Card.Section>
        </div>
      </div>

      {/* Quota Overview */}
      <div>
        <h3 className="text-sm font-semibold text-text-main mb-3">Quota Overview</h3>
        <Card.Section className="flex flex-col items-center py-6">
          <QuotaGauge percentage={quotaPercentage} size="lg" />
          <div className="mt-4 text-center">
            <p className="text-sm text-text-muted">
              {formatNumber(account.quota?.requestsPerMinuteUsed)} / {formatNumber(account.quota?.requestsPerMinute)} requests/min
            </p>
            <p className="text-xs text-text-muted mt-1">
              {formatNumber(account.quota?.tokensPerDayUsed)} / {formatNumber(account.quota?.tokensPerDay)} tokens/day
            </p>
          </div>
        </Card.Section>
      </div>
    </div>
  );
}

function QuotaTab({ account }: { account: Account }) {
  const quotaPercentage = calculateQuotaPercentage(account.quota);

  return (
    <div className="space-y-6">
      {/* Quota Gauge */}
      <Card.Section className="flex flex-col items-center py-8">
        <QuotaGauge percentage={quotaPercentage} size="lg" label="Current Usage" />
      </Card.Section>

      {/* Quota Details */}
      <div>
        <h3 className="text-sm font-semibold text-text-main mb-3">Quota Breakdown</h3>
        <Card.Section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Requests Per Minute Limit</span>
            <span className="text-sm font-semibold text-text-main">
              {formatNumber(account.quota?.requestsPerMinute)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Requests Used</span>
            <span className="text-sm font-semibold text-text-main">
              {formatNumber(account.quota?.requestsPerMinuteUsed)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Tokens Per Day Limit</span>
            <span className="text-sm font-semibold text-text-main">
              {formatNumber(account.quota?.tokensPerDay)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Tokens Used Today</span>
            <span className="text-sm font-semibold text-green-600 dark:text-green-400">
              {formatNumber(account.quota?.tokensPerDayUsed)}
            </span>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
            <span className="text-sm text-text-muted">Usage Percentage</span>
            <span className="text-sm font-semibold text-text-main">
              {quotaPercentage.toFixed(1)}%
            </span>
          </div>
        </Card.Section>
      </div>

      {/* Rate Limits (Placeholder) */}
      <div>
        <h3 className="text-sm font-semibold text-text-main mb-3">Rate Limits</h3>
        <Card.Section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Requests per Minute (RPM)</span>
            <span className="text-sm font-semibold text-text-main">50</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Tokens per Day (TPD)</span>
            <span className="text-sm font-semibold text-text-main">1,000,000</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Reset Time</span>
            <span className="text-sm font-semibold text-text-main">Daily at 00:00 UTC</span>
          </div>
        </Card.Section>
      </div>
    </div>
  );
}

function PerformanceTab() {
  return (
    <div className="space-y-6">
      {/* Performance Metrics */}
      <div>
        <h3 className="text-sm font-semibold text-text-main mb-3">Current Metrics</h3>
        <div className="grid grid-cols-2 gap-3">
          <Card.Section>
            <div className="flex flex-col">
              <span className="text-xs text-text-muted mb-1">Avg Latency</span>
              <span className="text-2xl font-bold text-text-main">--ms</span>
              <span className="text-xs text-green-600 dark:text-green-400 mt-1">
                Performance data coming soon
              </span>
            </div>
          </Card.Section>
          <Card.Section>
            <div className="flex flex-col">
              <span className="text-xs text-text-muted mb-1">Success Rate</span>
              <span className="text-2xl font-bold text-text-main">--%</span>
              <span className="text-xs text-green-600 dark:text-green-400 mt-1">
                Performance data coming soon
              </span>
            </div>
          </Card.Section>
        </div>
      </div>

      {/* Charts Placeholder */}
      <div>
        <h3 className="text-sm font-semibold text-text-main mb-3">Performance Over Time</h3>
        <Card.Section className="h-64 flex items-center justify-center">
          <div className="text-center">
            <span className="material-symbols-outlined text-[48px] text-text-muted mb-2">
              show_chart
            </span>
            <p className="text-sm text-text-muted">
              Performance charts will be available in a future update
            </p>
          </div>
        </Card.Section>
      </div>
    </div>
  );
}

function HistoryTab() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-text-main mb-3">Recent Activity</h3>
        <Card.Section className="h-96 flex items-center justify-center">
          <div className="text-center">
            <span className="material-symbols-outlined text-[48px] text-text-muted mb-2">
              history
            </span>
            <p className="text-sm text-text-muted">
              Request history will be available in a future update
            </p>
          </div>
        </Card.Section>
      </div>
    </div>
  );
}

export default function AccountDetailsModal({
  isOpen,
  onClose,
  account,
  className,
}: AccountDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("overview");

  if (!account) return null;

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "dashboard" },
    { id: "quota", label: "Quota", icon: "data_usage" },
    { id: "performance", label: "Performance", icon: "speed" },
    { id: "history", label: "History", icon: "history" },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${account.provider} - ${account.id.slice(0, 12)}`}
      size="xl"
      className={className}
    >
      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 border-b border-border-subtle">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors",
              "border-b-2 -mb-[1px]",
              activeTab === tab.id
                ? "border-brand-500 text-brand-600 dark:text-brand-400"
                : "border-transparent text-text-muted hover:text-text-main"
            )}
          >
            <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === "overview" && <OverviewTab account={account} />}
        {activeTab === "quota" && <QuotaTab account={account} />}
        {activeTab === "performance" && <PerformanceTab />}
        {activeTab === "history" && <HistoryTab />}
      </div>
    </Modal>
  );
}
