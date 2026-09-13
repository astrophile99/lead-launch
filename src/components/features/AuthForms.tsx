"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Button,
  Checkbox,
  Field,
  InfoNote,
  Input,
  Panel,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type AuthMode = "sign-in" | "sign-up" | "forgot" | "reset" | "verify";

const COPY: Record<
  AuthMode,
  { title: string; body: string; cta: string }
> = {
  "sign-in": {
    title: "Sign in",
    body: "Pick up where you left off.",
    cta: "Sign in",
  },
  "sign-up": {
    title: "Create your workspace",
    body: "One account, one workspace. You can invite people later.",
    cta: "Create account",
  },
  forgot: {
    title: "Reset your password",
    body: "We will email you a link to choose a new one.",
    cta: "Send reset link",
  },
  reset: {
    title: "Choose a new password",
    body: "At least 10 characters. A passphrase is easier to remember and harder to guess.",
    cta: "Set password",
  },
  verify: {
    title: "Confirm your email",
    body: "Check your inbox for the confirmation link.",
    cta: "Resend confirmation",
  },
};

type Errors = Partial<
  Record<"email" | "password" | "confirm" | "name" | "form", string>
>;

function validate(
  mode: AuthMode,
  values: Record<string, string>,
  accepted: boolean,
): Errors {
  const errors: Errors = {};

  if (mode !== "reset") {
    const email = values.email?.trim() ?? "";

    if (!email) {
      errors.email = "Enter your email address.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "That is not a valid email address.";
    }
  }

  if (
    mode === "sign-in" ||
    mode === "sign-up" ||
    mode === "reset"
  ) {
    const password = values.password ?? "";

    if (!password) {
      errors.password = "Enter a password.";
    } else if (mode !== "sign-in" && password.length < 10) {
      errors.password = "Use at least 10 characters.";
    }
  }

  if (mode === "sign-up") {
    if (!values.name?.trim()) {
      errors.name = "Enter your name.";
    }

    if (!accepted) {
      errors.confirm = "Accept the terms to continue.";
    }
  }

  if (mode === "reset" && values.password !== values.confirm) {
    errors.confirm = "The two passwords do not match.";
  }

  return errors;
}

