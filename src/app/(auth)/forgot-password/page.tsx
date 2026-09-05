import { appConfig, capabilities } from "@/config/app";
import { AuthForm } from "@/components/features/AuthForms";

export const metadata = { title: "Reset password" };

export default function Page() {
  return (
    <AuthForm
      mode="forgot"
      authConfigured={capabilities.hasAuth}
      googleEnabled={appConfig.auth.googleOAuthEnabled}
    />
  );
}
