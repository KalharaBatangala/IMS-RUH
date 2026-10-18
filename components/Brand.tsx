// Product name and logo, defined once so every screen uses the same wording.
export const APP_NAME = 'DEIE Labs';
export const APP_INSTITUTION = 'University of Ruhuna';

// Monogram: a "D" outline fed by a short lead with a gold terminal, a quiet nod to
// electrical engineering. Pure SVG, no image file or web font required.
export function BrandMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect width="40" height="40" rx="10" className="fill-brand-800" />
      <rect x="0.5" y="0.5" width="39" height="39" rx="9.5" fill="none" stroke="white" strokeOpacity="0.08" />
      <path
        d="M17 12h4.5a8 8 0 0 1 0 16H17z"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path d="M9.5 20H17" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="9.5" cy="20" r="2.6" className="fill-gold-400" />
    </svg>
  );
}

export function BrandLockup({ size = 36, inverted = false }: { size?: number; inverted?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={size} />
      <span className="flex flex-col leading-none">
        <span className={`text-[15px] tracking-tight ${inverted ? 'text-white' : 'text-slate-900'}`}>
          <span className="font-semibold">DEIE</span> <span className={`font-normal ${inverted ? 'text-brand-200' : 'text-slate-500'}`}>Labs</span>
        </span>
        <span className={`mt-1 text-[9.5px] font-medium uppercase tracking-[0.16em] ${inverted ? 'text-brand-300' : 'text-slate-400'}`}>
          {APP_INSTITUTION}
        </span>
      </span>
    </span>
  );
}
