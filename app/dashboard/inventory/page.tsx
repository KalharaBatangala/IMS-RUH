'use client';

import { useEffect, useState, useTransition } from 'react';
import { createBorrowRequest } from '@/actions/borrow';
import { AssetStatus, ItemCondition } from '@prisma/client';
import Swal from 'sweetalert2';
import { getCurrentUserRole } from '@/actions/auth';
import { getEquipment, getLabs, createEquipment, getEquipmentUnits, addUnitsToEquipment, updateEquipmentUnit } from '@/actions/equipment';
import { Fragment } from 'react';


interface EquipmentUnit {
  id: string;
  serialNumber: string;
  status: 'AVAILABLE' | 'ISSUED';
  condition: ItemCondition;
  assetStatus: AssetStatus;
}

interface EquipmentSummary {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  remarks: string | null;
  lab: { name: string };
  totalUnits: number;
  availableUnits: number;
  conditionSummary: Record<string, number>;
}

interface EquipmentWithLab {
  id: string;
  name: string;
  quantity: number;
  availableQuantity: number;
  status: AssetStatus;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  condition: ItemCondition;
  remarks: string | null;
  lab: { name: string };
}

interface LabItem {
  id: string;
  name: string;
}



export default function InventoryPage() {
  const [equipmentList, setEquipmentList] = useState<EquipmentSummary[]>([]);
  const [labs, setLabs] = useState<LabItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLab, setSelectedLab] = useState('');
  const [role, setRole] = useState<string | null>(null);
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [borrowItem, setBorrowItem] = useState<EquipmentSummary | null>(null);

  const [isPending, startTransition] = useTransition();

  const [expandedId, setExpandedId] = useState<string | null>(null);
const [unitsCache, setUnitsCache] = useState<Record<string, EquipmentUnit[]>>({});
const [loadingUnits, setLoadingUnits] = useState(false);
const [addUnitsTarget, setAddUnitsTarget] = useState<EquipmentSummary | null>(null);


async function toggleExpand(equipmentId: string) {
  if (expandedId === equipmentId) {
    setExpandedId(null);
    return;
  }
  setExpandedId(equipmentId);
  if (!unitsCache[equipmentId]) {
    setLoadingUnits(true);
    const res = await getEquipmentUnits(equipmentId);
    if (res.success && res.data) {
      setUnitsCache((prev) => ({ ...prev, [equipmentId]: res.data }));
    }
    setLoadingUnits(false);
  }
}






  useEffect(() => {
    getCurrentUserRole().then((res) => setRole(res.role));
  }, []);

  const canManageEquipment = role === 'LAB_STAFF' || role === 'SUPER_ADMIN';




  // Load Equipment and Lab Metadata
  async function loadInventory() {
    setLoading(true);
    const [equipRes, labsRes] = await Promise.all([
      getEquipment(searchQuery, selectedLab),
      getLabs(),
    ]);

    if (equipRes.success && equipRes.data) {
      setEquipmentList(equipRes.data as EquipmentSummary[]);
    }
    if (labsRes.success && labsRes.data) {
      setLabs(labsRes.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadInventory();
  }, [selectedLab]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    loadInventory();
  }

  // Submit Handler: Add New Equipment
  async function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const res = await createEquipment({
        name: formData.get('name') as string,
        quantity: parseInt(formData.get('quantity') as string) || 1,
        
        brand: formData.get('brand') as string,
        model: formData.get('model') as string,
        
        
        remarks: formData.get('remarks') as string,
        labId: formData.get('labId') as string,
      });

      if (res.success) {
        setShowAddModal(false);
        if (res.merged) {
        Swal.fire('Units Added', res.message || 'Added to an existing equipment type.', 'success');
      }
        loadInventory();
      } else {
        Swal.fire('Error', res.error || 'Failed to create item', 'error');
      }
    });
  }

  // Submit Handler: Request Borrow
  async function handleBorrowSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!borrowItem) return;

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const res = await createBorrowRequest({
        equipmentId: borrowItem.id,
        borrowDate: formData.get('borrowDate') as string,
        returnDate: formData.get('returnDate') as string,
        notes: formData.get('notes') as string,
      });

      if (res.success) {
        // alert(`Request for "${borrowItem.name}" submitted successfully!`);
        Swal.fire('Success', `Request for "${borrowItem.name}" submitted successfully!`, 'success');
        setBorrowItem(null);
      } else {
        Swal.fire('Error', res.error || 'Failed to submit borrow request.', 'error');
      }
    });
  }

  async function handleAddUnitsSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  if (!addUnitsTarget) return;
  const formData = new FormData(e.currentTarget);
  const quantity = parseInt(formData.get('quantity') as string) || 1;

  startTransition(async () => {
    const res = await addUnitsToEquipment(addUnitsTarget.id, quantity);
    if (res.success) {
      setAddUnitsTarget(null);
      loadInventory();
    } else {
      Swal.fire('Error', res.error || 'Failed to add units.', 'error');
    }
  });
}

