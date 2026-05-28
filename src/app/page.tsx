import { redirect } from "next/navigation";

export default function Home() {
  // Redirect to dashboard if logged in, otherwise to login
  // For now, redirect to dashboard
  redirect("/dashboard");
}
