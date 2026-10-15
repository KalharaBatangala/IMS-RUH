import type { RequestStatus } from '@prisma/client';
import type { Availability } from '@/lib/availability';

const REQUEST_STYLES: Record<RequestStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-blue-50 text-blue-700 border-blue-200',
  ISSUED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  RETURNED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  OVERDUE: 'bg-rose-50 text-rose-700 border-rose-200',
  REJECTED: 'bg-slate-100 text-slate-600 border-slate-300',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-300',
  EXPIRED: 'bg-slate-100 text-slate-600 border-slate-300',
};

// "APPROVED" is shown as "RECOMMENDED" (the business word); the stored value is unchanged.
const REQUEST_LABELS: Partial<Record<RequestStatus, string>> = { APPROVED: 'RECOMMENDED' };

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border whitespace-nowrap ${REQUEST_STYLES[status]}`}>
      {REQUEST_LABELS[status] ?? status}
    </span>
  );
}

const AVAILABILITY_STYLES: Record<Availability, string> = {
  AVAILABLE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RESERVED: 'bg-blue-50 text-blue-700 border-blue-200',
  ISSUED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  UNAVAILABLE: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function AvailabilityBadge({ availability, count }: { availability: Availability; count?: number }) {
  return (
    <span className={`inline-block mr-1 mb-1 px-2 py-0.5 text-[10px] font-bold rounded-full border ${AVAILABILITY_STYLES[availability]}`}>
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
