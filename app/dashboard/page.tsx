'use client';

import { useEffect, useState } from 'react';
import { getDashboardStats } from '@/actions/dashboard';
import Link from 'next/link';

interface DashboardData {
  stats: {
    totalEquipment: number;
    totalLabs: number;
    pendingRequests: number;
    activeLoans: number;
    overdueLoans: number;
  };
  recentLogs: Array<{
    id: string;
    status: string;
    borrowDate: string;
    returnDate: string;
    user: { name: string; email: string };
    equipment: { name: string; lab: { name: string } };
  }>;
}

export default function DashboardOverviewPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStats() {
    setLoading(true);
    const res = await getDashboardStats();
    if (res.success && res.stats && res.recentLogs) {
      setData({
        stats: res.stats,
        recentLogs: res.recentLogs as any,
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="p-6 text-center text-slate-500 text-sm font-sans">
        Loading dashboard metrics...
      </div>
    );
  }

  const stats = data?.stats;

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard Overview</h1>
          <p className="text-sm text-slate-600">
            Real-time status of lab hardware, active borrowings, and pending actions
          </p>
        </div>
        <button
          onClick={loadStats}
          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition"
        >
          🔄 Refresh Metrics
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Pending Approvals */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-1">
            Pending Requests
          </div>
          <div className="text-3xl font-bold text-slate-900">{stats?.pendingRequests || 0}</div>
          <p className="text-xs text-slate-500 mt-2">Awaiting staff review</p>
          <Link
            href="/dashboard/borrow?status=PENDING"
            className="mt-3 block text-xs text-blue-600 font-semibold hover:underline"
          >
            Review requests &rarr;
          </Link>
        </div>

        {/* Metric 2: Active Loans */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1">
            Active Loans
          </div>
          <div className="text-3xl font-bold text-slate-900">{stats?.activeLoans || 0}</div>
          <p className="text-xs text-slate-500 mt-2">Equipment currently issued</p>
          <Link
            href="/dashboard/borrow?status=ISSUED"
            className="mt-3 block text-xs text-blue-600 font-semibold hover:underline"
          >
            View issued gear &rarr;
          </Link>
        </div>

        {/* Metric 3: Overdue Items */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-rose-600 uppercase tracking-wider mb-1">
            Overdue Returns
          </div>
          <div className="text-3xl font-bold text-rose-600">{stats?.overdueLoans || 0}</div>
          <p className="text-xs text-slate-500 mt-2">Past expected return date</p>
          <Link
            href="/dashboard/borrow?status=OVERDUE"
            className="mt-3 block text-xs text-rose-600 font-semibold hover:underline"
          >
            Manage overdue &rarr;
          </Link>
        </div>

        {/* Metric 4: Total Inventory */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Total Inventory
          </div>
          <div className="text-3xl font-bold text-slate-900">{stats?.totalEquipment || 0}</div>
          <p className="text-xs text-slate-500 mt-2">Across {stats?.totalLabs || 0} laboratories</p>
          <Link
            href="/dashboard/inventory"
            className="mt-3 block text-xs text-blue-600 font-semibold hover:underline"
          >
            Browse inventory &rarr;
          </Link>
        </div>
      </div>

      {/* Recent Activity Table Widget */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Recent Request Activity</h2>
            <p className="text-xs text-slate-500">Latest borrowing updates and requests</p>
          </div>
          <Link
            href="/dashboard/borrow"
            className="text-xs font-semibold text-blue-600 hover:underline"
          >
            View All Logs
          </Link>
        </div>

        {!data?.recentLogs || data.recentLogs.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">No activity recorded yet.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b text-slate-600 uppercase text-[11px] font-semibold tracking-wider bg-slate-50/50">
              <tr>
                <th className="py-2.5 px-4">User</th>
                <th className="py-2.5 px-4">Equipment</th>
                <th className="py-2.5 px-4">Target Return</th>
                <th className="py-2.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y text-slate-800">
              {data.recentLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50">
                  <td className="py-3 px-4 font-medium text-slate-900">
                    {log.user.name}
                    <span className="block text-xs font-mono text-slate-400">{log.user.email}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-semibold text-slate-800">{log.equipment.name}</span>
                    <span className="block text-xs text-slate-500">{log.equipment.lab.name}</span>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    {new Date(log.returnDate).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border ${
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}