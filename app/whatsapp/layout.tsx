import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function WhatsAppLayout({ children }: Readonly<{ children: ReactNode }>) {
  // The central page owns status/group polling and the default group selector.
  return <>{children}</>;
}
