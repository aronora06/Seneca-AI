import { CtaBand } from "./components/CtaBand";
import { FeatureGrid } from "./components/FeatureGrid";
import { Hero } from "./components/Hero";
import { PrivacyTeaser } from "./components/PrivacyTeaser";
import { UseCases } from "./components/UseCases";
import { useDocumentTitle } from "./useDocumentTitle";

export function HomePage() {
  useDocumentTitle("Seneca — voice + canvas, together");

  return (
    <>
      <Hero />
      <FeatureGrid />
      <UseCases />
      <PrivacyTeaser />
      <CtaBand />
    </>
  );
}
