"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/store/auth-store";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import { apiClient } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, login } = useAuthStore();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      router.push("/dashboard");
    }
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Validate API key format
      if (!apiKey || apiKey.trim().length === 0) {
        setError("API key is required");
        setLoading(false);
        return;
      }

      // Store the API key temporarily to test it
      const trimmedKey = apiKey.trim();

      // Test the API key with a health check
      try {
        // Temporarily set the key for testing
        login(trimmedKey);

        // Test with a simple API call
        await apiClient.healthCheck();

        // If successful, redirect to dashboard
        router.push("/dashboard");
      } catch (apiError: any) {
        // Clear the auth if the test failed
        useAuthStore.getState().logout();

        if (apiError.statusCode === 401 || apiError.statusCode === 403) {
          setError("Invalid API key. Please check and try again.");
        } else if (apiError.statusCode === 408) {
          setError("Connection timeout. Please check your network and try again.");
        } else {
          setError("Failed to connect to ClaudeFlow server. Please ensure the server is running.");
        }
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-[16px] bg-gradient-to-br from-brand-500 to-brand-600 mb-4 shadow-[var(--shadow-warm)]"
          >
            <span className="material-symbols-outlined text-white text-[32px]">
              account_tree
            </span>
          </motion.div>
          <h1 className="text-3xl font-bold text-text-main mb-2">ClaudeFlow</h1>
          <p className="text-text-muted">Sign in to access your dashboard</p>
        </div>

        {/* Login Card */}
        <Card padding="lg" elev>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* API Key Input */}
            <Input
              label="API Key"
              type="password"
              placeholder="Enter your ClaudeFlow API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              error={error}
              icon="key"
              required
              disabled={loading}
              autoFocus
            />

            {/* Info Box */}
            <div className="p-3 rounded-[10px] bg-brand-500/10 border border-brand-500/20">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-brand-500 text-[18px] mt-0.5">
                  info
                </span>
                <div className="text-xs text-text-muted">
                  <p className="mb-1">
                    Your API key is stored locally in your browser and never sent to external servers.
                  </p>
                  <p>
                    Find your API key in the ClaudeFlow server configuration or generate a new one using the CLI.
                  </p>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              icon={loading ? undefined : "login"}
            >
              {loading ? "Authenticating..." : "Sign In"}
            </Button>
          </form>

          {/* Footer */}
          <div className="mt-6 pt-6 border-t border-border-subtle">
            <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
              <span className="material-symbols-outlined text-[16px]">terminal</span>
              <span>Terminal-inspired design for developers</span>
            </div>
          </div>
        </Card>

        {/* Help Text */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-6 text-center"
        >
          <p className="text-sm text-text-muted">
            Need help?{" "}
            <a
              href="https://github.com/yourusername/claudeflow"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-500 hover:text-brand-400 transition-colors"
            >
              View documentation
            </a>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
