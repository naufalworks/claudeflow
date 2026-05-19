"use client";

import { useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUIStore } from "@/store/ui-store";

interface KeyboardShortcut {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  action: () => void;
  description: string;
  condition?: () => boolean;
}

export function useKeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const { openCommandPalette, closeCommandPalette, commandPaletteOpen } = useUIStore();

  const shortcuts: KeyboardShortcut[] = [
    {
      key: "k",
      metaKey: true,
      action: () => {
        if (commandPaletteOpen) {
          closeCommandPalette();
        } else {
          openCommandPalette();
        }
      },
      description: "Open command palette",
    },
    {
      key: "k",
      ctrlKey: true,
      action: () => {
        if (commandPaletteOpen) {
          closeCommandPalette();
        } else {
          openCommandPalette();
        }
      },
      description: "Open command palette",
    },
    {
      key: "a",
      action: () => {
        if (pathname === "/accounts") {
          router.push("/accounts?action=add");
        }
      },
      description: "Add account (on accounts page)",
      condition: () => pathname === "/accounts",
    },
    {
      key: "t",
      action: () => {
        // Test selected account - would need selection state
        console.log("Test account shortcut");
      },
      description: "Test selected account",
      condition: () => pathname?.startsWith("/accounts") || false,
    },
    {
      key: "d",
      action: () => {
        if (pathname === "/dashboard") {
          router.push("/analytics");
        } else if (pathname === "/analytics") {
          router.push("/dashboard");
        } else {
          router.push("/dashboard");
        }
      },
      description: "Toggle dashboard/analytics",
    },
    {
      key: "?",
      shiftKey: true,
      action: () => {
        useUIStore.setState({ keyboardShortcutsModalOpen: true });
      },
      description: "Show keyboard shortcuts",
    },
    {
      key: "Escape",
      action: () => {
        closeCommandPalette();
        useUIStore.setState({ keyboardShortcutsModalOpen: false });
      },
      description: "Close modals/palette",
    },
  ];

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Allow Cmd+K and Escape even in inputs
        if (
          !(
            (event.key === "k" && (event.metaKey || event.ctrlKey)) ||
            event.key === "Escape"
          )
        ) {
          return;
        }
      }

      for (const shortcut of shortcuts) {
        // Check if condition is met (if provided)
        if (shortcut.condition && !shortcut.condition()) {
          continue;
        }

        // Check if key matches
        if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
          continue;
        }

        // Check modifier keys
        const metaMatch = shortcut.metaKey ? event.metaKey : !event.metaKey;
        const ctrlMatch = shortcut.ctrlKey ? event.ctrlKey : !event.ctrlKey;
        const shiftMatch = shortcut.shiftKey ? event.shiftKey : !event.shiftKey;
        const altMatch = shortcut.altKey ? event.altKey : !event.altKey;

        if (metaMatch && ctrlMatch && shiftMatch && altMatch) {
          event.preventDefault();
          shortcut.action();
          break;
        }
      }
    },
    [shortcuts, pathname, commandPaletteOpen, router, openCommandPalette, closeCommandPalette]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { shortcuts };
}

// Export shortcuts data for the help modal
export function getKeyboardShortcuts() {
  const isMac = typeof window !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  return [
    {
      category: "Navigation",
      shortcuts: [
        {
          keys: isMac ? ["⌘", "K"] : ["Ctrl", "K"],
          description: "Open command palette",
        },
        {
          keys: ["D"],
          description: "Toggle dashboard/analytics",
        },
      ],
    },
    {
      category: "Actions",
      shortcuts: [
        {
          keys: ["A"],
          description: "Add account (on accounts page)",
        },
        {
          keys: ["T"],
          description: "Test selected account",
        },
      ],
    },
    {
      category: "General",
      shortcuts: [
        {
          keys: ["?"],
          description: "Show keyboard shortcuts",
        },
        {
          keys: ["Escape"],
          description: "Close modals/palette",
        },
      ],
    },
  ];
}
