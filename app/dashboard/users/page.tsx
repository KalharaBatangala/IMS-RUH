'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Role } from '@prisma/client';
import Swal from 'sweetalert2';
import {
  getUsers,
  resetUserPassword,
  resetUserTwoFactor,
  setUserActive,
  toggleUserApproval,
  updateUserRole,
} from '@/actions/users';
import { getCurrentUserRole } from '@/actions/auth';
import { ROLE_LABELS } from '@/components/StatusBadge';

type UserItem = Extract<Awaited<ReturnType<typeof getUsers>>, { success: true }>['data'][number];

const ROLES: Role[] = ['BORROWER', 'COORDINATOR', 'TECHNICAL_OFFICER', 'SUPER_ADMIN'];

export default function UsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();

  function applyUsers(res: Awaited<ReturnType<typeof getUsers>>) {
    if (res.success) setUsers(res.data);
    else Swal.fire('Error', res.error, 'error');
    setLoading(false);
  }

  async function loadUsers() {
    setLoading(true);
    applyUsers(await getUsers());
  }

  useEffect(() => {
    getCurrentUserRole().then((r) => setMyId(r.userId));
    getUsers().then(applyUsers);
  }, []);

  function run(action: () => Promise<{ success: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await action();
      if (!res.success) Swal.fire('Error', res.error || 'Action failed.', 'error');
      loadUsers();
    });
  }

  async function handleRoleChange(user: UserItem, role: Role) {
    const confirm = await Swal.fire({
      title: 'Change role?',
      html: `Change <b>${user.name}</b> from ${ROLE_LABELS[user.role]} to <b>${ROLE_LABELS[role]}</b>? They will be signed out.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Change role',
    });
    if (!confirm.isConfirmed) return loadUsers();
    run(() => updateUserRole(user.id, role));
  }

  async function handleActive(user: UserItem) {
    const confirm = await Swal.fire({
      title: user.isActive ? 'Deactivate account?' : 'Reactivate account?',
      text: user.isActive
        ? `${user.name} will be signed out and unable to log in. Lab assignments and history are kept.`
        : `${user.name} will be able to log in again.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: user.isActive ? 'Deactivate' : 'Reactivate',
    });
    if (confirm.isConfirmed) run(() => setUserActive(user.id, !user.isActive));
  }

  async function handleResetPassword(user: UserItem) {
    const confirm = await Swal.fire({
      title: 'Set a temporary password?',
      text: `${user.name}'s current password stops working and they are signed out. Give them the temporary password in person and ask them to change it under My Account.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Generate',
    });
    if (!confirm.isConfirmed) return;
    startTransition(async () => {
      const res = await resetUserPassword(user.id);
      if (res.success && res.data) {
        await Swal.fire({
          title: 'Temporary password',
          html: `<div style="font-family:monospace;font-size:1.5rem;font-weight:700;margin:.5rem 0">${res.data.temporaryPassword}</div><p style="font-size:.85rem;color:#475569">Shown once. Not stored in plain text.</p>`,
          icon: 'info',
          allowOutsideClick: false,
        });
      } else if (!res.success) {
        Swal.fire('Error', res.error, 'error');
      }
      loadUsers();
    });
  }

  async function handleReset2FA(user: UserItem) {
    const confirm = await Swal.fire({
      title: 'Reset 2FA?',
      text: `Use only if ${user.name} lost their authenticator and you have verified their identity.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Reset 2FA',
    });
    if (confirm.isConfirmed) run(() => resetUserTwoFactor(user.id));
  }

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.indexNumber ?? '').toLowerCase().includes(search.toLowerCase())
  );
  const pendingCount = users.filter((u) => !u.isApproved).length;

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="text-sm text-slate-600">
            Approve accounts, set roles, deactivate accounts and help with password / 2FA recovery.{' '}
            {pendingCount > 0 && (
              <Link href="/dashboard/admin/users" className="text-blue-600 font-semibold hover:underline">
                {pendingCount} pending approval →
              </Link>
            )}
          </p>
        </div>
        <input
          type="text"
          placeholder="Search by name, email or index no..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm w-full md:w-72 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading users...</div>
      ) : filteredUsers.length === 0 ? (
        <div className="bg-white border border-dashed rounded-xl p-12 text-center text-slate-500 text-sm">No users found.</div>
      ) : (
        <div className="bg-white border rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-600 uppercase text-[11px] font-semibold tracking-wider">
              <tr>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Lab Assignments</th>
                <th className="py-3 px-4">Account Status</th>
                <th className="py-3 px-4">Registered</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y text-slate-800">
              {filteredUsers.map((u) => {
                const isMe = u.id === myId;
                return (
                  <tr key={u.id} className={`hover:bg-slate-50/50 ${!u.isActive ? 'opacity-60' : ''}`}>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      {u.name}
                      {isMe && <span className="ml-1 text-[10px] text-blue-600">(you)</span>}
                      <span className="block text-xs font-mono text-slate-400">{u.email}</span>
                      {u.indexNumber && <span className="block text-[11px] font-mono text-slate-500">{u.indexNumber}</span>}
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u, e.target.value as Role)}
                        disabled={isPending || isMe}
                        className="px-2 py-1 border rounded text-xs bg-white font-medium outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {u.labAssignments.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        u.labAssignments.map((a, i) => <div key={i}>{a.lab.name}</div>)
                      )}
                    </td>
                    <td className="py-3 px-4 space-y-1">
                      <span
                        className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full border ${
                          u.isApproved ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {u.isApproved ? 'APPROVED' : 'PENDING APPROVAL'}
                      </span>
                      {!u.isActive && (
                        <span className="inline-block ml-1 px-2.5 py-0.5 text-[10px] font-bold rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                          DEACTIVATED
                        </span>
                      )}
                      <div className="text-[10px] text-slate-400">
                        {u.twoFactorEnabled ? '2FA on' : '2FA off'}
                        {!u.hasPassword && ' · no password set'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="py-3 px-4 text-right">
                      {isMe ? (
                        <span className="text-xs text-slate-400">Manage under My Account</span>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            onClick={() => run(() => toggleUserApproval(u.id, !u.isApproved))}
                            disabled={isPending}
                            className={`px-3 py-1 text-xs font-medium rounded transition ${
                              u.isApproved
                                ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            }`}
                          >
                            {u.isApproved ? 'Revoke Approval' : 'Approve'}
                          </button>
                          <button
                            onClick={() => handleActive(u)}
                            disabled={isPending}
                            className="px-3 py-1 text-xs font-medium rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                          >
                            {u.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                          <button
                            onClick={() => handleResetPassword(u)}
                            disabled={isPending}
                            className="px-3 py-1 text-xs font-medium rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                          >
                            {u.hasPassword ? 'Temp password' : 'Set password'}
                          </button>
                          {u.twoFactorEnabled && (
                            <button
                              onClick={() => handleReset2FA(u)}
                              disabled={isPending}
                              className="px-3 py-1 text-xs font-medium rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                            >
                              Reset 2FA
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
