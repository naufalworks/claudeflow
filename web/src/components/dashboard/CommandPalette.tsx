"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Command } from "cmdk";
import { motion, AnimatePresence } from "framer-motion";
import { useUIStore } from "@/store/ui-store";
import { useAccountsStore } from "@/store/accounts-store";
import { cn } from "@/lib/utils";

interface CommandItem {
  id: string;
  label: string;
  icon: string;
  group: string;
  action: () => void;
  keywords?: string[];
}

const RECENT_SEARCHES_KEY = "claudeflow-recent-searches";
const MAX_RECENT_SEARCHES = 5;

export default function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { commandPaletteOpen, closeCommandPalette } = useUIStore();
  const { accounts, refreshAccount } = useAccountsStore();

  const [search, setSearch] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // Load recent searches from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (stored) {
      try {
        setRecentSearches(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse recent searches:", e);
      }
    }
  }, []);

  // Save search to recent
  const saveRecentSearch = useCallback((query: string) => {
    if (!query.trim()) return;

    setRecentSearches((prev) => {
      const updated = [query, ...prev.filter((s) => s !== query)].slice(0, MAX_RECENT_SEARCHES);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Clear search on close
  useEffect(() => {
    if (!commandPaletteOpen) {
      setSearch("");
    }
  }, [commandPaletteOpen]);

  // Navigation commands
  const navigationCommands: CommandItem[] = [
    {
      id: "nav-dashboard",
      label: "Go to Dashboard",
      icon: "dashboard",
      group: "Navigation",
      action: () => {
        router.push("/dashboard");
        saveRecentSearch("Go to Dashboard");
        closeCommandPalette();
      },
      keywords: ["home", "overview"],
    },
    {
      id: "nav-accounts",
      label: "Go to Accounts",
      icon: "account_circle",
      group: "Navigation",
      action: () => {
        router.push("/accounts");
        saveRecentSearch("Go to Accounts");
        closeCommandPalette();
      },
      keywords: ["users", "list"],
    },
    {
      id: "nav-analytics",
      label: "Go to Analytics",
      icon: "analytics",
      group: "Navigation",
      action: () => {
        router.push("/analytics");
        saveRecentSearch("Go to Analytics");
        closeCommandPalette();
      },
      keywords: ["stats", "metrics", "charts"],
    },
    {
      id: "nav-activity",
      label: "Go to Activity",
      icon: "history",
      group: "Navigation",
      action: () => {
        router.push("/activity");
        saveRecentSearch("Go to Activity");
        closeCommandPalette();
      },
      keywords: ["logs", "history", "events"],
    },
    {
      id: "nav-settings",
      label: "Go to Settings",
      icon: "settings",
      group: "Navigation",
      action: () => {
        router.push("/settings");
        saveRecentSearch("Go to Settings");
        closeCommandPalette();
      },
      keywords: ["config", "preferences"],
    },
  ];

  // Action commands
  const actionCommands: CommandItem[] = [
    {
      id: "action-refresh",
      label: "Refresh accounts",
      icon: "refresh",
      group: "Actions",
      action: () => {
        useAccountsStore.getState().fetchAccounts();
        saveRecentSearch("Refresh accounts");
        closeCommandPalette();
      },
      keywords: ["reload", "update"],
    },
    {
      id: "action-add-account",
      label: "Add new account",
      icon: "add",
      group: "Actions",
      action: () => {
        router.push("/accounts?action=add");
        saveRecentSearch("Add new account");
        closeCommandPalette();
      },
      keywords: ["create", "new"],
    },
    {
      id: "action-view-analytics",
      label: "View analytics",
      icon: "bar_chart",
      group: "Actions",
      action: () => {
        router.push("/analytics");
        saveRecentSearch("View analytics");
        closeCommandPalette();
      },
      keywords: ["stats", "metrics"],
    },
  ];

  // Account commands (dynamic based on accounts)
  const accountCommands: CommandItem[] = accounts.map((account) => ({
    id: `account-${account.id}`,
    label: `${account.provider} - ${account.id.slice(0, 12)}`,
    icon: "account_circle",
    group: "Accounts",
    action: () => {
      router.push(`/accounts/${account.id}`);
      saveRecentSearch(`${account.provider} - ${account.id.slice(0, 12)}`);
      closeCommandPalette();
    },
    keywords: [account.id, account.status],
  }));

  const allCommands = [...navigationCommands, ...actionCommands, ...accountCommands];

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (commandPaletteOpen) {
          closeCommandPalette();
        } else {
          useUIStore.getState().openCommandPalette();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, closeCommandPalette]);

  if (!commandPaletteOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] px-4">
        {/* Overlay */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          onClick={closeCommandPalette}
        />

        {/* Command palette */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -20 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative w-full max-w-2xl"
        >
          <Command
            className="bg-surface border border-border-subtle rounded-[14px] shadow-[var(--shadow-elev)] overflow-hidden"
            label="Command palette"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
              <span className="material-symbols-outlined text-text-muted text-[20px]">
                search
              </span>
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search commands, accounts, or navigate..."
                className="flex-1 bg-transparent text-text-main placeholder:text-text-muted outline-none text-sm"
                autoFocus
              />
              <kbd className="px-2 py-1 bg-surface-2 border border-border rounded text-xs font-mono text-text-muted">
                ESC
              </kbd>
            </div>

            {/* Command list */}
            <Command.List className="max-h-[400px] overflow-y-auto custom-scrollbar p-2">
              <Command.Empty className="py-8 text-center text-sm text-text-muted">
                No results found.
              </Command.Empty>

              {/* Recent searches */}
              {!search && recentSearches.length > 0 && (
                <Command.Group
                  heading="Recent"
                  className="mb-2"
                >
                  {recentSearches.map((recent, index) => (
                    <Command.Item
                      key={`recent-${index}`}
                      value={recent}
                      onSelect={() => setSearch(recent)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-[10px] cursor-pointer",
                        "text-sm text-text-muted",
                        "aria-selected:bg-surface-2 aria-selected:text-text-main"
                      )}
                    >
                      <span className="material-symbols-outlined text-[18px]">history</span>
                      <span>{recent}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {/* Navigation commands */}
              <Command.Group
                heading="Navigation"
                className="mb-2"
              >
                {navigationCommands.map((cmd) => (
                  <Command.Item
                    key={cmd.id}
                    value={`${cmd.label} ${cmd.keywords?.join(" ") || ""}`}
                    onSelect={cmd.action}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-[10px] cursor-pointer",
                      "text-sm text-text-main",
                      "aria-selected:bg-surface-2"
                    )}
                  >
                    <span className="material-symbols-outlined text-[18px] text-text-muted">
                      {cmd.icon}
                    </span>
                    <span className="flex-1">{cmd.label}</span>
                    <kbd className="px-1.5 py-0.5 bg-surface-2 border border-border rounded text-xs font-mono text-text-muted">
                      ↵
                    </kbd>
                  </Command.Item>
                ))}
              </Command.Group>

              {/* Action commands */}
              <Command.Group
                heading="Actions"
                className="mb-2"
              >
                {actionCommands.map((cmd) => (
                  <Command.Item
                    key={cmd.id}
                    value={`${cmd.label} ${cmd.keywords?.join(" ") || ""}`}
                    onSelect={cmd.action}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-[10px] cursor-pointer",
                      "text-sm text-text-main",
                      "aria-selected:bg-surface-2"
                    )}
                  >
                    <span className="material-symbols-outlined text-[18px] text-text-muted">
                      {cmd.icon}
                    </span>
                    <span className="flex-1">{cmd.label}</span>
                    <kbd className="px-1.5 py-0.5 bg-surface-2 border border-border rounded text-xs font-mono text-text-muted">
                      ↵
                    </kbd>
                  </Command.Item>
                ))}
              </Command.Group>

              {/* Account commands */}
              {accountCommands.length > 0 && (
                <Command.Group heading="Accounts">
                  {accountCommands.map((cmd) => (
                    <Command.Item
                      key={cmd.id}
                      value={`${cmd.label} ${cmd.keywords?.join(" ") || ""}`}
                      onSelect={cmd.action}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-[10px] cursor-pointer",
                        "text-sm text-text-main",
                        "aria-selected:bg-surface-2"
                      )}
                    >
                      <span className="material-symbols-outlined text-[18px] text-text-muted">
                        {cmd.icon}
                      </span>
                      <span className="flex-1">{cmd.label}</span>
                      <kbd className="px-1.5 py-0.5 bg-surface-2 border border-border rounded text-xs font-mono text-text-muted">
                        ↵
                      </kbd>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-border-subtle text-xs text-text-muted">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-surface-2 border border-border rounded font-mono">
                    ↑↓
                  </kbd>
                  Navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-surface-2 border border-border rounded font-mono">
                    ↵
                  </kbd>
                  Select
                </span>
              </div>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-surface-2 border border-border rounded font-mono">
                  ESC
                </kbd>
                Close
              </span>
            </div>
          </Command>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
