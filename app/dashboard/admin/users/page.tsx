'use client';

import { useEffect, useState } from 'react';
import { getPendingUsers, approveUser } from '@/actions/auth';
import Swal from 'sweetalert2';

interface PendingUser {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
}

export default function PendingUsersPage() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  async function fetchPending() {
    setLoading(true);
    const res = await getPendingUsers();
    if (res.success && res.users) {
      setUsers(res.users);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchPending();
  }, []);

  async function handleApprove(userId: string) {
    setApprovingId(userId);
    const res = await approveUser(userId);
    if (res.success) {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } else {
      Swal.fire('Error', res.error || 'Failed to approve user', 'error');
    }
    setApprovingId(null);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pending User Approvals</h1>
          <p className="text-sm text-slate-600">Approve lab borrowers registered on the local network</p>
        </div>
        <button
          onClick={fetchPending}
          className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 border text-slate-700 rounded-md transition"
        >
          Refresh List
        </button>
      </div>

      {loading ? (
        <div className="text-slate-500 py-12 text-center text-sm">Loading pending accounts...</div>
      ) : users.length === 0 ? (
        <div className="bg-slate-50 border border-dashed rounded-xl p-8 text-center text-slate-500 text-sm">
          No pending user registrations right now.
        </div>
      ) : (
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-600 uppercase text-[11px] tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">University Email</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Registered Date</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y text-slate-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/50">
                  <td className="py-3 px-4 font-medium">{u.name}</td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">{u.email}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
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