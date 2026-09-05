import { appConfig, capabilities } from "@/config/app";
import { AuthForm } from "@/components/features/AuthForms";

export const metadata = { title: "Choose a new password" };

export default function Page() {
  return (
    <AuthForm
      mode="reset"
      authConfigured={capabilities.hasAuth}
      googleEnabled={appConfig.auth.googleOAuthEnabled}
    />
  );
}
