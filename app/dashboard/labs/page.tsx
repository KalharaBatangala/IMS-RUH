'use client';

import { useEffect, useState, useTransition } from 'react';
import type { AssignmentRole } from '@prisma/client';
import Swal from 'sweetalert2';
import {
  assignStaff,
  createLab,
  deleteLab,
  getAvailableStaff,
  getManageableLabs,
  setLabArchived,
  unassignStaff,
  updateLab,
} from '@/actions/lab';

type LabData = Extract<Awaited<ReturnType<typeof getManageableLabs>>, { success: true }>['data'][number];
type StaffUser = Extract<Awaited<ReturnType<typeof getAvailableStaff>>, { success: true }>['data'][number];

const ROLE_LABEL: Record<AssignmentRole, string> = {
  COORDINATOR: 'Coordinator',
  TECHNICAL_OFFICER: 'Technical Officer',
};

export default function ManageLabsPage() {
  const [labs, setLabs] = useState<LabData[]>([]);
  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editLab, setEditLab] = useState<LabData | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ lab: LabData; role: AssignmentRole } | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState('');

  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [labsRes, staffRes] = await Promise.all([getManageableLabs(), getAvailableStaff()]);
    if (labsRes.success) setLabs(labsRes.data);
    else Swal.fire('Error', labsRes.error, 'error');
    if (staffRes.success) setStaffList(staffRes.data);
    setLoading(false);
  }

  function handleCreateLab(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    startTransition(async () => {
      const res = await createLab(name, formData.get('description') as string);
      if (res.success) {
        setShowCreateModal(false);
        Swal.fire('Created!', `Laboratory "${name}" added. Assign a Coordinator and a Technical Officer to open it for borrowing.`, 'success');
        loadData();
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  function handleEditLab(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editLab) return;
    const formData = new FormData(e.currentTarget);
    const lab = editLab;
    startTransition(async () => {
      const res = await updateLab(lab.id, formData.get('name') as string, formData.get('description') as string);
      if (res.success) {
        setEditLab(null);
        loadData();
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  function handleAssign() {
    if (!assignTarget || !selectedStaffId) return;
    const target = assignTarget;
    startTransition(async () => {
      const res = await assignStaff(target.lab.id, selectedStaffId, target.role);
      if (res.success) {
        setAssignTarget(null);
        setSelectedStaffId('');
        Swal.fire('Assigned!', `${ROLE_LABEL[target.role]} assigned to ${target.lab.name}.`, 'success');
        loadData();
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  async function handleUnassign(lab: LabData, assignmentId: string, name: string, role: AssignmentRole) {
    const remaining = (role === 'COORDINATOR' ? lab.coordinators : lab.technicalOfficers).length - 1;
    const confirm = await Swal.fire({
      title: `Remove ${ROLE_LABEL[role]}?`,
      html: `Remove <b>${name}</b> from ${lab.name}? Their account and other lab assignments are not affected, and the history is kept.${
        remaining === 0 ? `<br/><br/><b>Warning:</b> the lab will have no ${ROLE_LABEL[role]}, so borrowing will be paused.` : ''
      }`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Yes, Remove',
    });
    if (!confirm.isConfirmed) return;
    startTransition(async () => {
      const res = await unassignStaff(assignmentId);
      if (!res.success) Swal.fire('Error', res.error, 'error');
      loadData();
    });
  }

  async function handleArchive(lab: LabData) {
    const archiving = !lab.archived;
    const confirm = await Swal.fire({
      title: archiving ? 'Archive Laboratory?' : 'Restore Laboratory?',
      text: archiving
        ? `"${lab.name}" and its equipment will be hidden from borrowers. All history is kept and it can be restored.`
        : `"${lab.name}" will become visible again.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: archiving ? 'Archive' : 'Restore',
    });
    if (!confirm.isConfirmed) return;
    startTransition(async () => {
      const res = await setLabArchived(lab.id, archiving);
      if (!res.success) Swal.fire('Error', res.error, 'error');
      loadData();
    });
  }

  async function handleDelete(lab: LabData) {
    const confirm = await Swal.fire({
      title: 'Delete Laboratory?',
      text: `Delete "${lab.name}" permanently? Only possible for a lab that never had equipment or staff.`,
      icon: 'error',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      confirmButtonText: 'Delete Permanently',
    });
    if (!confirm.isConfirmed) return;
    startTransition(async () => {
      const res = await deleteLab(lab.id);
      if (res.success) Swal.fire('Deleted!', 'Laboratory removed.', 'success');
      else Swal.fire('Error', res.error, 'error');
      loadData();
    });
  }

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-sans">Loading lab management portal...</div>;
  }

  const candidates = assignTarget
    ? staffList.filter(
        (s) =>
          s.role === assignTarget.role &&
          ![...assignTarget.lab.coordinators, ...assignTarget.lab.technicalOfficers].some((a) => a.user.id === s.id)
      )
    : [];

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Laboratory Infrastructure</h1>
          <p className="text-sm text-slate-600">
            Create labs and assign Coordinators (review requests) and Technical Officers (issue &amp; return)
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition shadow-sm"
        >
          + Add New Laboratory
        </button>
      </div>

      {/* Labs List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {labs.map((lab) => (
          <div
            key={lab.id}
            className={`bg-white border rounded-xl p-5 shadow-sm flex flex-col justify-between space-y-4 ${
              lab.archived ? 'opacity-60 border-slate-200' : lab.staffingWarning ? 'border-amber-300' : 'border-slate-200'
            }`}
          >
            <div className="space-y-2">
              <div className="flex justify-between items-start gap-2">
                <h2 className="font-bold text-lg text-slate-900">
                  {lab.name}
                  {lab.archived && <span className="ml-2 text-[10px] font-bold text-slate-500">ARCHIVED</span>}
                </h2>
                <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded-full font-semibold whitespace-nowrap">
                  {lab._count.equipment} Items
                </span>
              </div>
              {lab.description && <p className="text-xs text-slate-500">{lab.description}</p>}
              {!lab.archived && lab.staffingWarning && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 font-medium">⚠ {lab.staffingWarning}</p>
              )}
            </div>

            {(['COORDINATOR', 'TECHNICAL_OFFICER'] as AssignmentRole[]).map((role) => {
              const list = role === 'COORDINATOR' ? lab.coordinators : lab.technicalOfficers;
              return (
                <div key={role} className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-500 uppercase">{ROLE_LABEL[role]}s</span>
                    {!lab.archived && (
                      <button
                        onClick={() => {
                          setAssignTarget({ lab, role });
                          setSelectedStaffId('');
                        }}
                        className="text-xs text-blue-600 font-medium hover:underline"
                      >
                        + Assign
                      </button>
                    )}
                  </div>
                  {list.length === 0 ? (
                    <p className="text-xs text-amber-600 italic">None assigned</p>
                  ) : (
                    <ul className="space-y-1">
                      {list.map((a) => (
                        <li key={a.id} className="flex justify-between items-center text-xs bg-slate-50 p-1.5 rounded border">
                          <span className="font-medium text-slate-700">
                            {a.user.name}
                            {!a.user.isActive && <span className="ml-1 text-rose-600">(deactivated)</span>}
                            <span className="block text-[10px] text-slate-400 font-normal">
                              since {new Date(a.assignedAt).toLocaleDateString()}
                            </span>
                          </span>
                          <button
                            onClick={() => handleUnassign(lab, a.id, a.user.name, role)}
                            className="text-rose-500 hover:text-rose-700 text-xs px-1"
                            title="Remove from this lab"
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            {lab.history.length > 0 && (
              <details className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                <summary className="cursor-pointer font-semibold uppercase text-[11px]">Assignment history</summary>
                <ul className="mt-2 space-y-1">
                  {lab.history.map((h) => (
                    <li key={h.id}>
                      {h.user.name} — {ROLE_LABEL[h.role]}, {new Date(h.assignedAt).toLocaleDateString()} to{' '}
                      {h.unassignedAt ? new Date(h.unassignedAt).toLocaleDateString() : ''}
                      {h.unassignedBy && <span className="text-slate-400"> (removed by {h.unassignedBy.name})</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* Actions */}
            <div className="border-t border-slate-100 pt-3 flex justify-end gap-3">
              <button onClick={() => setEditLab(lab)} className="text-xs text-blue-600 hover:underline font-medium">
                Edit
              </button>
              <button onClick={() => handleArchive(lab)} className="text-xs text-slate-600 hover:underline font-medium">
                {lab.archived ? 'Restore' : 'Archive'}
              </button>
              {lab._count.equipment === 0 && lab.coordinators.length + lab.technicalOfficers.length + lab.history.length === 0 && (
                <button onClick={() => handleDelete(lab)} className="text-xs text-rose-600 hover:text-rose-800 font-medium">
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal: Create / Edit Lab */}
      {(showCreateModal || editLab) && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <h2 className="text-xl font-bold text-slate-900">{editLab ? 'Edit Laboratory' : 'Add New Laboratory'}</h2>
            <form onSubmit={editLab ? handleEditLab : handleCreateLab} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Lab Name *</label>
                <input
                  name="name"
                  required
                  defaultValue={editLab?.name}
                  placeholder="e.g. Telecommunications Laboratory"
                  className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Description</label>
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={editLab?.description ?? ''}
                  placeholder="e.g. Optical fibre, FSO, and wireless hardware testing equipment"
                  className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditLab(null);
                  }}
                  className="px-4 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {isPending ? 'Saving...' : editLab ? 'Save Changes' : 'Create Lab'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Assign staff */}
      {assignTarget && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-slate-900">
              Assign {ROLE_LABEL[assignTarget.role]}: <span className="text-blue-600">{assignTarget.lab.name}</span>
            </h2>
            <div className="space-y-3">
              {candidates.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No unassigned users have the {ROLE_LABEL[assignTarget.role]} role. Set a user&apos;s role on the Users page first.
                </p>
              ) : (
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Choose Staff Member --</option>
                  {candidates.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name} ({staff.email})
                    </option>
                  ))}
                </select>
              )}

              <div className="flex justify-end gap-2 pt-3">
                <button type="button" onClick={() => setAssignTarget(null)} className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={handleAssign}
                  disabled={!selectedStaffId || isPending}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {isPending ? 'Assigning...' : 'Confirm Assignment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
