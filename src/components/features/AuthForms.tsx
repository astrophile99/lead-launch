"use client";

import Link from "next/link";
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

/**
 * Authentication screens.
 *
 * Complete and validated, but deliberately inert until Supabase is configured:
 * submitting explains what is missing rather than pretending to sign anybody
 * in. The alternative — a form that appears to work and silently does nothing —
 * is the exact thing this product refuses to ship.
 */

export type AuthMode = "sign-in" | "sign-up" | "forgot" | "reset" | "verify";

const COPY: Record<AuthMode, { title: string; body: string; cta: string }> = {
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

type Errors = Partial<Record<"email" | "password" | "confirm" | "name", string>>;

function validate(mode: AuthMode, values: Record<string, string>, accepted: boolean): Errors {
  const errors: Errors = {};

  if (mode !== "reset") {
    const email = values.email?.trim() ?? "";
    if (!email) errors.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "That is not a valid email address.";
  }

  if (mode === "sign-in" || mode === "sign-up" || mode === "reset") {
    const password = values.password ?? "";
    if (!password) errors.password = "Enter a password.";
    else if (mode !== "sign-in" && password.length < 10) {
      errors.password = "Use at least 10 characters.";
    }
  }

  if (mode === "sign-up") {
    if (!values.name?.trim()) errors.name = "Enter your name.";
    if (!accepted) errors.confirm = "Accept the terms to continue.";
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
  const [values, setValues] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  const copy = COPY[mode];
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <div className="w-full max-w-sm">
      <div className="flex items-center gap-2 mb-6">
        <span
          aria-hidden
          className="size-6 rounded-sm bg-accent text-accent-ink text-[11px] font-bold grid place-items-center"
        >
          L
        </span>
        <span className="text-[14px] font-semibold tracking-[-0.015em]">
          Lead <span className="text-ink-4">&rarr;</span> Launch
        </span>
      </div>

      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{copy.title}</h1>
      <p className="mt-1 text-[13px] text-ink-3 leading-relaxed">{copy.body}</p>

      {!authConfigured ? (
        <div className="mt-4">
          <InfoNote tone="warn">
            <strong className="font-semibold">Authentication is not configured.</strong> This form
            validates but cannot sign you in. Set{" "}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>,
            then restart. Until then the app runs single-tenant against the seeded workspace.
          </InfoNote>
        </div>
      ) : null}

      <Panel className="mt-4 p-4">
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const found = validate(mode, values, accepted);
            setErrors(found);
            setSubmitted(Object.keys(found).length === 0);
          }}
        >
          {mode === "sign-up" ? (
            <Field label="Your name" htmlFor="a-name" error={errors.name} required>
              <Input
                id="a-name"
                autoComplete="name"
                value={values.name ?? ""}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={Boolean(errors.name)}
              />
            </Field>
          ) : null}

          {mode !== "reset" ? (
            <Field label="Email" htmlFor="a-email" error={errors.email} required>
              <Input
                id="a-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={values.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
                aria-invalid={Boolean(errors.email)}
                placeholder="you@studio.com"
              />
            </Field>
          ) : null}

          {mode === "sign-in" || mode === "sign-up" || mode === "reset" ? (
            <Field
              label={mode === "reset" ? "New password" : "Password"}
              htmlFor="a-password"
              error={errors.password}
              hint={mode === "sign-in" ? undefined : "At least 10 characters."}
              required
            >
              <Input
                id="a-password"
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={values.password ?? ""}
                onChange={(e) => set("password", e.target.value)}
                aria-invalid={Boolean(errors.password)}
              />
            </Field>
          ) : null}

          {mode === "reset" ? (
            <Field label="Confirm password" htmlFor="a-confirm" error={errors.confirm} required>
              <Input
                id="a-confirm"
                type="password"
                autoComplete="new-password"
                value={values.confirm ?? ""}
                onChange={(e) => set("confirm", e.target.value)}
                aria-invalid={Boolean(errors.confirm)}
              />
            </Field>
          ) : null}

          {mode === "sign-up" ? (
            <>
              <Checkbox
                label={
                  <>
                    I agree to use this responsibly and to respect the messaging rules of every
                    channel I connect.
                  </>
                }
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              {errors.confirm ? (
                <p className="text-[11.5px] text-danger -mt-1">{errors.confirm}</p>
              ) : null}
            </>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full mt-1"
            disabled={!authConfigured}
            title={authConfigured ? undefined : "Configure Supabase to enable sign-in."}
          >
            {copy.cta}
          </Button>

          {submitted ? (
            <InfoNote tone="warn">
              The form is valid, but nothing was submitted: no authentication provider is connected,
              so there is nowhere to send it. Wiring this to Supabase is a single call in{" "}
              <code>src/app/(auth)</code> once the keys are set.
            </InfoNote>
          ) : null}

          {googleEnabled && (mode === "sign-in" || mode === "sign-up") ? (
            <>
              <div className="flex items-center gap-3 my-1">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[11px] text-ink-4">or</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <Button type="button" size="lg" className="w-full" disabled={!authConfigured}>
                Continue with Google
              </Button>
            </>
          ) : null}
        </form>
      </Panel>

      <div className="mt-4 flex flex-col gap-1.5 text-[12.5px]">
        {mode === "sign-in" ? (
          <>
            <Link href="/forgot-password" className="text-accent hover:underline underline-offset-2">
              Forgot your password?
            </Link>
            <p className="text-ink-3">
              No account?{" "}
              <Link href="/sign-up" className="text-accent hover:underline underline-offset-2">
                Create one
              </Link>
            </p>
          </>
        ) : null}
        {mode !== "sign-in" ? (
          <p className="text-ink-3">
            <Link href="/sign-in" className="text-accent hover:underline underline-offset-2">
              Back to sign in
            </Link>
          </p>
        ) : null}
        <p className="text-ink-4 mt-1">
          <Link href="/" className={cn("hover:text-ink-2 transition-colors")}>
            Continue to the app without signing in →
          </Link>
        </p>
      </div>
    </div>
  );
}
