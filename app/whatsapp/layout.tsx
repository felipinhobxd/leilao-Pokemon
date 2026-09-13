import type { ReactNode } from "react";
import WhatsAppGroupSelector from "./group-selector";

export const dynamic = "force-dynamic";

export default function WhatsAppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <>
    <style>{`.main-grid .form-grid > label:nth-of-type(2){display:none!important;}`}</style>
    <WhatsAppGroupSelector />
    {children}
  </>;
}
