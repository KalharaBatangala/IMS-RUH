'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDashboardStats } from '@/actions/dashboard';
import { RequestStatusBadge } from '@/components/StatusBadge';

type DashboardData = Extract<Awaited<ReturnType<typeof getDashboardStats>>, { success: true }>;

export default function DashboardOverviewPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function applyStats(res: Awaited<ReturnType<typeof getDashboardStats>>) {
    if (res.success) setData(res);
    else setError(res.error);
    setLoading(false);
  }

  async function loadStats() {
    setLoading(true);
    applyStats(await getDashboardStats());
  }

  useEffect(() => {
    getDashboardStats().then(applyStats);
  }, []);

  if (loading && !data) {
    return <div className="p-6 text-center text-slate-500 text-sm font-sans">Loading dashboard metrics...</div>;
  }
  if (!data) {
    return <div className="p-6 text-center text-rose-600 text-sm font-sans">{error}</div>;
  }

  const { stats, role, scope } = data;
  const reviewLabel = role === 'COORDINATOR' ? 'Review requests' : 'View requests';

  const cards = [
    {
      title: 'Pending Requests',
      color: 'text-amber-600',
      value: stats.pendingRequests,
      note: stats.stalePending > 0 ? `${stats.stalePending} waiting more than 3 days` : 'Awaiting Coordinator review',
      noteClass: stats.stalePending > 0 ? 'text-amber-700 font-semibold' : 'text-slate-500',
      href: '/dashboard/borrow?status=PENDING',
      link: `${reviewLabel} →`,
    },
    {
      title: 'Reserved (to collect)',
      color: 'text-blue-600',
      value: stats.reservations,
      note: 'Recommended, awaiting handover',
      href: '/dashboard/borrow?status=APPROVED',
      link: 'View reservations →',
    },
    {
      title: 'Active Loans',
      color: 'text-indigo-600',
      value: stats.activeLoans,
      note: stats.returnsInProgress > 0 ? `${stats.returnsInProgress} return(s) in progress` : 'Equipment currently issued',
      href: '/dashboard/borrow?status=ISSUED',
      link: 'View issued gear →',
    },
    {
      title: 'Overdue Returns',
      color: 'text-rose-600',
      value: stats.overdueLoans,
      valueClass: 'text-rose-600',
      note: 'Still on loan past the return date',
      href: '/dashboard/borrow?status=OVERDUE',
      link: 'Manage overdue →',
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard Overview</h1>
          <p className="text-sm text-slate-600">
            {scope === 'ALL'
              ? 'All laboratories'
              : scope === 'ASSIGNED'
              ? 'Your assigned laboratories'
              : 'You are not assigned to any laboratory yet — ask the Super Admin to assign you.'}
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
        {cards.map((c) => (
          <div key={c.title} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${c.color}`}>{c.title}</div>
            <div className={`text-3xl font-bold ${c.valueClass ?? 'text-slate-900'}`}>{c.value}</div>
            <p className={`text-xs mt-2 ${c.noteClass ?? 'text-slate-500'}`}>{c.note}</p>
            <Link href={c.href} className="mt-3 block text-xs text-blue-600 font-semibold hover:underline">
              {c.link}
            </Link>
          </div>
        ))}
      </div>

      {/* Unit availability */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-base font-bold text-slate-900">Physical units ({stats.unitsTotal})</h2>
          <Link href="/dashboard/inventory" className="text-xs font-semibold text-blue-600 hover:underline">
            Browse inventory →
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          {[
            ['Available', stats.unitsAvailable, 'text-emerald-700 bg-emerald-50'],
            ['Reserved', stats.unitsReserved, 'text-blue-700 bg-blue-50'],
            ['Issued', stats.unitsIssued, 'text-indigo-700 bg-indigo-50'],
            ['Unavailable', stats.unitsUnavailable, 'text-rose-700 bg-rose-50'],
          ].map(([label, value, cls]) => (
            <div key={label as string} className={`rounded-lg p-3 ${cls}`}>
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-[11px] font-semibold uppercase">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity Table Widget */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Recent Request Activity</h2>
            <p className="text-xs text-slate-500">Latest borrowing updates and requests</p>
          </div>
          <Link href="/dashboard/borrow" className="text-xs font-semibold text-blue-600 hover:underline">
            View All Logs
          </Link>
        </div>

        {data.recentLogs.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">No activity recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
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
                    <td className="py-3 px-4 text-xs text-slate-600">{new Date(log.returnDate).toLocaleDateString()}</td>
                    <td className="py-3 px-4">
                      <RequestStatusBadge status={log.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
