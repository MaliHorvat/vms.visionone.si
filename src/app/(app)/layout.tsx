import { VmsShell } from "@/components/VmsShell";
import { getCurrentUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getCurrentUser();
  return <VmsShell customerName={user?.customer.name ?? "VisionOne VMS"}>{children}</VmsShell>;
}
