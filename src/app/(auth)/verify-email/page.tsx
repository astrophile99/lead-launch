import { appConfig, capabilities } from "@/config/app";
import { AuthForm } from "@/components/features/AuthForms";

export const metadata = { title: "Confirm your email" };

export default function Page() {
  return (
    <AuthForm
      mode="verify"
      authConfigured={capabilities.hasAuth}
      googleEnabled={appConfig.auth.googleOAuthEnabled}
    />
  );
}
