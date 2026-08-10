import { BarChart3 } from "lucide-react";

import DashboardGrid from "@/components/dashboard/DashboardGrid";
import StatsCard from "@/components/dashboard/StatsCard";

type ReportSummaryCardsProps = {
  cards: { label: string; value: string }[];
};

/**
 * Renders any report's summaryCards uniformly by reusing the existing
 * StatsCard/DashboardGrid — the same component family the dashboard uses,
 * not a new one-off tile design. A future report type needs no new UI
 * here as long as its compute function returns the standard shape.
 */
export default function ReportSummaryCards({ cards }: ReportSummaryCardsProps) {
  if (cards.length === 0) return null;

  return (
    <DashboardGrid>
      {cards.map((card) => (
        <StatsCard key={card.label} title={card.label} value={card.value} icon={BarChart3} />
      ))}
    </DashboardGrid>
  );
}
