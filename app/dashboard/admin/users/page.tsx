'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { getPendingUsers, approveUser } from '@/actions/auth';
import { approveVerifiedStudents, deleteRoster, getRosters, uploadRoster, verifyPendingStudents } from '@/actions/roster';
import { parseCsv } from '@/lib/csv';
import { mapRosterSheet, ROSTER_TEMPLATE_HEADER } from '@/lib/student-roster';
import { downloadCsv } from '@/components/inventory/ImportModal';
import Swal from 'sweetalert2';

interface PendingUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  indexNumber: string | null;
  rosterVerifiedAt: Date | null;
}

type Roster = Extract<Awaited<ReturnType<typeof getRosters>>, { success: true }>['data'][number];

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export default function PendingUsersPage() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function applyPending(res: Awaited<ReturnType<typeof getPendingUsers>>) {
    if (res.success) setUsers(res.users);
    else Swal.fire('Error', res.error, 'error');
    setLoading(false);
  }

  function applyRosters(res: Awaited<ReturnType<typeof getRosters>>) {
    if (res.success) setRosters(res.data);
    else Swal.fire('Error', res.error, 'error');
  }

  async function fetchPending() {
    setLoading(true);
    applyPending(await getPendingUsers());
  }

  async function reloadAll() {
    const [p, r] = await Promise.all([getPendingUsers(), getRosters()]);
    applyPending(p);
    applyRosters(r);
  }

  useEffect(() => {
    getPendingUsers().then(applyPending);
    getRosters().then(applyRosters);
  }, []);

  async function handleApprove(userId: string) {
    setApprovingId(userId);
    const res = await approveUser(userId);
    if (res.success) {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } else {
      Swal.fire('Error', res.error, 'error');
    }
    setApprovingId(null);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      Swal.fire('CSV needed', 'In Excel or Google Sheets use File → Download / Save As → "CSV (comma separated)", then choose that file.', 'info');
      return;
    }
    const mapped = mapRosterSheet(parseCsv(await file.text()));
    if (mapped.error) {
      Swal.fire('Could not read the sheet', mapped.error, 'error');
      return;
    }
    const confirm = await Swal.fire({
      title: 'Upload student list?',
      html: `<b>${escapeHtml(file.name)}</b><br/>${mapped.rows.length} student row(s) found.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Upload',
    });
    if (!confirm.isConfirmed) return;
    startTransition(async () => {
      const res = await uploadRoster({ fileName: file.name, rows: mapped.rows });
      if (res.success) {
        const { imported, skipped } = res.data;
        await Swal.fire({
          title: 'Student list uploaded',
          html:
            `${imported} student(s) saved.` +
            (skipped.length
              ? `<div style="text-align:left;font-size:.8rem;margin-top:.75rem;color:#9f1239">${skipped.length} row(s) skipped:<br/>${skipped
                  .slice(0, 10)
                  .map(escapeHtml)
                  .join('<br/>')}${skipped.length > 10 ? '<br/>…' : ''}</div>`
              : ''),
          icon: skipped.length ? 'warning' : 'success',
        });
      } else {
        Swal.fire('Error', res.error, 'error');
      }
      reloadAll();
    });
  }

  async function handleDeleteRoster(roster: Roster) {
    const confirm = await Swal.fire({
      title: 'Delete student list?',
      html: `<b>${escapeHtml(roster.fileName)}</b> (${roster.rowCount} students) will be removed. Accounts already verified keep their verified mark and index number.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      confirmButtonColor: '#e11d48',
    });
    if (!confirm.isConfirmed) return;
    startTransition(async () => {
      const res = await deleteRoster(roster.id);
      if (!res.success) Swal.fire('Error', res.error, 'error');
      reloadAll();
    });
  }

  function handleVerify() {
    startTransition(async () => {
      const res = await verifyPendingStudents();
      if (res.success) {
        const { checked, verified } = res.data;
        Swal.fire(
          'Verification complete',
          checked === 0
            ? 'There are no unverified pending borrower accounts to check.'
            : `${checked} pending account(s) checked; ${verified} matched a student list. Unmatched accounts (e.g. staff) can still be approved manually.`,
          'success'
        );
      } else {
        Swal.fire('Error', res.error, 'error');
      }
      fetchPending();
    });
  }

  async function handleApproveVerified(count: number) {
    const confirm = await Swal.fire({
      title: `Approve ${count} verified account(s)?`,
      text: 'Every pending account marked "Verified" will be able to sign in. Check the list first; unverified accounts are not affected.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Approve all verified',
      confirmButtonColor: '#059669',
    });
    if (!confirm.isConfirmed) return;
    startTransition(async () => {
      const res = await approveVerifiedStudents();
      if (res.success) Swal.fire('Approved', `${res.data.approved} account(s) approved.`, 'success');
      else Swal.fire('Error', res.error, 'error');
      fetchPending();
    });
  }

  const verifiedCount = users.filter((u) => u.rosterVerifiedAt && u.isActive && u.role === 'BORROWER').length;

  return (
    <div className="p-6 max-w-5xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pending User Approvals</h1>
          <p className="text-sm text-slate-600">
            Approve users registered on the local network. New accounts start as Borrowers; change roles on the Users page.
          </p>
        </div>
        <button
          onClick={fetchPending}
          className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 border text-slate-700 rounded-md transition"
        >
          Refresh List
        </button>
      </div>

      <div className="bg-white border rounded-xl shadow-sm p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Student lists</h2>
            <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
              Upload a CSV of enrolled students (Index Number, Name, Email). Pending borrower accounts whose email is on any
              uploaded list can then be marked verified and approved together. Staff are approved manually.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => downloadCsv('student-list-template.csv', [ROSTER_TEMPLATE_HEADER, ['EG/2021/4312', 'A.B.C. Perera', 'eg2021_4312@eie.ruh.ac.lk']])}
              className="px-3 py-1.5 text-xs font-semibold border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 transition"
            >
              Template
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={isPending}
              className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md transition disabled:opacity-50"
            >
              Upload CSV
            </button>
            <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
          </div>
        </div>

        {rosters.length === 0 ? (
          <div className="mt-3 text-xs text-slate-400">No student lists uploaded.</div>
        ) : (
          <table className="w-full text-left text-xs mt-3">
            <thead className="text-slate-500 uppercase text-[10px] tracking-wider font-semibold border-b">
              <tr>
                <th className="py-1.5 pr-3">File</th>
                <th className="py-1.5 pr-3">Students</th>
                <th className="py-1.5 pr-3">Uploaded</th>
                <th className="py-1.5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y text-slate-700">
              {rosters.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 font-medium">{r.fileName}</td>
                  <td className="py-1.5 pr-3">{r.rowCount}</td>
                  <td className="py-1.5 pr-3 text-slate-500">
                    {new Date(r.createdAt).toLocaleDateString()}
                    {r.uploadedBy && ` · ${r.uploadedBy.name}`}
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => handleDeleteRoster(r)}
                      disabled={isPending}
                      className="px-2 py-0.5 text-[11px] font-medium rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2 mb-3">
        <button
          onClick={handleVerify}
          disabled={isPending || rosters.length === 0 || users.length === 0}
          title={rosters.length === 0 ? 'Upload a student list first' : undefined}
          className="px-3 py-1.5 text-xs font-semibold border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition disabled:opacity-50"
        >
          {isPending ? 'Working...' : 'Verify against student lists'}
        </button>
        <button
          onClick={() => handleApproveVerified(verifiedCount)}
          disabled={isPending || verifiedCount === 0}
          className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md transition disabled:opacity-50"
        >
          Approve all verified ({verifiedCount})
        </button>
      </div>

      {loading ? (
        <div className="text-slate-500 py-12 text-center text-sm">Loading pending accounts...</div>
      ) : users.length === 0 ? (
        <div className="bg-slate-50 border border-dashed rounded-xl p-8 text-center text-slate-500 text-sm">
          No pending user registrations right now.
        </div>
      ) : (
        <div className="bg-white border rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-600 uppercase text-[11px] tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">University Email</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Student List</th>
                <th className="py-3 px-4">Registered Date</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y text-slate-800">
              {users.map((u) => (
                <tr key={u.id} className={`hover:bg-slate-50/50 ${!u.isActive ? 'opacity-60' : ''}`}>
                  <td className="py-3 px-4 font-medium">{u.name}</td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">{u.email}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {u.rosterVerifiedAt ? (
                      <>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          ✓ VERIFIED
                        </span>
                        <span className="block text-[11px] font-mono text-slate-500 mt-0.5">{u.indexNumber}</span>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleApprove(u.id)}
                      disabled={approvingId === u.id}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-md transition disabled:opacity-50"
                    >
                      {approvingId === u.id ? 'Approving...' : 'Approve User'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
