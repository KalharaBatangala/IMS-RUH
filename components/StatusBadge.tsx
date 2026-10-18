import type { RequestStatus } from '@prisma/client';
import type { Availability } from '@/lib/availability';

const REQUEST_STYLES: Record<RequestStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800 ring-amber-200/80',
  APPROVED: 'bg-brand-50 text-brand-700 ring-brand-200',
  ISSUED: 'bg-brand-800 text-white ring-brand-800',
  RETURNED: 'bg-emerald-50 text-emerald-700 ring-emerald-200/80',
  OVERDUE: 'bg-rose-50 text-rose-700 ring-rose-200/80',
  REJECTED: 'bg-slate-100 text-slate-500 ring-slate-200',
  CANCELLED: 'bg-slate-100 text-slate-500 ring-slate-200',
  EXPIRED: 'bg-slate-100 text-slate-500 ring-slate-200',
};

// "APPROVED" is shown as "RECOMMENDED" (the business word); the stored value is unchanged.
const REQUEST_LABELS: Partial<Record<RequestStatus, string>> = { APPROVED: 'RECOMMENDED' };

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold tracking-wide rounded-md ring-1 ring-inset whitespace-nowrap ${REQUEST_STYLES[status]}`}>
      {REQUEST_LABELS[status] ?? status}
    </span>
  );
}

const AVAILABILITY_STYLES: Record<Availability, string> = {
  AVAILABLE: 'bg-emerald-50 text-emerald-700 ring-emerald-200/80',
  RESERVED: 'bg-brand-50 text-brand-700 ring-brand-200',
  ISSUED: 'bg-brand-800 text-white ring-brand-800',
  UNAVAILABLE: 'bg-rose-50 text-rose-700 ring-rose-200/80',
};

export function AvailabilityBadge({ availability, count }: { availability: Availability; count?: number }) {
  return (
    <span className={`inline-flex items-center mr-1 mb-1 px-2 py-0.5 text-[10px] font-semibold tracking-wide rounded-md ring-1 ring-inset tabular ${AVAILABILITY_STYLES[availability]}`}>
      {availability}
      {count !== undefined ? `: ${count}` : ''}
    </span>
  );
}

export const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  COORDINATOR: 'Coordinator',
  TECHNICAL_OFFICER: 'Technical Officer',
  BORROWER: 'Borrower',
} as const;
