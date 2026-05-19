"use client";

import { useState, useCallback } from "react";
import { Toast, ToastType } from "@/components/ui/Toast";

let toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (
      type: ToastType,
      title: string,
      message?: string,
      options?: {
        duration?: number;
        action?: { label: string; onClick: () => void };
      }
    ) => {
      const id = `toast-${++toastId}`;
      const newToast: Toast = {
        id,
        type,
        title,
        message,
        duration: options?.duration,
        action: options?.action,
      };

      setToasts((prev) => [...prev, newToast]);
      return id;
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback(
    (title: string, message?: string, options?: { duration?: number; action?: { label: string; onClick: () => void } }) => {
      return addToast("success", title, message, options);
    },
    [addToast]
  );

  const error = useCallback(
    (title: string, message?: string, options?: { duration?: number; action?: { label: string; onClick: () => void } }) => {
      return addToast("error", title, message, options);
    },
    [addToast]
  );

  const warning = useCallback(
    (title: string, message?: string, options?: { duration?: number; action?: { label: string; onClick: () => void } }) => {
      return addToast("warning", title, message, options);
    },
    [addToast]
  );

  const info = useCallback(
    (title: string, message?: string, options?: { duration?: number; action?: { label: string; onClick: () => void } }) => {
      return addToast("info", title, message, options);
    },
    [addToast]
  );

  return {
    toasts,
    success,
    error,
    warning,
    info,
    dismiss: dismissToast,
  };
}
