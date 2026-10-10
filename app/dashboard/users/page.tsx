'use client';

import { useEffect, useState, useTransition } from 'react';
import { getUsers, toggleUserApproval, updateUserRole } from '@/actions/users';
import { UserRole } from '@prisma/client';
import Swal from 'sweetalert2';

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isApproved: boolean;
  createdAt: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();

  async function loadUsers() {
    setLoading(true);
    const res = await getUsers();
    if (res.success && res.data) {
      setUsers(res.data as any);
    } else {
      Swal.fire('Error', res.error || 'Failed to load users', 'error');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function handleApprovalToggle(id: string, currentStatus: boolean) {
    startTransition(async () => {
      const res = await toggleUserApproval(id, !currentStatus);
      if (res.success) {
        loadUsers();
      } else {
        Swal.fire('Error', res.error || 'Failed to toggle user approval', 'error');
      }
    });
  }

  function handleRoleChange(id: string, role: UserRole) {
    startTransition(async () => {
      const res = await updateUserRole(id, role);
      if (res.success) {
        loadUsers();
      } else {
        Swal.fire('Error', res.error || 'Failed to update user role', 'error');
      }
    });
  }

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="text-sm text-slate-600">Approve user accounts and grant role permissions</p>
        </div>
        <input
          type="text"
          placeholder="Search users by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm w-full md:w-72 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading users...</div>
      ) : filteredUsers.length === 0 ? (
        <div className="bg-white border border-dashed rounded-xl p-12 text-center text-slate-500 text-sm">
          No users found.
        </div>
      ) : (
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-600 uppercase text-[11px] font-semibold tracking-wider">
              <tr>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Account Status</th>
                <th className="py-3 px-4">Registered Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y text-slate-800">
              {filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/50">
                  <td className="py-3 px-4 font-medium text-slate-900">
                    {u.name}
                    <span className="block text-xs font-mono text-slate-400">{u.email}</span>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                      disabled={isPending}
                      className="px-2 py-1 border rounded text-xs bg-white font-medium outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="BORROWER">BORROWER</option>
                      <option value="LAB_STAFF">LAB_STAFF</option>
                      <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border ${
                        u.isApproved
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    >
                      {u.isApproved ? 'APPROVED' : 'PENDING APPROVAL'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleApprovalToggle(u.id, u.isApproved)}
                      disabled={isPending}
                      className={`px-3 py-1 text-xs font-medium rounded transition ${
                        u.isApproved
                          ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      {u.isApproved ? 'Revoke Access' : 'Approve Account'}
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