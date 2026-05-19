"use client";

import React, { Component, ReactNode } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <Card className="max-w-2xl w-full" elev>
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-red-500/10 rounded-full mb-4">
                <span className="material-symbols-outlined text-[40px] text-red-500">
                  error
                </span>
              </div>
              <h2 className="text-2xl font-bold text-text-main mb-2">
                Something went wrong
              </h2>
              <p className="text-sm text-text-muted mb-6">
                An unexpected error occurred. Please try again or contact support if the problem persists.
              </p>

              {this.props.showDetails && this.state.error && (
                <div className="mb-6 p-4 bg-surface-2 border border-border-subtle rounded-lg text-left">
                  <p className="text-xs font-mono text-red-600 mb-2">
                    {this.state.error.name}: {this.state.error.message}
                  </p>
                  {this.state.errorInfo && (
                    <details className="text-xs font-mono text-text-muted">
                      <summary className="cursor-pointer hover:text-text-main">
                        Stack trace
                      </summary>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="primary"
                  size="md"
                  icon="refresh"
                  onClick={this.handleReset}
                >
                  Try Again
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  icon="home"
                  onClick={() => (window.location.href = "/dashboard")}
                >
                  Go to Dashboard
                </Button>
              </div>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export function ChartErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex items-center justify-center h-[300px] bg-surface-2 border border-border-subtle rounded-lg">
          <div className="text-center">
            <span className="material-symbols-outlined text-[48px] text-red-500 mb-2 block">
              error
            </span>
            <p className="text-sm text-text-muted">Failed to load chart</p>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

export function ComponentErrorBoundary({ children, componentName }: { children: ReactNode; componentName?: string }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-red-500">error</span>
            <p className="text-sm text-red-600">
              Failed to load {componentName || "component"}
            </p>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
