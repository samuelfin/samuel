"use client";

import { useState } from "react";
import { TIME_RANGES, type TimeRangeId } from "@/lib/catalog/markets";

/** Time-range control for charts. Disabled until the chart has a connected series. */
export function RangeSelector({ disabled = false, initial = "1M", label = "Time range" }: { disabled?: boolean; initial?: TimeRangeId; label?: string }) {
  const [selected, setSelected] = useState<TimeRangeId>(initial);
  return (
    <div className="range" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {TIME_RANGES.map((range) => (
        <button
          key={range.id}
          type="button"
          role="radio"
          aria-checked={selected === range.id}
          className="range-btn"
          disabled={disabled}
          title={disabled ? `${range.description} — no series connected` : range.description}
          onClick={() => setSelected(range.id)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
