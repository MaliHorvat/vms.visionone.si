import { MojDemoShell } from "@/components/moj-demo/MojDemoShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <MojDemoShell>{children}</MojDemoShell>;
}
