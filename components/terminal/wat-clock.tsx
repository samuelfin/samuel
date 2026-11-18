"use client";

import { useSyncExternalStore } from "react";
import { formatWatClock } from "@/lib/format";

function subscribe(onChange: () => void) {
  const id = window.setInterval(onChange, 10_000);
  return () => window.clearInterval(id);
}

/** Minute-resolution snapshot keeps the value stable between renders. */
const getSnapshot = () => Math.floor(Date.now() / 60_000);
const getServerSnapshot = () => null;

/** Current Lagos time. Rendered on the client only, to avoid hydration mismatches. */
export function WatClock() {
  const minute = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <span className="term-clock" title="Lagos time (West Africa Time, UTC+1)">
      <span className="term-clock-time">{minute === null ? "--:--" : formatWatClock(new Date(minute * 60_000))}</span>
      <span className="term-clock-zone">WAT</span>
    </span>
  );
}