async function handleUnitUpdate(
  unitId: string,
  equipmentId: string,
  data: { condition?: ItemCondition; assetStatus?: AssetStatus }
) {
  const res = await updateEquipmentUnit(unitId, data);
  if (res.success) {
    const unitsRes = await getEquipmentUnits(equipmentId);
    if (unitsRes.success && unitsRes.data) {
      setUnitsCache((prev) => ({ ...prev, [equipmentId]: unitsRes.data }));
    }
    loadInventory(); // refreshes the collapsed row's condition summary + available count
  } else {
    Swal.fire('Error', res.error || 'Failed to update unit.', 'error');
  }
}

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans">
      {/* Header */}
      {/* <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Laboratory Equipment</h1>
          <p className="text-sm text-slate-600">Manage hardware inventory across department labs</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition shadow-sm"
        >
          + Add Equipment
        </button>
      </div> */}


       <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Laboratory Equipment</h1>
          <p className="text-sm text-slate-600">Manage hardware inventory across department labs</p>
        </div>
        {canManageEquipment && (
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition shadow-sm"
          >
            + Add Equipment
          </button>
        )}
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex flex-col md:flex-row gap-3">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
          <input
            type="text"
            placeholder="Search by name, brand, model, or serial no..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg transition hover:cursor-pointer"
          >
            Search
          </button>
        </form>

        <select
          value={selectedLab}
          onChange={(e) => setSelectedLab(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Laboratories</option>
          {labs.map((lab) => (
            <option key={lab.id} value={lab.id}>
              {lab.name}
            </option>
          ))}
        </select>
      </div>

      {/* Equipment Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading inventory...</div>
      ) : equipmentList.length === 0 ? (
        <div className="bg-white border border-dashed rounded-xl p-12 text-center text-slate-500 text-sm">
          No equipment items found.
        </div>
      ) : (
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-600 uppercase text-[11px] font-semibold tracking-wider">
  <tr>
    {canManageEquipment && <th className="py-3 px-2"></th>}
    <th className="py-3 px-4">Equipment Name</th>
    <th className="py-3 px-4">Brand / Model</th>
    <th className="py-3 px-4">Lab</th>
    <th className="py-3 px-4 text-center">Qty</th>
    <th className="py-3 px-4">Condition</th>
    <th className="py-3 px-4 text-right">Actions</th>
  </tr>
</thead>
            <tbody className="divide-y text-slate-800">
  {equipmentList.map((item) => (
    <Fragment key={item.id}>
      <tr className="hover:bg-slate-50/50">
        {canManageEquipment && (
  <td className="py-3 px-2 text-center whitespace-nowrap">
    <button onClick={() => toggleExpand(item.id)} className="text-slate-400 hover:text-slate-700 mr-1">
      {expandedId === item.id ? '▼' : '▶'}
    </button>
    <button
      onClick={() => setAddUnitsTarget(item)}
      className="text-[10px] text-blue-600 hover:underline"
      title="Add more units of this type"
    >
      +Units
    </button>
  </td>
)}
        <td className="py-3 px-4 font-medium text-slate-900">
          {item.name}
          {item.remarks && <span className="block text-xs text-slate-400 font-normal">{item.remarks}</span>}
        </td>
        <td className="py-3 px-4 text-slate-600">
          {item.brand || '-'} {item.model ? `/ ${item.model}` : ''}
        </td>
        <td className="py-3 px-4 font-medium text-slate-700">{item.lab.name}</td>
        <td className="py-3 px-4 text-center font-bold">{item.availableUnits}/{item.totalUnits}</td>
        <td className="py-3 px-4">
          {Object.entries(item.conditionSummary).map(([cond, count]) => (
            <span
              key={cond}
              className={`inline-block mr-1 mb-1 px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                cond === 'WORKING'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : cond === 'UNDER_REPAIR'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              {cond}: {count}
            </span>
          ))}
        </td>
        <td className="py-3 px-4 text-right">
          <button
            onClick={() => setBorrowItem(item)}
            disabled={item.availableUnits <= 0}
            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition hover:cursor-pointer"
          >
            {item.availableUnits <= 0 ? 'Fully Issued' : 'Request Borrow'}
          </button>
        </td>
      </tr>

      {expandedId === item.id && canManageEquipment && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-6 py-3">
            {loadingUnits && !unitsCache[item.id] ? (
              <p className="text-xs text-slate-500">Loading units...</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-slate-500 uppercase text-[10px]">
                  <tr>
                    <th className="py-1 text-left">Serial Number</th>
                    <th className="py-1 text-left">Status</th>
                    <th className="py-1 text-left">Condition</th>
                    <th className="py-1 text-left">Asset Status</th>
                  </tr>
                </thead>
                <tbody>
  {(unitsCache[item.id] || []).map((u) => (
    <tr key={u.id} className="border-t border-slate-200">
      <td className="py-1.5 font-mono">{u.serialNumber}</td>
      <td className="py-1.5">{u.status}</td>
      <td className="py-1.5">
        <select
          value={u.condition}
          onChange={(e) =>
            handleUnitUpdate(u.id, item.id, { condition: e.target.value as ItemCondition })
          }
          className="text-xs border rounded px-1 py-0.5 bg-white outline-none"
        >
          <option value="WORKING">WORKING</option>
          <option value="DAMAGED">DAMAGED</option>
          <option value="UNDER_REPAIR">UNDER_REPAIR</option>
        </select>
      </td>
      <td className="py-1.5">
        <select
          value={u.assetStatus}
          onChange={(e) =>
            handleUnitUpdate(u.id, item.id, { assetStatus: e.target.value as AssetStatus })
          }
          className="text-xs border rounded px-1 py-0.5 bg-white outline-none"
        >
          <option value="RECEIVED">RECEIVED</option>
          <option value="NOT_RECEIVED">NOT_RECEIVED</option>
        </select>
      </td>
    </tr>
  ))}
</tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  ))}
</tbody>
          </table>
        </div>
      )}

      {addUnitsTarget && (
  <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
    <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
      <h2 className="text-lg font-bold text-slate-900">
        Add Units: <span className="text-blue-600">{addUnitsTarget.name}</span>
      </h2>
      <form onSubmit={handleAddUnitsSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
            How Many Additional Units?
          </label>
          <input
            name="quantity"
            type="number"
            min={1}
            defaultValue={1}
            required
            className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setAddUnitsTarget(null)}
            className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
          >
            {isPending ? 'Adding...' : 'Add Units'}
          </button>
        </div>
      </form>
    </div>
  </div>
)}



      {/* Modal 1: Add Equipment */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4">
            <h2 className="text-xl font-bold text-slate-900">Add Equipment Item</h2>
            <form onSubmit={handleCreateSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Equipment Name *
                </label>
                <input
  name="name"
  required
  list="equipment-name-suggestions"
  placeholder="e.g. Cisco 2911 Router"
  className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
/>
<datalist id="equipment-name-suggestions">
  {Array.from(new Set(equipmentList.map((e) => e.name))).map((n) => (
    <option key={n} value={n} />
  ))}
</datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Brand
                  </label>
                  <input
                    name="brand"
                    placeholder="e.g. Cisco"
                    className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Model
                  </label>
                  <input
                    name="model"
                    placeholder="e.g. 2911/K9"
                    className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Quantity *
                  </label>
                  <input
                    name="quantity"
                    type="number"
                    defaultValue={1}
                    min={1}
                    required
                    className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Lab *
                  </label>
                  <select
                    name="labId"
                    required
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white outline-none"
                  >
                    {labs.map((lab) => (
                      <option key={lab.id} value={lab.id}>
                        {lab.name}
                      </option>
                    ))}
                  </select>
                </div>

                

              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Remarks / Notes
                </label>
                <input
                  name="remarks"
                  placeholder="e.g. Located in Rack 2, Unit B"
                  className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {isPending ? 'Saving...' : 'Save Equipment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Request Borrow */}
      {borrowItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Request Equipment</h2>
              <p className="text-sm text-slate-500">
                Borrowing: <span className="font-semibold text-slate-800">{borrowItem.name}</span> ({borrowItem.lab.name})
              </p>
            </div>

            <form onSubmit={handleBorrowSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Borrow Date *
                  </label>
                  <input
                    type="date"
                    name="borrowDate"
                    required
                    defaultValue={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Expected Return *
                  </label>
                  <input
                    type="date"
                    name="returnDate"
                    required
                    className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Purpose / Notes
                </label>
                <textarea
                  name="notes"
                  rows={3}
                  placeholder="e.g. Lab Experiment 03 for Telecommunications module"
                  className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setBorrowItem(null)}
                  className="px-4 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 hover:cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-emerald-600 text-white font-medium text-sm rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 hover:cursor-pointer"
                >
                  {isPending ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}