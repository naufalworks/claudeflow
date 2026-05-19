"use client";

import { ReactNode } from "react";
import { Sidebar, CommandPalette, KeyboardShortcutsModal } from "@/components/dashboard";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import AuthGuard from "@/components/auth/AuthGuard";
import ErrorBoundary from "@/components/ErrorBoundary";
import OnboardingTour from "@/components/onboarding/OnboardingTour";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Initialize keyboard shortcuts
  useKeyboardShortcuts();
  const pathname = usePathname();

  return (
    <AuthGuard>
      <ErrorBoundary showDetails={process.env.NODE_ENV === 'development'}>
        <div className="flex h-screen bg-bg">
          {/* Sidebar */}
          <Sidebar />

          {/* Main content with page transitions */}
          <main className="flex-1 overflow-auto custom-scrollbar">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>

          {/* Global components */}
          <CommandPalette />
          <KeyboardShortcutsModal />
          <OnboardingTour />
        </div>
      </ErrorBoundary>
    </AuthGuard>
  );
}
