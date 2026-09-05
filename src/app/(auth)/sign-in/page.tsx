import { appConfig, capabilities } from "@/config/app";
import { AuthForm } from "@/components/features/AuthForms";

export const metadata = { title: "Sign in" };

export default function Page() {
  return (
    <AuthForm
      mode="sign-in"
      authConfigured={capabilities.hasAuth}
      googleEnabled={appConfig.auth.googleOAuthEnabled}
    />
  );
}
