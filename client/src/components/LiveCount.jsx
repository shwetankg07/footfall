export default function LiveCount({ count }) {
  return (
    <span className="live" aria-live="polite">
      <span className={`live-dot${count ? "" : " idle"}`} aria-hidden="true" />
      {count === 1 ? "1 person on the site now" : `${count ?? 0} people on the site now`}
    </span>
  );
}