export function AuthForm({
  mode,
  authConfigured,
  googleEnabled,
}: {
  mode: AuthMode;
  authConfigured: boolean;
  googleEnabled: boolean;
}) {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/";

  const [values, setValues] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const copy = COPY[mode];

  const set = (key: string, value: string) => {
    setValues((current) => ({
      ...current,
      [key]: value,
    }));

    setErrors((current) => ({
      ...current,
      [key]: undefined,
      form: undefined,
    }));

    setMessage(null);
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const found = validate(mode, values, accepted);
    setErrors(found);
    setMessage(null);

    if (Object.keys(found).length > 0 || !authConfigured) {
      return;
    }

    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();

      if (mode === "sign-in") {
        const { error } = await supabase.auth.signInWithPassword({
          email: values.email.trim(),
          password: values.password,
        });

        if (error) {
          throw error;
        }

        window.location.assign(redirectTo);
        return;
      }

      if (mode === "sign-up") {
        const { data, error } = await supabase.auth.signUp({
          email: values.email.trim(),
          password: values.password,
          options: {
            data: {
              full_name: values.name.trim(),
            },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (error) {
          throw error;
        }

        if (data.session) {
          window.location.assign("/");
          return;
        }

        setMessage(
          "Account created. Check your email to confirm your address before signing in.",
        );
        return;
      }

      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          values.email.trim(),
          {
            redirectTo: `${window.location.origin}/reset-password`,
          },
        );

        if (error) {
          throw error;
        }

        setMessage(
          "If an account exists for that email, we sent a password reset link.",
        );
        return;
      }

      if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({
          password: values.password,
        });

        if (error) {
          throw error;
        }

        setMessage(
          "Your password has been updated. Redirecting to the dashboard…",
        );

        window.setTimeout(() => {
          window.location.assign("/");
        }, 900);

        return;
      }

      if (mode === "verify") {
        const email = values.email?.trim();

        if (!email) {
          setErrors({
            email: "Enter your email address.",
          });
          return;
        }

        const { error } = await supabase.auth.resend({
          type: "signup",
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (error) {
          throw error;
        }

        setMessage(
          "If that account exists and needs confirmation, we sent a new verification email.",
        );
        return;
      }
    } catch (error) {
      const raw =
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.";

      setErrors({
        form: raw,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!authConfigured || !googleEnabled || loading) {
      return;
    }

    setLoading(true);
    setErrors({});
    setMessage(null);

    try {
      const supabase = createSupabaseBrowserClient();

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(
            redirectTo,
          )}`,
        },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      setErrors({
        form:
          error instanceof Error
            ? error.message
            : "Unable to continue with Google.",
      });
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex items-center gap-2">
        <span
          aria-hidden
          className="grid size-6 place-items-center rounded-sm bg-accent text-[11px] font-bold text-accent-ink"
        >
          L
        </span>

        <span className="text-[14px] font-semibold tracking-[-0.015em]">
          Lead <span className="text-ink-4">&rarr;</span> Launch
        </span>
      </div>

      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
        {copy.title}
      </h1>

      <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
        {copy.body}
      </p>

      {!authConfigured ? (
        <div className="mt-4">
          <InfoNote tone="warn">
            <strong className="font-semibold">
              Authentication is not configured.
            </strong>{" "}
            Check your Supabase environment variables and restart the
            development server.
          </InfoNote>
        </div>
      ) : null}

      <Panel className="mt-4 p-4">
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={handleSubmit}
        >
          {mode === "sign-up" ? (
            <Field
              label="Your name"
              htmlFor="a-name"
              error={errors.name}
              required
            >
              <Input
                id="a-name"
                autoComplete="name"
                value={values.name ?? ""}
                onChange={(event) => set("name", event.target.value)}
                aria-invalid={Boolean(errors.name)}
              />
            </Field>
          ) : null}

          {mode !== "reset" ? (
            <Field
              label="Email"
              htmlFor="a-email"
              error={errors.email}
              required
            >
              <Input
                id="a-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={values.email ?? ""}
                onChange={(event) => set("email", event.target.value)}
                aria-invalid={Boolean(errors.email)}
                placeholder="you@studio.com"
              />
            </Field>
          ) : null}

          {mode === "sign-in" ||
          mode === "sign-up" ||
          mode === "reset" ? (
            <Field
              label={mode === "reset" ? "New password" : "Password"}
              htmlFor="a-password"
              error={errors.password}
              hint={
                mode === "sign-in"
                  ? undefined
                  : "At least 10 characters."
              }
              required
            >
              <Input
                id="a-password"
                type="password"
                autoComplete={
                  mode === "sign-in"
                    ? "current-password"
                    : "new-password"
                }
                value={values.password ?? ""}
                onChange={(event) =>
                  set("password", event.target.value)
                }
                aria-invalid={Boolean(errors.password)}
              />
            </Field>
          ) : null}

          {mode === "reset" ? (
            <Field
              label="Confirm password"
              htmlFor="a-confirm"
              error={errors.confirm}
              required
            >
              <Input
                id="a-confirm"
                type="password"
                autoComplete="new-password"
                value={values.confirm ?? ""}
                onChange={(event) =>
                  set("confirm", event.target.value)
                }
                aria-invalid={Boolean(errors.confirm)}
              />
            </Field>
          ) : null}

          {mode === "sign-up" ? (
            <>
              <Checkbox
                label={
                  <>
                    I agree to use this responsibly and to respect the
                    messaging rules of every channel I connect.
                  </>
                }
                checked={accepted}
                onChange={(event) =>
                  setAccepted(event.target.checked)
                }
              />

              {errors.confirm ? (
                <p className="text-[11.5px] text-danger">
                  {errors.confirm}
                </p>
              ) : null}
            </>
          ) : null}

          {errors.form ? (
            <InfoNote tone="warn">
              {errors.form}
            </InfoNote>
          ) : null}

          {message ? (
            <InfoNote tone="ok">
              {message}
            </InfoNote>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="mt-1 w-full"
            disabled={!authConfigured || loading}
          >
            {loading ? "Working…" : copy.cta}
          </Button>

          {googleEnabled &&
          (mode === "sign-in" || mode === "sign-up") ? (
            <>
              <div className="my-1 flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[11px] text-ink-4">
                  or
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>

              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={!authConfigured || loading}
                onClick={handleGoogleSignIn}
              >
                Continue with Google
              </Button>
            </>
          ) : null}
        </form>
      </Panel>

      <div className="mt-4 flex flex-col gap-1.5 text-[12.5px]">
        {mode === "sign-in" ? (
          <Link
            href="/forgot-password"
            className="text-accent hover:underline underline-offset-2"
          >
            Forgot your password?
          </Link>
        ) : null}

        {mode === "sign-up" ? (
          <p className="text-ink-3">
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="text-accent hover:underline underline-offset-2"
            >
              Sign in
            </Link>
          </p>
        ) : null}

        {mode === "verify" ? (
          <p className="text-ink-3">
            Need a different email?{" "}
            <Link
              href="/sign-in"
              className="text-accent hover:underline underline-offset-2"
            >
              Back to sign in
            </Link>
          </p>
        ) : null}

        {mode !== "sign-in" && mode !== "sign-up" && mode !== "verify" ? (
          <p className="text-ink-3">
            <Link
              href="/sign-in"
              className="text-accent hover:underline underline-offset-2"
            >
              Back to sign in
            </Link>
          </p>
        ) : null}

        <p className="mt-1 text-ink-4">
          <Link
            href="/"
            className={cn(
              "transition-colors hover:text-ink-2",
            )}
          >
            Continue to the app without signing in →
          </Link>
        </p>
      </div>
    </div>
  );
}