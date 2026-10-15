'use client';

import { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { getAuditLog } from '@/actions/audit';

type AuditResult = Extract<Awaited<ReturnType<typeof getAuditLog>>, { success: true }>;

export default function AuditPage() {
  const [result, setResult] = useState<AuditResult | null>(null);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Loading starts true; later filter/page changes keep showing the previous page until replaced.
  useEffect(() => {
    getAuditLog({ action: action || undefined, page }).then((res) => {
      if (res.success) setResult(res);
      else Swal.fire('Error', res.error, 'error');
      setLoading(false);
    });
  }, [action, page]);

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Log</h1>
          <p className="text-sm text-slate-600">
            Append-only record of who did what and when. Entries cannot be edited or deleted from the application.
          </p>
        </div>
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All actions</option>
          {result?.actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {loading && !result ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading…</div>
      ) : !result || result.data.length === 0 ? (
        <div className="bg-white border border-dashed rounded-xl p-12 text-center text-slate-500 text-sm">No audit entries.</div>
      ) : (
        <>
          <div className="bg-white border rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b text-slate-600 uppercase text-[11px] font-semibold tracking-wider">
                <tr>
                  <th className="py-3 px-4">When</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y text-slate-800">
                {result.data.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-slate-50/50">
                    <td className="py-2 px-4 text-xs text-slate-500 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="py-2 px-4 text-xs">
                      {row.actor ? (
                        <>
                          <span className="font-medium text-slate-800">{row.actor.name}</span>
                          <span className="block font-mono text-slate-400">{row.actor.email}</span>
                        </>
                      ) : (
                        <span className="italic text-slate-400">System</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-xs font-semibold text-slate-700">{row.action}</td>
                    <td className="py-2 px-4 text-[11px] text-slate-500">
                      {row.entityType}
                      <span className="block font-mono text-slate-400">{row.entityId?.slice(0, 8)}</span>
                    </td>
                    <td className="py-2 px-4 text-[11px] font-mono text-slate-600 max-w-md break-all">
                      {row.details ? JSON.stringify(row.details) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center mt-4 text-xs text-slate-600">
            <span>
              {result.total} entries · page {result.page} of {result.pageCount}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 border rounded disabled:opacity-40"
              >
                ← Newer
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= result.pageCount}
                className="px-3 py-1 border rounded disabled:opacity-40"
              >
                Older →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
