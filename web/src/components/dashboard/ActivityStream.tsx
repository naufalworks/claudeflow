"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ServerMessage } from "@/lib/websocket-client";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { cn } from "@/lib/utils";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  accountId: string;
  eventType: "request" | "quota_update" | "account_status" | "error";
  status: "success" | "warning" | "error" | "info";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityStreamProps {
  maxHeight?: number;
  autoScroll?: boolean;
  wsUrl?: string;
  className?: string;
}

const EVENT_TYPE_LABELS: Record<ActivityEvent["eventType"], string> = {
  request: "Request",
  quota_update: "Quota Update",
  account_status: "Account Status",
  error: "Error",
};

const STATUS_ICONS: Record<ActivityEvent["status"], string> = {
  success: "check_circle",
  warning: "warning",
  error: "error",
  info: "info",
};

const STATUS_VARIANTS: Record<ActivityEvent["status"], "success" | "warning" | "error" | "info"> = {
  success: "success",
  warning: "warning",
  error: "error",
  info: "info",
};

export default function ActivityStream({
  maxHeight = 600,
  autoScroll = true,
  wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:3130",
  className,
}: ActivityStreamProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<ActivityEvent[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [selectedEventType, setSelectedEventType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { isConnected, isPolling } = useWebSocket({
    url: wsUrl,
    channels: ["usage", "quota", "accounts"],
    autoConnect: true,
    onUsageEvent: (message: ServerMessage) => {
      addEvent({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        accountId: (message.data?.accountId as string) || "unknown",
        eventType: "request",
        status: "success",
        message: `Request completed: ${message.data?.model || "unknown model"}`,
        metadata: message.data,
      });
    },
    onQuotaUpdate: (message: ServerMessage) => {
      addEvent({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        accountId: (message.data?.accountId as string) || "unknown",
        eventType: "quota_update",
        status: "info",
        message: `Quota updated: ${message.data?.remaining || 0} remaining`,
        metadata: message.data,
      });
    },
    onAccountStatus: (message: ServerMessage) => {
      const status = message.data?.status as string;
      addEvent({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        accountId: (message.data?.accountId as string) || "unknown",
        eventType: "account_status",
        status: status === "active" ? "success" : "warning",
        message: `Account status: ${status}`,
        metadata: message.data,
      });
    },
    onError: (error: Error) => {
      addEvent({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        accountId: "system",
        eventType: "error",
        status: "error",
        message: error.message,
      });
    },
  });

  const addEvent = (event: ActivityEvent) => {
    setEvents((prev) => [event, ...prev].slice(0, 1000));
  };

  useEffect(() => {
    let filtered = events;

    if (selectedAccount !== "all") {
      filtered = filtered.filter((e) => e.accountId === selectedAccount);
    }

    if (selectedEventType !== "all") {
      filtered = filtered.filter((e) => e.eventType === selectedEventType);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.message.toLowerCase().includes(query) ||
          e.accountId.toLowerCase().includes(query)
      );
    }

    setFilteredEvents(filtered);
  }, [events, selectedAccount, selectedEventType, searchQuery]);

  useEffect(() => {
    if (autoScroll && !isPaused && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [filteredEvents, autoScroll, isPaused]);

  const accountIds = useMemo(() => {
    const ids = new Set(events.map((e) => e.accountId));
    return Array.from(ids).sort();
  }, [events]);

  return (
    <Card className={className} padding="none">
      <div className="p-4 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-text-main">Activity Stream</h3>
            <Badge
              variant={isConnected ? "success" : isPolling ? "warning" : "error"}
              size="sm"
              dot
            >
              {isConnected ? "Live" : isPolling ? "Polling" : "Disconnected"}
            </Badge>
          </div>
          <span className="text-sm text-text-muted">
            {filteredEvents.length} events
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input
            type="text"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="px-3 py-2 bg-surface border border-border-subtle rounded-lg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="all">All Accounts</option>
            {accountIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <select
            value={selectedEventType}
            onChange={(e) => setSelectedEventType(e.target.value)}
            className="px-3 py-2 bg-surface border border-border-subtle rounded-lg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="all">All Types</option>
            <option value="request">Requests</option>
            <option value="quota_update">Quota Updates</option>
            <option value="account_status">Account Status</option>
            <option value="error">Errors</option>
          </select>
        </div>
      </div>

      <div
        ref={containerRef}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        className="relative overflow-y-auto"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <span className="material-symbols-outlined text-[48px] mb-2">
              inbox
            </span>
            <p className="text-sm">No events to display</p>
          </div>
        ) : (
          <div>
            {filteredEvents.map((event, index) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: index < 10 ? index * 0.05 : 0 }}
                className="px-4"
              >
                <div className="flex items-start gap-3 py-3 border-b border-border-subtle hover:bg-surface-2/50 transition-colors">
                  <div className="flex-shrink-0 mt-1">
                    <span
                      className={cn(
                        "material-symbols-outlined text-[20px]",
                        event.status === "success" && "text-green-500",
                        event.status === "warning" && "text-yellow-500",
                        event.status === "error" && "text-red-500",
                        event.status === "info" && "text-blue-500"
                      )}
                    >
                      {STATUS_ICONS[event.status]}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={STATUS_VARIANTS[event.status]} size="sm">
                        {EVENT_TYPE_LABELS[event.eventType]}
                      </Badge>
                      <span className="text-xs text-text-muted">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-text-main mb-1">{event.message}</p>
                    <p className="text-xs text-text-muted">Account: {event.accountId}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
