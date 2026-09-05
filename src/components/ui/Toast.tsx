"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { StatusDot, type Tone } from "./primitives";

/**
 * Toasts report what actually happened. They are deliberately plain: a title,
 * an optional detail line, and an optional action. Nothing auto-dismisses on
 * error, because an error the user did not read is an error they will hit again.
 */

export type ToastKind = "success" | "error" | "warning" | "info";

export type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
};

const KIND_TONE: Record<ToastKind, Tone> = {
  success: "ok",
  error: "danger",
  warning: "warn",
  info: "info",
};

const AUTO_DISMISS_MS: Record<ToastKind, number | null> = {
  success: 4000,
  info: 5000,
  warning: 8000,
  error: null,
};

type ToastContextValue = {
  toast: (t: Omit<Toast, "id">) => void;
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  warning: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>.");
  return ctx;
}

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, "id">) => {
      const id = `t${counter++}`;
      // Cap the stack: a burst of bulk-operation results should not bury the UI.
      setToasts((list) => [...list.slice(-4), { ...input, id }]);
      const ttl = AUTO_DISMISS_MS[input.kind];
      if (ttl != null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ttl),
        );
      }
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      dismiss,
      success: (title, detail) => toast({ kind: "success", title, detail }),
      error: (title, detail) => toast({ kind: "error", title, detail }),
      warning: (title, detail) => toast({ kind: "warning", title, detail }),
      info: (title, detail) => toast({ kind: "info", title, detail }),
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed z-[60] bottom-20 right-3 sm:bottom-4 sm:right-4 flex flex-col gap-2 w-[min(22rem,calc(100vw-1.5rem))] pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "anim-toast pointer-events-auto bg-surface border border-line-strong rounded-md shadow-overlay px-3 py-2.5",
              "flex items-start gap-2.5",
            )}
          >
            <span className="mt-1.5">
              <StatusDot tone={KIND_TONE[t.kind]} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-ink leading-snug">{t.title}</p>
              {t.detail ? (
                <p className="mt-0.5 text-[11.5px] text-ink-3 leading-snug">{t.detail}</p>
              ) : null}
              {t.action ? (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="mt-1.5 text-[11.5px] font-medium text-accent hover:underline underline-offset-2"
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
              className="text-ink-4 hover:text-ink-2 transition-colors text-[13px] leading-none shrink-0 -mt-0.5 p-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
