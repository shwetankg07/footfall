export default function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--ink)" />
      <rect x="7" y="17" width="4" height="8" rx="1.5" fill="var(--page)" />
      <rect x="14" y="11" width="4" height="14" rx="1.5" fill="var(--page)" />
      <rect x="21" y="6" width="4" height="19" rx="1.5" fill="var(--accent)" />
    </svg>
  );
}
