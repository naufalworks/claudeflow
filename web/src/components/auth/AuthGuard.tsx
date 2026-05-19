"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, checkAuth } = useAuthStore();

  useEffect(() => {
    // Check auth on mount and redirect if not authenticated
    const isValid = checkAuth();
    if (!isValid) {
      router.push('/login');
    }
  }, [checkAuth, router]);

  // Don't render children until auth is verified
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="flex items-center gap-3 text-text-muted">
          <span className="material-symbols-outlined animate-spin text-[24px]">
            progress_activity
          </span>
          <span>Verifying authentication...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
