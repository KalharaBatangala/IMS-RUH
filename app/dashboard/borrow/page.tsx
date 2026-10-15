'use client';

import { Suspense, useEffect, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ItemCondition, RequestStatus } from '@prisma/client';
import Swal from 'sweetalert2';
import { checkAndUpdateOverdueLogs } from '@/actions/cron';
import { getCurrentUserRole } from '@/actions/auth';
import {
  acknowledgeReturn,
  cancelBorrowRequest,
  finalizeReturn,
  getBorrowLogs,
  getReservableUnits,
  issueBorrowRequest,
  overrideReturnAcknowledgement,
  recommendBorrowRequest,
  regenerateHandoverCode,
  rejectBorrowRequest,
  startReturn,
} from '@/actions/borrow';
import { RequestStatusBadge } from '@/components/StatusBadge';

type LogsResult = Extract<Awaited<ReturnType<typeof getBorrowLogs>>, { success: true }>;
type LogItem = LogsResult['logs'][number];

const TABS: { key: string; label: string }[] = [
  { key: 'ACTION', label: 'NEEDS MY ACTION' },
  { key: 'ALL', label: 'ALL' },
  { key: 'PENDING', label: 'PENDING' },
  { key: 'APPROVED', label: 'RECOMMENDED' },
  { key: 'ISSUED', label: 'ISSUED' },
  { key: 'OVERDUE', label: 'OVERDUE' },
  { key: 'RETURNED', label: 'RETURNED' },
  { key: 'REJECTED', label: 'REJECTED' },
  { key: 'CANCELLED', label: 'CANCELLED' },
  { key: 'EXPIRED', label: 'EXPIRED' },
];

function needsAction(log: LogItem) {
  return Object.values(log.can).some(Boolean);
}

function fmtDate(d: Date | string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : '';
}
function fmtDateTime(d: Date | string | null | undefined) {
  return d ? new Date(d).toLocaleString() : '';
}

// Codes are shown once, to the staff member who must pass them on in person.
function showCode(title: string, code: string, note: string) {
  return Swal.fire({
    title,
    html: `<div style="font-family:monospace;font-size:2.25rem;letter-spacing:.4em;font-weight:700;margin:.5rem 0">${code}</div><p style="font-size:.85rem;color:#475569">${note}</p>`,
    icon: 'info',
    confirmButtonText: 'Done',
    allowOutsideClick: false,
  });
}

