"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import Button from "@/components/ui/Button";

interface TourStep {
  id: string;
  title: string;
  description: string;
  target: string; // CSS selector for the element to highlight
  position: "top" | "bottom" | "left" | "right";
  action?: {
    label: string;
    onClick: () => void;
  };
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to ClaudeFlow",
    description: "Let's take a quick tour of the key features to help you get started.",
    target: "body",
    position: "bottom",
  },
  {
    id: "accounts",
    title: "Account Management",
    description: "View and manage all your Claude API accounts in one place. Monitor usage, quotas, and status at a glance.",
    target: '[href="/dashboard/accounts"]',
    position: "right",
  },
  {
    id: "activity",
    title: "Real-time Activity Stream",
    description: "Track all API requests and events in real-time. Filter by account, event type, or status.",
    target: '[href="/dashboard/activity"]',
    position: "right",
  },
  {
    id: "analytics",
    title: "Analytics & Insights",
    description: "Analyze usage patterns, track costs, and get AI-powered insights to optimize your workflow.",
    target: '[href="/dashboard/analytics"]',
    position: "right",
  },
  {
    id: "command-palette",
    title: "Command Palette",
    description: "Press ⌘K (or Ctrl+K) anytime to quickly navigate and perform actions.",
    target: "body",
    position: "bottom",
    action: {
      label: "Try it now",
      onClick: () => {
        // Trigger command palette
        const event = new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
        });
        document.dispatchEvent(event);
      },
    },
  },
  {
    id: "shortcuts",
    title: "Keyboard Shortcuts",
    description: "Press ? to view all available keyboard shortcuts and boost your productivity.",
    target: "body",
    position: "bottom",
  },
];

const STORAGE_KEY = "claudeflow_onboarding_completed";

export interface OnboardingTourProps {
  onComplete?: () => void;
  autoStart?: boolean;
}

export default function OnboardingTour({ onComplete, autoStart = true }: OnboardingTourProps) {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    // Check if user has completed onboarding
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed && autoStart) {
      // Delay to allow page to render
      setTimeout(() => setIsActive(true), 1000);
    }
  }, [autoStart]);

  useEffect(() => {
    if (!isActive) return;

    const step = TOUR_STEPS[currentStep];
    const element = document.querySelector(step.target);

    if (element) {
      const rect = element.getBoundingClientRect();
      setTargetRect(rect);

      // Scroll element into view
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setTargetRect(null);
    }
  }, [isActive, currentStep]);

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    handleComplete();
  };

  const handleComplete = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsActive(false);
    onComplete?.();
  };

  if (!isActive) return null;

  const step = TOUR_STEPS[currentStep];
  const progress = ((currentStep + 1) / TOUR_STEPS.length) * 100;

  // Calculate tooltip position
  const getTooltipPosition = () => {
    if (!targetRect) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const padding = 20;
    const tooltipWidth = 400;
    const tooltipHeight = 200;

    switch (step.position) {
      case "top":
        return {
          top: `${targetRect.top - tooltipHeight - padding}px`,
          left: `${targetRect.left + targetRect.width / 2}px`,
          transform: "translateX(-50%)",
        };
      case "bottom":
        return {
          top: `${targetRect.bottom + padding}px`,
          left: `${targetRect.left + targetRect.width / 2}px`,
          transform: "translateX(-50%)",
        };
      case "left":
        return {
          top: `${targetRect.top + targetRect.height / 2}px`,
          left: `${targetRect.left - tooltipWidth - padding}px`,
          transform: "translateY(-50%)",
        };
      case "right":
        return {
          top: `${targetRect.top + targetRect.height / 2}px`,
          left: `${targetRect.right + padding}px`,
          transform: "translateY(-50%)",
        };
      default:
        return {
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        };
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        {/* Overlay with spotlight effect */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleSkip}
        />

        {/* Spotlight highlight */}
        {targetRect && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="absolute pointer-events-none"
            style={{
              top: targetRect.top - 8,
              left: targetRect.left - 8,
              width: targetRect.width + 16,
              height: targetRect.height + 16,
              boxShadow: "0 0 0 4px rgba(99, 102, 241, 0.5), 0 0 0 9999px rgba(0, 0, 0, 0.6)",
              borderRadius: "12px",
            }}
          />
        )}

        {/* Tooltip */}
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          className="absolute w-[400px] bg-surface border border-border-subtle rounded-[14px] shadow-[var(--shadow-elev)] p-6"
          style={getTooltipPosition()}
        >
          {/* Progress bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-surface-2 rounded-t-[14px] overflow-hidden">
            <motion.div
              className="h-full bg-brand-500"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* Content */}
          <div className="mt-2">
            <div className="flex items-start justify-between mb-3">
              <h3 id="tour-title" className="text-lg font-semibold text-text-main">
                {step.title}
              </h3>
              <button
                onClick={handleSkip}
                className="p-1 rounded-lg hover:bg-surface-2 transition-colors"
                aria-label="Skip tour"
              >
                <span className="material-symbols-outlined text-[20px] text-text-muted">
                  close
                </span>
              </button>
            </div>

            <p className="text-sm text-text-muted mb-4">{step.description}</p>

            {step.action && (
              <Button
                variant="outline"
                size="sm"
                onClick={step.action.onClick}
                className="mb-4"
              >
                {step.action.label}
              </Button>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-border-subtle">
              <div className="flex items-center gap-1">
                {TOUR_STEPS.map((_, index) => (
                  <div
                    key={index}
                    className={cn(
                      "w-2 h-2 rounded-full transition-colors",
                      index === currentStep ? "bg-brand-500" : "bg-surface-3"
                    )}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                {currentStep > 0 && (
                  <Button variant="ghost" size="sm" onClick={handlePrevious}>
                    Previous
                  </Button>
                )}
                <Button variant="primary" size="sm" onClick={handleNext}>
                  {currentStep === TOUR_STEPS.length - 1 ? "Finish" : "Next"}
                </Button>
              </div>
            </div>

            {/* Step counter */}
            <p className="text-xs text-text-muted text-center mt-3">
              Step {currentStep + 1} of {TOUR_STEPS.length}
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// Hook to manually trigger the tour
export function useOnboardingTour() {
  const [isActive, setIsActive] = useState(false);

  const startTour = () => {
    setIsActive(true);
  };

  const resetTour = () => {
    localStorage.removeItem(STORAGE_KEY);
    setIsActive(true);
  };

  const hasCompletedTour = () => {
    return localStorage.getItem(STORAGE_KEY) === "true";
  };

  return {
    isActive,
    startTour,
    resetTour,
    hasCompletedTour,
  };
}
