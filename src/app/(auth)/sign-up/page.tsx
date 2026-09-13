import { redirect } from "next/navigation";

export const metadata = {
  title: "Account access",
};

export default function Page() {
  redirect("/sign-in?error=invite-only");
}