function BorrowPageInner() {
  const searchParams = useSearchParams();
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>(searchParams.get('status') ?? '');
  const [isPending, startTransition] = useTransition();

  // Modals
  const [recommendLog, setRecommendLog] = useState<LogItem | null>(null);
  const [reservableUnits, setReservableUnits] = useState<{ id: string; serialNumber: string }[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [issueLog, setIssueLog] = useState<LogItem | null>(null);
  const [returnLog, setReturnLog] = useState<LogItem | null>(null);

  const isStaff = role === 'COORDINATOR' || role === 'TECHNICAL_OFFICER' || role === 'SUPER_ADMIN';

  function applyLogs(res: Awaited<ReturnType<typeof getBorrowLogs>>) {
    if (res.success) {
      setLogs(res.logs);
    } else {
      Swal.fire('Error', res.error, 'error');
    }
    setLoading(false);
  }

  async function loadLogs() {
    setLoading(true);
    applyLogs(await getBorrowLogs());
  }

  useEffect(() => {
    getCurrentUserRole().then((r) => {
      setRole(r.role);
      setFilterStatus((current) => current || (r.role === 'BORROWER' || r.role === 'SUPER_ADMIN' ? 'ALL' : 'ACTION'));
    });
    getBorrowLogs().then(applyLogs);
  }, []);

  function run(action: () => Promise<{ success: boolean; error?: string }>, success?: string) {
    startTransition(async () => {
      const res = await action();
      if (res.success) {
        if (success) Swal.fire('Done', success, 'success');
      } else {
        Swal.fire('Error', res.error || 'Something went wrong.', 'error');
      }
      loadLogs();
    });
  }

  function handleCheckOverdue() {
    startTransition(async () => {
      const res = await checkAndUpdateOverdueLogs();
      if (res.success) {
        Swal.fire(
          'Checked',
          `Overdue flagged: ${res.updatedCount}. Reservations expired: ${res.expiredCount}.`,
          'success'
        );
        loadLogs();
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  // ---- Borrower ----
  async function handleCancel(log: LogItem) {
    const result = await Swal.fire({
      title: 'Cancel this request?',
      text: log.status === 'APPROVED' ? 'The reserved unit will be released.' : undefined,
      input: 'text',
      inputPlaceholder: 'Reason (optional)',
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: 'Cancel request',
      cancelButtonText: 'Keep it',
    });
    if (!result.isConfirmed) return;
    run(() => cancelBorrowRequest(log.id, result.value || undefined), 'Request cancelled.');
  }

  async function handleAcknowledge(log: LogItem) {
    const result = await Swal.fire({
      title: 'Acknowledge return',
      text: `Enter the return code shown by the Technical Officer for "${log.equipment.name}".`,
      input: 'text',
      inputAttributes: { maxlength: '6', inputmode: 'numeric', autocomplete: 'one-time-code' },
      showCancelButton: true,
      confirmButtonText: 'Confirm',
    });
    if (!result.isConfirmed) return;
    run(() => acknowledgeReturn(log.id, String(result.value ?? '')), 'Return acknowledged. The Technical Officer will now complete it.');
  }

  // ---- Coordinator ----
  async function openRecommend(log: LogItem) {
    setRecommendLog(log);
    setSelectedUnitId('');
    setReservableUnits([]);
    const res = await getReservableUnits(log.id);
    if (res.success) setReservableUnits(res.data ?? []);
    else Swal.fire('Error', res.error, 'error');
  }

  function confirmRecommend() {
    if (!recommendLog || !selectedUnitId) return;
    const log = recommendLog;
    startTransition(async () => {
      const res = await recommendBorrowRequest(log.id, selectedUnitId);
      if (res.success && res.data) {
        setRecommendLog(null);
        await showCode(
          'Handover code',
          res.data.code,
          `Unit <b>${res.data.serialNumber}</b> is reserved for ${log.user.name} until ${fmtDateTime(res.data.reservationExpiresAt)}.<br/>Give this code to the borrower <b>in person</b>. It will not be shown again; use "New handover code" if it is lost.`
        );
      } else if (!res.success) {
        Swal.fire('Error', res.error, 'error');
      }
      loadLogs();
    });
  }

  async function handleReject(log: LogItem) {
    const result = await Swal.fire({
      title: 'Reject request',
      text: `${log.user.name} — ${log.equipment.name}`,
      input: 'textarea',
      inputPlaceholder: 'Reason for rejection (required)',
      inputValidator: (v) => (!v?.trim() ? 'A reason is required.' : undefined),
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: 'Reject',
    });
    if (!result.isConfirmed) return;
    run(() => rejectBorrowRequest(log.id, result.value), 'Request rejected.');
  }

  async function handleRegenerate(log: LogItem) {
    const confirm = await Swal.fire({
      title: 'Generate a new handover code?',
      text: 'The previous code stops working. This action is recorded in the audit log.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Generate',
    });
    if (!confirm.isConfirmed) return;
    startTransition(async () => {
      const res = await regenerateHandoverCode(log.id);
      if (res.success && res.data) {
        await showCode('New handover code', res.data.code, `Give this code to ${log.user.name} in person. Valid until ${fmtDateTime(res.data.expiresAt)}.`);
      } else if (!res.success) {
        Swal.fire('Error', res.error, 'error');
      }
      loadLogs();
    });
  }

  async function handleOverrideAck(log: LogItem) {
    const result = await Swal.fire({
      title: 'Record acknowledgement for the borrower',
      text: 'Use only when the borrower cannot enter the return code. A reason is required and recorded.',
      input: 'textarea',
      inputPlaceholder: 'Reason (required)',
      inputValidator: (v) => (!v?.trim() ? 'A reason is required.' : undefined),
      showCancelButton: true,
      confirmButtonText: 'Record',
    });
    if (!result.isConfirmed) return;
    run(() => overrideReturnAcknowledgement(log.id, result.value), 'Recorded. The Technical Officer can now complete the return.');
  }

  // ---- Technical Officer ----
  function submitIssue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!issueLog) return;
    const form = new FormData(e.currentTarget);
    const log = issueLog;
    startTransition(async () => {
      const res = await issueBorrowRequest(log.id, String(form.get('code') ?? ''), String(form.get('notes') ?? ''));
      if (res.success) {
        setIssueLog(null);
        Swal.fire('Issued', `${log.unit?.serialNumber ?? log.equipment.name} has been issued to ${log.user.name}.`, 'success');
      } else {
        Swal.fire('Error', res.error, 'error');
      }
      loadLogs();
    });
  }

  function submitStartReturn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!returnLog) return;
    const form = new FormData(e.currentTarget);
    const log = returnLog;
    startTransition(async () => {
      const res = await startReturn(log.id, form.get('condition') as ItemCondition, String(form.get('notes') ?? ''));
      if (res.success && res.data) {
        setReturnLog(null);
        await showCode(
          'Return code',
          res.data.code,
          `Show this code to ${log.user.name}. They must enter it under "My Requests" in their own session (valid until ${fmtDateTime(res.data.expiresAt)}). Then click "Complete return".`
        );
      } else if (!res.success) {
        Swal.fire('Error', res.error, 'error');
      }
      loadLogs();
    });
  }

  async function handleFinalize(log: LogItem) {
    const confirm = await Swal.fire({
      title: 'Complete the return?',
      html: `Unit <b>${log.unit?.serialNumber ?? ''}</b> will be recorded as returned in condition <b>${log.returnCondition}</b>.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Complete return',
    });
    if (!confirm.isConfirmed) return;
    run(() => finalizeReturn(log.id), 'Return completed.');
  }

  const filteredLogs = logs.filter((log) => {
    if (filterStatus === 'ALL' || !filterStatus) return true;
    if (filterStatus === 'ACTION') return needsAction(log);
    return log.status === (filterStatus as RequestStatus);
  });

  const btn = 'px-2.5 py-1 text-white text-xs font-medium rounded transition disabled:opacity-50 whitespace-nowrap';

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {role === 'BORROWER' ? 'My Requests & Loans' : 'Borrow & Reservation Requests'}
          </h1>
          <p className="text-sm text-slate-600">
            {role === 'BORROWER'
              ? 'Track your requests, cancel before collection, and acknowledge returns'
              : 'Review requests, record handovers and returns for your assigned laboratories'}
          </p>
        </div>
        <div className="flex gap-2">
          {isStaff && (
            <button
              onClick={handleCheckOverdue}
              disabled={isPending}
              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-medium rounded-lg transition disabled:opacity-50"
            >
              ⏰ Check Overdue / Expiry
            </button>
          )}
          <button
            onClick={loadLogs}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition"
          >
            🔄 Refresh List
          </button>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-2 border-b border-slate-200 mb-6 overflow-x-auto">
        {TABS.filter((t) => t.key !== 'ACTION' || role !== 'SUPER_ADMIN').map((tab) => {
          const count = tab.key === 'ACTION' ? logs.filter(needsAction).length : null;
          return (
            <button
              key={tab.key}
              onClick={() => setFilterStatus(tab.key)}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px whitespace-nowrap ${
                filterStatus === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
              {count ? <span className="ml-1 px-1.5 rounded-full bg-rose-600 text-white text-[10px]">{count}</span> : null}
            </button>
          );
        })}
      </div>

      {/* Borrow Logs Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading borrow requests...</div>
      ) : filteredLogs.length === 0 ? (
        <div className="bg-white border border-dashed rounded-xl p-12 text-center text-slate-500 text-sm">
          No borrow requests match the selected filter.
        </div>
      ) : (
        <div className="bg-white border rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-600 uppercase text-[11px] font-semibold tracking-wider">
              <tr>
                <th className="py-3 px-4">Borrower</th>
                <th className="py-3 px-4">Equipment & Lab</th>
                <th className="py-3 px-4">Requested Dates</th>
                <th className="py-3 px-4">Purpose / Notes</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Handled By</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y text-slate-800">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50 align-top">
                  <td className="py-3 px-4 font-medium text-slate-900">
                    {log.user.name}
                    {log.flags.isOwn && <span className="ml-1 text-[10px] text-blue-600 font-semibold">(you)</span>}
                    <span className="block text-xs font-mono text-slate-400">{log.user.email}</span>
                  </td>

                  <td className="py-3 px-4">
                    <span className="font-semibold text-slate-800">{log.equipment.name}</span>
                    <span className="block text-xs text-slate-500">{log.equipment.lab.name}</span>
                    {log.unit && (
                      <span className="block text-[10px] font-mono text-indigo-600 mt-0.5">SN: {log.unit.serialNumber}</span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                    <div><span className="font-medium text-slate-700">From:</span> {fmtDate(log.borrowDate)}</div>
                    <div><span className="font-medium text-slate-700">To:</span> {fmtDate(log.returnDate)}</div>
                    {log.actualReturn && (
                      <div className="text-emerald-600 text-[11px] font-medium mt-0.5">Returned: {fmtDate(log.actualReturn)}</div>
                    )}
                    {log.status === 'APPROVED' && log.reservationExpiresAt && (
                      <div className="text-blue-600 text-[11px] font-medium mt-0.5">Collect by: {fmtDateTime(log.reservationExpiresAt)}</div>
                    )}
                  </td>

                  <td className="py-3 px-4 text-xs text-slate-600 max-w-xs">
                    <span className="line-clamp-3">
                      {log.notes || <span className="text-slate-400 italic">No notes provided</span>}
                    </span>
                  </td>

                  <td className="py-3 px-4 space-y-1">
                    <RequestStatusBadge status={log.status} />
                    {log.flags.awaitingReviewTooLong && (
                      <div className="text-[10px] font-semibold text-amber-700">⚠ Awaiting review &gt; 3 days</div>
                    )}
                    {log.flags.returnStarted && (
                      <div className="text-[10px] font-semibold text-indigo-700">
                        Return in progress{log.flags.returnAcked ? ' — acknowledged' : ' — awaiting borrower code'}
                      </div>
                    )}
                  </td>

                  {/* Audit Trail */}
                  <td className="py-3 px-4 text-[11px] text-slate-500 space-y-0.5 min-w-48">
                    {log.approvedBy && (
                      <div>
                        Recommended by <span className="font-medium text-slate-700">{log.approvedBy.name}</span>
                        {log.flags.selfRecommended && <span className="ml-1 text-amber-700 font-semibold">(own request)</span>}
                      </div>
                    )}
                    {log.rejectedBy && (
                      <div>
                        Rejected by <span className="font-medium text-slate-700">{log.rejectedBy.name}</span>
                        {log.rejectionReason && <span className="block italic">“{log.rejectionReason}”</span>}
                      </div>
                    )}
                    {log.cancelledBy && (
                      <div>
                        Cancelled by <span className="font-medium text-slate-700">{log.cancelledBy.name}</span>
                        {log.cancelReason && <span className="block italic">“{log.cancelReason}”</span>}
                      </div>
                    )}
                    {log.status === 'EXPIRED' && <div>Reservation expired {fmtDate(log.expiredAt)}</div>}
                    {log.issuedBy && <div>Issued by <span className="font-medium text-slate-700">{log.issuedBy.name}</span></div>}
                    {log.returnInitiatedBy && (
                      <div>
                        Inspected by <span className="font-medium text-slate-700">{log.returnInitiatedBy.name}</span>: {log.returnCondition}
                        {log.returnNotes && <span className="block italic">“{log.returnNotes}”</span>}
                      </div>
                    )}
                    {log.returnAckOverrideBy && (
                      <div className="text-amber-700">
                        Acknowledged on borrower&apos;s behalf by {log.returnAckOverrideBy.name}
                        {log.returnAckOverrideReason && <span className="block italic">“{log.returnAckOverrideReason}”</span>}
                      </div>
                    )}
                    {log.returnedBy && <div>Returned to <span className="font-medium text-slate-700">{log.returnedBy.name}</span></div>}
                    {!log.approvedBy && !log.rejectedBy && !log.cancelledBy && !log.issuedBy && log.status === 'PENDING' && (
                      <span className="text-slate-400 italic">Awaiting Coordinator</span>
                    )}
                  </td>

                  {/* Workflow Action Buttons */}
                  <td className="py-3 px-4 text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {log.can.recommend && (
                        <button onClick={() => openRecommend(log)} disabled={isPending} className={`${btn} bg-blue-600 hover:bg-blue-700`}>
                          Recommend
                        </button>
                      )}
                      {log.can.reject && (
                        <button onClick={() => handleReject(log)} disabled={isPending} className={`${btn} bg-rose-600 hover:bg-rose-700`}>
                          Reject
                        </button>
                      )}
                      {log.can.regenerateHandoverCode && (
                        <button onClick={() => handleRegenerate(log)} disabled={isPending} className={`${btn} bg-slate-600 hover:bg-slate-700`}>
                          New handover code
                        </button>
                      )}
                      {log.can.issue && (
                        <button onClick={() => setIssueLog(log)} disabled={isPending} className={`${btn} bg-indigo-600 hover:bg-indigo-700`}>
                          Issue Item
                        </button>
                      )}
                      {log.can.startReturn && (
                        <button onClick={() => setReturnLog(log)} disabled={isPending} className={`${btn} bg-emerald-600 hover:bg-emerald-700`}>
                          {log.flags.returnStarted ? 'Restart return' : 'Receive return'}
                        </button>
                      )}
                      {log.can.finalizeReturn && (
                        <button onClick={() => handleFinalize(log)} disabled={isPending} className={`${btn} bg-emerald-700 hover:bg-emerald-800`}>
                          Complete return
                        </button>
                      )}
                      {log.can.overrideReturnAck && (
                        <button onClick={() => handleOverrideAck(log)} disabled={isPending} className={`${btn} bg-amber-600 hover:bg-amber-700`}>
                          Borrower can&apos;t enter code
                        </button>
                      )}
                      {log.can.acknowledgeReturn && (
                        <button onClick={() => handleAcknowledge(log)} disabled={isPending} className={`${btn} bg-emerald-600 hover:bg-emerald-700`}>
                          Enter return code
                        </button>
                      )}
                      {log.can.cancel && (
                        <button
                          onClick={() => handleCancel(log)}
                          disabled={isPending}
                          className="px-2.5 py-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-xs font-medium rounded transition disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                      {log.flags.isOwn && log.status === 'APPROVED' && (
                        <span className="text-[11px] text-slate-500 text-left basis-full">
                          Collect your handover code from the Coordinator, then present it to the Technical Officer.
                        </span>
                      )}
                      {!needsAction(log) && ['RETURNED', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(log.status) && (
                        <span className="text-xs text-slate-400 font-medium">Completed</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Coordinator recommends + reserves a specific unit */}
      {recommendLog && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Recommend & reserve a unit</h2>
              <p className="text-xs text-slate-500 mt-1">
                {recommendLog.user.name} — {recommendLog.equipment.name}. The selected unit will be reserved immediately
                and cannot be allocated to anyone else.
              </p>
              {recommendLog.flags.isOwn && (
                <p className="text-xs text-amber-700 mt-2 font-medium">
                  This is your own request. It will be recorded as self-recommended.
                </p>
              )}
            </div>
            {reservableUnits.length === 0 ? (
              <p className="text-sm text-rose-600">No available units for this equipment right now.</p>
            ) : (
              <select
                value={selectedUnitId}
                onChange={(e) => setSelectedUnitId(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Choose Serial Number --</option>
                {reservableUnits.map((u) => (
                  <option key={u.id} value={u.id}>{u.serialNumber}</option>
                ))}
              </select>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setRecommendLog(null)} className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={confirmRecommend}
                disabled={!selectedUnitId || isPending}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {isPending ? 'Reserving...' : 'Recommend & Reserve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: TO records physical handover */}
      {issueLog && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={submitIssue} className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Record handover</h2>
              <p className="text-xs text-slate-500 mt-1">
                Hand over unit <span className="font-mono font-semibold text-indigo-700">{issueLog.unit?.serialNumber}</span>{' '}
                ({issueLog.equipment.name}) to <b>{issueLog.user.name}</b>. Check the physical item and its serial number first.
                {issueLog.unit?.location && <span className="block mt-1">Stored at: <b>{issueLog.unit.location}</b></span>}
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Borrower&apos;s handover code *</label>
              <input
                name="code"
                required
                maxLength={6}
                inputMode="numeric"
                autoComplete="off"
                placeholder="123456"
                className="w-full px-3 py-2 text-center text-xl tracking-widest border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Condition / accessories notes</label>
              <textarea
                name="notes"
                rows={2}
                placeholder="e.g. Issued with charger and case; minor scratch on lid"
                className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setIssueLog(null)} className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {isPending ? 'Issuing...' : 'Confirm Issue'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: TO inspects returned item */}
      {returnLog && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={submitStartReturn} className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Receive return — inspection</h2>
              <p className="text-xs text-slate-500 mt-1">
                Unit <span className="font-mono font-semibold text-indigo-700">{returnLog.unit?.serialNumber}</span> from{' '}
                <b>{returnLog.user.name}</b>. The unit stays Issued until you complete the return.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Condition on return *</label>
              <select name="condition" defaultValue="WORKING" className="w-full px-3 py-2 border rounded-lg text-sm bg-white outline-none">
                <option value="WORKING">WORKING — fit for use</option>
                <option value="DAMAGED">DAMAGED</option>
                <option value="UNDER_REPAIR">UNDER_REPAIR</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Inspection notes (required if not working)</label>
              <textarea
                name="notes"
                rows={3}
                placeholder="e.g. Missing power adapter; cracked screen"
                className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setReturnLog(null)} className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {isPending ? 'Saving...' : 'Save & show return code'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function BorrowPage() {
  return (
    <Suspense>
      <BorrowPageInner />
    </Suspense>
  );
}
