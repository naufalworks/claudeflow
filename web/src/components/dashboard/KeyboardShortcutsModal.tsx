"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import { getKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useUIStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";

export default function KeyboardShortcutsModal() {
  const keyboardShortcutsModalOpen = useUIStore(
    (state) => (state as any).keyboardShortcutsModalOpen || false
  );
  const [searchQuery, setSearchQuery] = useState("");

  const shortcuts = getKeyboardShortcuts();

  const handleClose = () => {
    useUIStore.setState({ keyboardShortcutsModalOpen: false });
    setSearchQuery("");
  };

  // Filter shortcuts based on search query
  const filteredShortcuts = shortcuts
    .map((category) => ({
      ...category,
      shortcuts: category.shortcuts.filter(
        (shortcut) =>
          shortcut.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          shortcut.keys.some((key) => key.toLowerCase().includes(searchQuery.toLowerCase()))
      ),
    }))
    .filter((category) => category.shortcuts.length > 0);

  return (
    <Modal
      isOpen={keyboardShortcutsModalOpen}
      onClose={handleClose}
      title="Keyboard Shortcuts"
      size="lg"
      showTrafficLights={false}
    >
      <div className="space-y-6">
        {/* Search input */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-muted text-[18px]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search shortcuts..."
            className={cn(
              "w-full pl-10 pr-4 py-2.5 rounded-[10px]",
              "bg-surface-2 border border-border",
              "text-sm text-text-main placeholder:text-text-muted",
              "focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500",
              "transition-all duration-150"
            )}
            autoFocus
          />
        </div>

        {/* Shortcuts list */}
        {filteredShortcuts.length === 0 ? (
          <div className="py-12 text-center">
            <span className="material-symbols-outlined text-text-muted text-[48px] mb-3 block">
              search_off
            </span>
            <p className="text-text-muted">No shortcuts found matching "{searchQuery}"</p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredShortcuts.map((category) => (
              <div key={category.category}>
                <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">
                  {category.category}
                </h3>
                <div className="space-y-2">
                  {category.shortcuts.map((shortcut, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between py-2.5 px-3 rounded-[10px] bg-surface-2/50 hover:bg-surface-2 transition-colors"
                    >
                      <span className="text-sm text-text-main">{shortcut.description}</span>
                      <div className="flex items-center gap-1.5">
                        {shortcut.keys.map((key, keyIndex) => (
                          <kbd
                            key={keyIndex}
                            className={cn(
                              "inline-flex items-center justify-center",
                              "px-2.5 py-1.5 rounded-[6px]",
                              "bg-surface border border-border shadow-sm",
                              "text-xs font-mono text-text-main font-semibold",
                              "min-w-[32px] h-[28px]",
                              // Special styling for modifier keys
                              (key === "⌘" || key === "Ctrl" || key === "Shift" || key === "Alt") && "text-brand-500"
                            )}
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer note */}
        <div className="pt-4 border-t border-border-subtle">
          <p className="text-xs text-text-muted text-center">
            Press{" "}
            <kbd className="inline-flex items-center justify-center px-2 py-1 bg-surface-2 border border-border rounded-[6px] font-mono text-xs">
              ?
            </kbd>{" "}
            anytime to view this help, or{" "}
            <kbd className="inline-flex items-center justify-center px-2 py-1 bg-surface-2 border border-border rounded-[6px] font-mono text-xs">
              Escape
            </kbd>{" "}
            to close
          </p>
        </div>
      </div>
    </Modal>
  );
}
