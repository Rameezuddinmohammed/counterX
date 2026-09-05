import { Header } from "@/components/header";
import { ManifestEntry } from "@/components/manifest-entry";
import { HowItClears } from "@/components/how-it-clears";
import { AudienceSplit } from "@/components/audience-split";
import { Footer } from "@/components/footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <Header />
      <main>
        <ManifestEntry />
        <HowItClears />
        <AudienceSplit />
      </main>
      <Footer />
    </div>
  );
}
