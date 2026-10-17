export default function LiveCount({ count, compact = false }) {
  const n = count ?? 0;
  const label = compact ? `${n} online` : n === 1 ? "1 person on the site now" : `${n} people on the site now`;
  return (
    <span className="live" aria-live="polite">
      <span className={`live-dot${n ? "" : " idle"}`} aria-hidden="true" />
      {label}
    </span>
  );
}
