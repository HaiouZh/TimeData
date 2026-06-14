import { useState } from "react";
import { HeartRateCard } from "./health/HeartRateCard.tsx";
import { HrvCard } from "./health/HrvCard.tsx";
import { SleepCard } from "./health/SleepCard.tsx";
import { StressCard } from "./health/StressCard.tsx";
import { RunsCard } from "./health/RunsCard.tsx";

type DateRange = "30" | "90" | "all";

export function HealthDashboardContent() {
  const [range, setRange] = useState<DateRange>("30");

  return (
    <div className="health-dashboard">
      <div className="health-range-selector">
        {(["30", "90", "all"] as const).map((r) => (
          <button
            key={r}
            type="button"
            className={`range-btn ${range === r ? "active" : ""}`}
            onClick={() => setRange(r)}
          >
            {r === "all" ? "全部" : `${r}天`}
          </button>
        ))}
      </div>
      <HeartRateCard range={range} />
      <HrvCard range={range} />
      <SleepCard range={range} />
      <StressCard range={range} />
      <RunsCard range={range} />
    </div>
  );
}
