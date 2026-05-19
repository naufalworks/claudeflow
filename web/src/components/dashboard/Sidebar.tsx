"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { useUIStore } from "@/store/ui-store";
import { useAuthStore } from "@/store/auth-store";
import { cn } from "@/lib/utils";

interface NavLink {
  href: string;
  label: string;
  icon: string;
  shortcut?: string;
}

const navLinks: NavLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", shortcut: "D" },
  { href: "/dashboard/accounts", label: "Accounts", icon: "account_circle", shortcut: "A" },
];

const keyboardShortcuts = [
  { keys: ["⌘", "K"], label: "Command palette" },
  { keys: ["?"], label: "Keyboard shortcuts" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const { logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-40 lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{
          width: sidebarOpen ? 240 : 64,
        }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className={cn(
          "fixed left-0 top-0 h-screen bg-surface border-r border-border-subtle z-50",
          "flex flex-col",
          "lg:relative lg:z-auto"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <motion.div
            initial={false}
            animate={{
              opacity: sidebarOpen ? 1 : 0,
              width: sidebarOpen ? "auto" : 0,
            }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center">
                <span className="material-symbols-outlined text-white text-[20px]">
                  account_tree
                </span>
              </div>
              <span className="font-bold text-text-main whitespace-nowrap">ClaudeFlow</span>
            </div>
          </motion.div>

          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-[8px] text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <span className="material-symbols-outlined text-[20px]">
              {sidebarOpen ? "menu_open" : "menu"}
            </span>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 overflow-y-auto custom-scrollbar">
          <ul className="space-y-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href || pathname?.startsWith(link.href + "/");

              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-all duration-150",
                      "text-sm font-medium",
                      isActive
                        ? "bg-brand-500/10 text-brand-500"
                        : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                    )}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className="material-symbols-outlined text-[20px] flex-shrink-0">
                      {link.icon}
                    </span>
                    <motion.span
                      initial={false}
                      animate={{
                        opacity: sidebarOpen ? 1 : 0,
                        width: sidebarOpen ? "auto" : 0,
                      }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      {link.label}
                    </motion.span>
                    {sidebarOpen && link.shortcut && (
                      <span className="ml-auto text-xs text-text-muted/60 font-mono">
                        {link.shortcut}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer - Keyboard shortcuts */}
        <motion.div
          initial={false}
          animate={{
            opacity: sidebarOpen ? 1 : 0,
            height: sidebarOpen ? "auto" : 0,
          }}
          transition={{ duration: 0.15 }}
          className="border-t border-border-subtle p-3 overflow-hidden"
        >
          <div className="space-y-2">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide px-1">
              Shortcuts
            </p>
            {keyboardShortcuts.map((shortcut, index) => (
              <div
                key={index}
                className="flex items-center justify-between text-xs text-text-muted px-1"
              >
                <span>{shortcut.label}</span>
                <div className="flex items-center gap-0.5">
                  {shortcut.keys.map((key, i) => (
                    <kbd
                      key={i}
                      className="px-1.5 py-0.5 bg-surface-2 border border-border rounded text-[10px] font-mono"
                    >
                      {key}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Logout Button */}
        <div className="border-t border-border-subtle p-2">
          <button
            onClick={handleLogout}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-all duration-150 w-full",
              "text-sm font-medium",
              "text-text-muted hover:bg-red-500/10 hover:text-red-500"
            )}
          >
            <span className="material-symbols-outlined text-[20px] flex-shrink-0">
              logout
            </span>
            <motion.span
              initial={false}
              animate={{
                opacity: sidebarOpen ? 1 : 0,
                width: sidebarOpen ? "auto" : 0,
              }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden whitespace-nowrap"
            >
              Logout
            </motion.span>
          </button>
        </div>
      </motion.aside>
    </>
  );
}
