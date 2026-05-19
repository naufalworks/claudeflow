"use client";

import { createContext, useContext, ReactNode } from "react";
import { useToast } from "@/hooks/useToast";
import { ToastContainer } from "@/components/ui/Toast";
import { ToastType } from "@/components/ui/Toast";

interface ToastContextType {
  success: (title: string, message?: string, options?: { duration?: number; action?: { label: string; onClick: () => void } }) => string;
  error: (title: string, message?: string, options?: { duration?: number; action?: { label: string; onClick: () => void } }) => string;
  warning: (title: string, message?: string, options?: { duration?: number; action?: { label: string; onClick: () => void } }) => string;
  info: (title: string, message?: string, options?: { duration?: number; action?: { label: string; onClick: () => void } }) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, success, error, warning, info, dismiss } = useToast();

  return (
    <ToastContext.Provider value={{ success, error, warning, info, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} position="top-right" />
    </ToastContext.Provider>
  );
}

export function useToastContext() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToastContext must be used within ToastProvider");
  }
  return context;
}
