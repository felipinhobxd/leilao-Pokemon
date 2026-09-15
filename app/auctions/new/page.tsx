import BulkAuctionWizard from "./bulk-wizard";
import RecognitionToggle from "./recognition-toggle";

export default function NewAuctionPage() {
  return <>
    <RecognitionToggle />
    <BulkAuctionWizard />
  </>;
}
