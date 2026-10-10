'use client';

import { checkAndUpdateOverdueLogs } from '@/actions/cron';
import { useEffect, useState, useTransition } from 'react';
import { getBorrowLogs, updateBorrowStatus } from '@/actions/borrow';
import { RequestStatus } from '@prisma/client';
import Swal from 'sweetalert2';
import { getAvailableUnitsForIssue } from '@/actions/equipment';


interface LogItem {
  id: string;
  borrowDate: string;
  returnDate: string;
  actualReturn?: string | null;
  status: RequestStatus;
  notes?: string | null;
  user: { name: string; email: string };
  equipment: { id: string; name: string; brand?: string | null; lab: { name: string } };
  unit?: { serialNumber: string } | null;
  approvedBy?: { name: string } | null;
  issuedBy?: { name: string } | null;
  returnedBy?: { name: string } | null;
}

export default function BorrowPage() {
const [issueLogId, setIssueLogId] = useState<string | null>(null);
const [availableUnits, setAvailableUnits] = useState<{ id: string; serialNumber: string }[]>([]);
const [selectedUnitId, setSelectedUnitId] = useState('');

async function openIssueModal(log: LogItem) {
  setIssueLogId(log.id);
  setSelectedUnitId('');
  const res = await getAvailableUnitsForIssue(log.equipment.id);
  if (res.success && res.data) {
    setAvailableUnits(res.data);
  } else {
    Swal.fire('Error', res.error || 'Failed to load available units.', 'error');
  }
}

function confirmIssue() {
  if (!issueLogId || !selectedUnitId) return;
  startTransition(async () => {
    const res = await updateBorrowStatus(issueLogId, 'ISSUED', selectedUnitId);
    if (res.success) {
      setIssueLogId(null);
      loadLogs();
    } else {
      Swal.fire('Error', res.error || 'Failed to issue item.', 'error');
    }
  });
}



  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [isPending, startTransition] = useTransition();

  async function loadLogs() {
    setLoading(true);
    const res = await getBorrowLogs();
    if (res.success && res.logs) {
      setLogs(res.logs as any);
    } else {
      Swal.fire('Error', res.error || 'Failed to fetch logs.', 'error');
    }
    setLoading(false);
  }

  function handleCheckOverdue() {
  startTransition(async () => {
    const res = await checkAndUpdateOverdueLogs();
    if (res.success) {
      Swal.fire('Success', res.updatedCount > 0 
        ? `Flagged ${res.updatedCount} item(s) as OVERDUE!` : 'No overdue items found.', 'success'
      );
      loadLogs();
    } else {
      Swal.fire('Error', res.error || 'Failed to check overdue items.', 'error');
    }
  });
}

  useEffect(() => {
    loadLogs();
  }, []);

  function handleStatusChange(id: string, newStatus: RequestStatus) {
    startTransition(async () => {
      const res = await updateBorrowStatus(id, newStatus);
      if (res.success) {
        loadLogs();
      } else {
        Swal.fire('Error', res.error || 'Failed to update request status.', 'error');
      }
    });
  }

  // Filter logs by selected status tab
  const filteredLogs = logs.filter((log) => {
    if (filterStatus === 'ALL') return true;
    return log.status === filterStatus;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Borrow & Reservation Requests</h1>
          <p className="text-sm text-slate-600">Review pending requests, issue equipment, and manage returns</p>
        </div>

        <button
    onClick={handleCheckOverdue}
    disabled={isPending}
    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-medium rounded-lg transition disabled:opacity-50"
  >
    ⏰ Check Overdue
  </button>
        <button
          onClick={loadLogs}
          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition"
        >
          🔄 Refresh List
        </button>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-2 border-b border-slate-200 mb-6 overflow-x-auto">
        {['ALL', 'PENDING', 'APPROVED', 'ISSUED', 'RETURNED', 'REJECTED', 'OVERDUE'].map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px whitespace-nowrap ${
              filterStatus === status
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Borrow Logs Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading borrow requests...</div>
      ) : filteredLogs.length === 0 ? (
        <div className="bg-white border border-dashed rounded-xl p-12 text-center text-slate-500 text-sm">
          No borrow requests match the selected filter.
        </div>
      ) : (
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-600 uppercase text-[11px] font-semibold tracking-wider">
              <tr>
                <th className="py-3 px-4">Borrower</th>
                <th className="py-3 px-4">Equipment & Lab</th>
                <th className="py-3 px-4">Requested Dates</th>
                <th className="py-3 px-4">Purpose / Notes</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Handled By</th>
                <th className="py-3 px-4 text-right">Staff Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y text-slate-800">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50">
                  {/* Borrower Details */}
                  <td className="py-3 px-4 font-medium text-slate-900">
                    {log.user.name}
                    <span className="block text-xs font-mono text-slate-400">{log.user.email}</span>
                  </td>

                  {/* Equipment Details */}
                  <td className="py-3 px-4">
                    <span className="font-semibold text-slate-800">{log.equipment.name}</span>
                    <span className="block text-xs text-slate-500">{log.equipment.lab.name}</span>
                    {log.unit && (
    <span className="block text-[10px] font-mono text-indigo-600 mt-0.5">SN: {log.unit.serialNumber}</span>
  )}
                  </td>

                  {/* Date Range */}
                  <td className="py-3 px-4 text-xs text-slate-600">
                    <div><span className="font-medium text-slate-700">From:</span> {new Date(log.borrowDate).toLocaleDateString()}</div>
                    <div><span className="font-medium text-slate-700">To:</span> {new Date(log.returnDate).toLocaleDateString()}</div>
                    {log.actualReturn && (
                      <div className="text-emerald-600 text-[11px] font-medium mt-0.5">
                        Returned: {new Date(log.actualReturn).toLocaleDateString()}
                      </div>
                    )}
                  </td>

                  {/* Purpose/Notes */}
                  <td className="py-3 px-4 text-xs text-slate-600 max-w-xs truncate">
                    {log.notes || <span className="text-slate-400 italic">No notes provided</span>}
                  </td>

                  {/* Status Badge */}
                  <td className="py-3 px-4">
                    <span
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-full border ${
                        log.status === 'PENDING'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : log.status === 'APPROVED'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : log.status === 'ISSUED'
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : log.status === 'RETURNED'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : log.status === 'OVERDUE'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-slate-100 text-slate-600 border-slate-300'
                      }`}
                    >
                      {log.status}
                    </span>
                  </td>

                  {/* Audit Trail */}
                  <td className="py-3 px-4 text-[11px] text-slate-500 space-y-0.5">
                    {log.approvedBy && <div>Approved by <span className="font-medium text-slate-700">{log.approvedBy.name}</span></div>}
                    {log.issuedBy && <div>Issued by <span className="font-medium text-slate-700">{log.issuedBy.name}</span></div>}
                    {log.returnedBy && <div>Returned to <span className="font-medium text-slate-700">{log.returnedBy.name}</span></div>}
                    {!log.approvedBy && !log.issuedBy && !log.returnedBy && (
                      <span className="text-slate-400 italic">Pending action</span>
                    )}
                  </td>

                  {/* Workflow Action Buttons */}
                  <td className="py-3 px-4 text-right space-x-1.5">
                    {log.status === 'PENDING' && (
                      <>
                        <button
                          onClick={() => handleStatusChange(log.id, 'APPROVED')}
                          disabled={isPending}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleStatusChange(log.id, 'REJECTED')}
                          disabled={isPending}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium rounded transition disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    )}

                    {log.status === 'APPROVED' && (
                      <button
                        onClick={() => openIssueModal(log)}
                        disabled={isPending}
                        className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition disabled:opacity-50"
                      >
                        Issue Item
                      </button>
                    )}

                    {(log.status === 'ISSUED' || log.status === 'OVERDUE') && (
                      <button
                        onClick={() => handleStatusChange(log.id, 'RETURNED')}
                        disabled={isPending}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded transition disabled:opacity-50"
                      >
                        Mark Returned
                      </button>
                    )}

                    {(log.status === 'RETURNED' || log.status === 'REJECTED') && (
                      <span className="text-xs text-slate-400 font-medium">Completed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {issueLogId && (
  <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
    <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
      <h2 className="text-lg font-bold text-slate-900">Select Unit to Issue</h2>
      {availableUnits.length === 0 ? (
        <p className="text-sm text-rose-600">No available working units for this equipment.</p>
      ) : (
        <select
          value={selectedUnitId}
          onChange={(e) => setSelectedUnitId(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">-- Choose Serial Number --</option>
          {availableUnits.map((u) => (
            <option key={u.id} value={u.id}>{u.serialNumber}</option>
          ))}
        </select>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={() => setIssueLogId(null)} className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
        <button
          onClick={confirmIssue}
          disabled={!selectedUnitId || isPending}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
        >
          {isPending ? 'Issuing...' : 'Confirm Issue'}
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
}