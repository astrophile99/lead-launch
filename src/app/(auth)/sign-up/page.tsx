import { appConfig, capabilities } from "@/config/app";
import { AuthForm } from "@/components/features/AuthForms";

export const metadata = { title: "Create account" };

export default function Page() {
  return (
    <AuthForm
      mode="sign-up"
      authConfigured={capabilities.hasAuth}
      googleEnabled={appConfig.auth.googleOAuthEnabled}
    />
  );
}
