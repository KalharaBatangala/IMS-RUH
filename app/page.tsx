import { getEquipment, getLabs } from '@/actions/equipment';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function HomePage() {
  const session = await getSession();

  // Redirect unauthenticated users to login
  if (!session) {
    redirect('/login');
  }

  const [equipmentRes, labsRes] = await Promise.all([getEquipment(), getLabs()]);
  const items = equipmentRes.success ? equipmentRes.data : [];
  const labs = labsRes.success ? labsRes.data : [];

  return (
    <main className="min-h-screen bg-slate-50 p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Dashboard Title Header */}
        <header className="border-b border-slate-200 pb-4 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Ruhuna Engineering — IMS</h1>
            <p className="text-slate-600 mt-1">Department of Electrical and Information Engineering — Equipment Catalogue</p>
          </div>
          <Link
            href="/dashboard/inventory"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors shadow-sm"
          >
            Browse & Request →
          </Link>
        </header>

        {/* Labs Overview Cards */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-800">Active Laboratories ({labs.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {labs.map((lab) => (
              <div key={lab.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                <h3 className="font-bold text-slate-900 text-lg">{lab.name}</h3>
                {lab.description && <p className="text-xs text-slate-500 mt-1">{lab.description}</p>}
                <p className="text-xs text-slate-500 mt-1">
                  Coordinator: {lab.coordinators.length > 0 ? lab.coordinators.map((c) => c.name).join(', ') : 'None assigned'}
                </p>
                <p className="text-xs text-slate-500">
                  Technical Officer: {lab.technicalOfficers.length > 0 ? lab.technicalOfficers.map((c) => c.name).join(', ') : 'None assigned'}
                </p>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="font-medium text-blue-600">{lab._count.equipment} Equipment Types</span>
                  {!lab.operational && <span className="text-[11px] font-semibold text-amber-700">Borrowing paused</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Live Database Items Table */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-800">Equipment You Can Request ({items.filter((i) => i.requestable).length})</h2>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-4">Equipment Name</th>
                  <th className="p-4">Brand / Model</th>
                  <th className="p-4">Laboratory</th>
                  <th className="p-4">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {items
                  .filter((i) => i.requestable)
                  .map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="p-4 font-medium">{item.name}</td>
                      <td className="p-4 text-slate-600">
                        {item.brand || 'N/A'} {item.model ? `(${item.model})` : ''}
                      </td>
                      <td className="p-4 text-slate-600">{item.lab.name}</td>
                      <td className="p-4 font-semibold">{item.availableUnits}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </main>
  );
}
