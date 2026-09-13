import { Suspense } from "react";

import { appConfig, capabilities } from "@/config/app";
import { AuthForm } from "@/components/features/AuthForms";

export const metadata = { title: "Sign in" };

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-sm">
          <div className="h-6 w-40 animate-pulse rounded bg-surface-2" />
          <div className="mt-3 h-4 w-64 animate-pulse rounded bg-surface-2" />
          <div className="mt-6 h-48 animate-pulse rounded-lg bg-surface-2" />
        </div>
      }
    >
      <AuthForm
        mode="sign-in"
        authConfigured={capabilities.hasAuth}
        googleEnabled={appConfig.auth.googleOAuthEnabled}
      />
    </Suspense>
  );
}