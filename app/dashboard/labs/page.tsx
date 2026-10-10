'use client';

import { useState, useEffect, useTransition } from 'react';
import {
  getManageableLabs,
  getAvailableStaff,
  createLab,
  assignCoordinator,
  removeCoordinator,
  deleteLab,
} from '@/actions/lab';
import { getCurrentUserRole } from '@/actions/auth';
import Swal from 'sweetalert2';

interface StaffUser {
  id: string;
  name: string;
  email: string;
}

interface LabData {
  id: string;
  name: string;
  description?: string | null;
  coordinators: StaffUser[];
  _count: { equipment: number };
}

export default function ManageLabsPage() {
  const [labs, setLabs] = useState<LabData[]>([]);
  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedLabForAssign, setSelectedLabForAssign] = useState<LabData | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState('');

  const [isPending, startTransition] = useTransition();

  // Verify Super Admin access on initial mount
  useEffect(() => {
    async function checkAccess() {
      const authRes = await getCurrentUserRole();
      if (authRes.role !== 'SUPER_ADMIN') {
        setIsSuperAdmin(false);
        setLoading(false);
        return;
      }
      setIsSuperAdmin(true);
      loadData();
    }
    checkAccess();
  }, []);

  async function loadData() {
    setLoading(true);
    const [labsRes, staffRes] = await Promise.all([getManageableLabs(), getAvailableStaff()]);

    if (labsRes.success && labsRes.data) setLabs(labsRes.data as LabData[]);
    if (staffRes.success && staffRes.data) setStaffList(staffRes.data);
    setLoading(false);
  }

  // Create Lab Handler
  async function handleCreateLab(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;

    startTransition(async () => {
      const res = await createLab(name);
      if (res.success) {
        setShowCreateModal(false);
        Swal.fire('Created!', `Laboratory "${name}" added successfully.`, 'success');
        loadData();
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  // Assign Coordinator
  async function handleAssignCoordinator() {
    if (!selectedLabForAssign || !selectedStaffId) return;

    startTransition(async () => {
      const res = await assignCoordinator(selectedLabForAssign.id, selectedStaffId);
      if (res.success) {
        setSelectedLabForAssign(null);
        setSelectedStaffId('');
        Swal.fire('Assigned!', 'Coordinator updated.', 'success');
        loadData();
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  // Remove Coordinator
  async function handleRemoveCoordinator(labId: string, userId: string, staffName: string) {
    const confirm = await Swal.fire({
      title: 'Remove Coordinator?',
      text: `Remove ${staffName} from this laboratory?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Yes, Remove',
    });

    if (confirm.isConfirmed) {
      startTransition(async () => {
        const res = await removeCoordinator(labId, userId);
        if (res.success) {
          Swal.fire('Removed', 'Coordinator unassigned.', 'success');
          loadData();
        } else {
          Swal.fire('Error', res.error, 'error');
        }
      });
    }
  }

  // Delete Lab
  async function handleDeleteLab(lab: LabData) {
    if (lab._count.equipment > 0) {
      Swal.fire(
        'Action Blocked',
        `This laboratory holds ${lab._count.equipment} registered equipment items. Reassign or remove items before deleting the lab.`,
        'warning'
      );
      return;
    }

    const confirm = await Swal.fire({
      title: 'Delete Laboratory?',
      text: `Are you sure you want to delete "${lab.name}"? This action cannot be undone.`,
      icon: 'error',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      confirmButtonText: 'Delete Permanently',
    });

    if (confirm.isConfirmed) {
      startTransition(async () => {
        const res = await deleteLab(lab.id);
        if (res.success) {
          Swal.fire('Deleted!', 'Laboratory removed.', 'success');
          loadData();
        } else {
          Swal.fire('Error', res.error, 'error');
        }
      });
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-sans">Loading lab management portal...</div>;
  }

  if (isSuperAdmin === false) {
    return (
      <div className="p-8 max-w-md mx-auto text-center font-sans mt-12 bg-white rounded-xl border border-rose-200 shadow-sm">
        <h2 className="text-xl font-bold text-rose-600 mb-2">Access Denied</h2>
        <p className="text-slate-600 text-sm">
          Laboratory structure management is restricted strictly to System Super Administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Laboratory Infrastructure</h1>
          <p className="text-sm text-slate-600">Create labs, manage staff co-coordinators, and system assets</p>
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
            className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="flex justify-between items-start">
                <h2 className="font-bold text-lg text-slate-900">{lab.name}</h2>
                <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded-full font-semibold">
                  {lab._count.equipment} Items
                </span>
              </div>
              {lab.description && <p className="text-xs text-slate-500">{lab.description}</p>}
            </div>

            {/* Coordinators Section */}
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-500 uppercase">Assigned Coordinators</span>
                <button
                  onClick={() => setSelectedLabForAssign(lab)}
                  className="text-xs text-blue-600 font-medium hover:underline"
                >
                  + Assign
                </button>
              </div>

              {lab.coordinators.length === 0 ? (
                <p className="text-xs text-amber-600 italic">No staff assigned</p>
              ) : (
                <ul className="space-y-1">
                  {lab.coordinators.map((staff) => (
                    <li key={staff.id} className="flex justify-between items-center text-xs bg-slate-50 p-1.5 rounded border">
                      <span className="font-medium text-slate-700">{staff.name}</span>
                      <button
                        onClick={() => handleRemoveCoordinator(lab.id, staff.id, staff.name)}
                        className="text-rose-500 hover:text-rose-700 text-xs px-1"
                        title="Remove coordinator"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Actions */}
            <div className="border-t border-slate-100 pt-3 flex justify-end">
              <button
                onClick={() => handleDeleteLab(lab)}
                className="text-xs text-rose-600 hover:text-rose-800 font-medium"
              >
                Delete Laboratory
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal: Create Lab */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <h2 className="text-xl font-bold text-slate-900">Add New Laboratory</h2>
            <form onSubmit={handleCreateLab} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Lab Name *</label>
                <input
                  name="name"
                  required
                  placeholder="e.g. Telecommunications Laboratory"
                  className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Description</label>
                <textarea
                  name="description"
                  rows={3}
                  placeholder="e.g. Optical fibre, FSO, and wireless hardware testing equipment"
                  className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {isPending ? 'Saving...' : 'Create Lab'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Assign Coordinator */}
      {selectedLabForAssign && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-slate-900">
              Assign Staff: <span className="text-blue-600">{selectedLabForAssign.name}</span>
            </h2>
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-700 uppercase">Select Lab Staff</label>
              <select
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Choose Staff Member --</option>
                {staffList
                  .filter((s) => !selectedLabForAssign.coordinators.some((c) => c.id === s.id))
                  .map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name} ({staff.email})
                    </option>
                  ))}
              </select>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setSelectedLabForAssign(null)}
                  className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssignCoordinator}
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