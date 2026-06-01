import { redirect } from "next/navigation";

export default function GatewayRedirect() {
  redirect("/dashboard");
}
