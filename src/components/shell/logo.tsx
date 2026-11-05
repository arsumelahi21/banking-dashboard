import { brand } from "@/lib/brand";

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-fg">
      <svg viewBox="0 0 24 24" className="size-6 text-accent" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <path d="M12 2c-6 6-6 14 0 20" stroke="currentColor" strokeWidth="2" />
        <path d="M12 2v20" stroke="currentColor" strokeWidth="2" />
      </svg>
      <span className="font-display text-xl leading-none">{brand.name}</span>
    </span>
  );
}
