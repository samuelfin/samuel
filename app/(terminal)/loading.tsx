export default function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="skeleton skeleton-head" />
      <div className="panel-grid">
        <div className="skeleton span-8" />
        <div className="skeleton span-4" />
        <div className="skeleton span-6" />
        <div className="skeleton span-6" />
      </div>
    </div>
  );
}
