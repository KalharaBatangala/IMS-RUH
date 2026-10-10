import { getEquipment, getLabs } from '@/actions/equipment';
import AddEquipmentModal from '@/components/AddEquipmentModal';
import { getSession, logoutSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function HomePage() {
  const session = await getSession();

  // Redirect unauthenticated users to login
  if (!session) {
    redirect('/login');
  }

  const equipmentRes = await getEquipment();
  const labsRes = await getLabs();

  const items = equipmentRes.data || [];
  const labs = labsRes.data || [];

  return (
    <main className="min-h-screen bg-slate-50 p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        
        

        {/* Dashboard Title Header */}
        <header className="border-b border-slate-200 pb-4 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              Ruhuna Engineering — IMS
            </h1>
            <p className="text-slate-600 mt-1">
              Department Asset Management System
            </p>
          </div>

          {/* Only SUPER_ADMIN and LAB_STAFF can add new equipment */}
          {(session.role === 'SUPER_ADMIN' || session.role === 'LAB_STAFF') && (
            <AddEquipmentModal labs={labs.map((l) => ({ id: l.id, name: l.name }))} />
          )}
        </header>

        {/* Labs Overview Cards */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-800">
            Active Laboratories ({labs.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {labs.map((lab) => (
              <div
                key={lab.id}
                className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
              >
                <h3 className="font-bold text-slate-900 text-lg">{lab.name}</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Coordinators: {lab.coordinators.length > 0
                  ? lab.coordinators.map((c) => c.name).join(', ')
                  : 'None assigned'}
                </p>
                <div className="mt-4 text-sm font-medium text-blue-600">
                  {lab._count.equipment} Equipment Items Registered
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Live Database Items Table */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-800">
            Live Inventory Items ({items.length})
          </h2>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-4">Equipment Name</th>
                  <th className="p-4">Brand / Model</th>
                  <th className="p-4">Laboratory</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="p-4 font-medium">{item.name}</td>
                    <td className="p-4 text-slate-600">
                      {item.brand || 'N/A'} {item.model ? `(${item.model})` : ''}
                    </td>
                    <td className="p-4 text-slate-600">{item.lab.name}</td>
                    <td className="p-4">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
                          item.status === 'RECEIVED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="p-4 font-semibold">{item.quantity}</td>
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