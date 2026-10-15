'use client';

import { Fragment, useEffect, useState, useTransition } from 'react';
import Swal from 'sweetalert2';
import { createBorrowRequest } from '@/actions/borrow';
import {
  addUnitsToEquipment,
  createEquipment,
  exportInventory,
  getEquipment,
  getEquipmentUnits,
  getLabs,
  setEquipmentArchived,
  updateEquipmentDetails,
} from '@/actions/equipment';
import { AvailabilityBadge } from '@/components/StatusBadge';
import UnitsPanel, { type EquipmentUnit } from '@/components/inventory/UnitsPanel';
import ImportModal, { downloadCsv } from '@/components/inventory/ImportModal';
import { normalizeSerial } from '@/lib/inventory-import';
import type { Availability } from '@/lib/availability';
import type { AssetStatus, ItemCondition } from '@prisma/client';

type EquipmentSummary = Extract<Awaited<ReturnType<typeof getEquipment>>, { success: true }>['data'][number];
type LabItem = Extract<Awaited<ReturnType<typeof getLabs>>, { success: true }>['data'][number];

const AVAILABILITY_ORDER: Availability[] = ['AVAILABLE', 'RESERVED', 'ISSUED', 'UNAVAILABLE'];

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function countSerials(text: string) {
  return text.split(/[\n,]+/).filter((s) => normalizeSerial(s)).length;
}

const inputCls = 'w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-xs font-semibold text-slate-700 uppercase mb-1';

// Details applied to every unit created in one go (add equipment / add units).
function UnitDefaultsFields() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className={labelCls}>Status</label>
        <select name="assetStatus" defaultValue="RECEIVED" className={`${inputCls} bg-white`}>
          <option value="RECEIVED">Received</option>
          <option value="NOT_RECEIVED">Not received yet</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Condition</label>
        <select name="condition" defaultValue="WORKING" className={`${inputCls} bg-white`}>
          <option value="WORKING">Working</option>
          <option value="DAMAGED">Damaged</option>
          <option value="UNDER_REPAIR">Under repair</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Current location</label>
        <input name="location" placeholder="e.g. Stores Room" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Date of purchase</label>
        <input name="purchasedAt" type="date" className={inputCls} />
      </div>
    </div>
  );
}

function SerialsField({ quantityName = 'quantity' }: { quantityName?: string }) {
  const [count, setCount] = useState(0);
  return (
    <div>
      <label className={labelCls}>Serial numbers (one per line, optional)</label>
      <textarea
        name="serialNumbers"
        rows={4}
        onChange={(e) => setCount(countSerials(e.target.value))}
        placeholder={'02785A3WL252402274\n02785A3WL252401291'}
        className={`${inputCls} font-mono`}
      />
      <p className="text-[10px] text-slate-400 mt-1">
        {count > 0 ? `${count} serial(s) entered. ` : ''}
        Units without a serial (blank, &quot;N/A&quot;) get a generated asset tag, shown as GENERATED TAG, that you can replace later.
        The {quantityName} must be at least the number of serials.
      </p>
    </div>
  );
}

export default function InventoryPage() {
  const [equipmentList, setEquipmentList] = useState<EquipmentSummary[]>([]);
  const [labs, setLabs] = useState<LabItem[]>([]);
  const [managesAnyLab, setManagesAnyLab] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLab, setSelectedLab] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [borrowItem, setBorrowItem] = useState<EquipmentSummary | null>(null);
  const [addUnitsTarget, setAddUnitsTarget] = useState<EquipmentSummary | null>(null);
  const [editTarget, setEditTarget] = useState<EquipmentSummary | null>(null);

  const [isPending, startTransition] = useTransition();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [unitsCache, setUnitsCache] = useState<Record<string, EquipmentUnit[]>>({});
  const [loadingUnits, setLoadingUnits] = useState(false);

  const manageableLabs = labs.filter((l) => l.canManage);

  async function refreshUnits(equipmentId: string) {
    const res = await getEquipmentUnits(equipmentId);
    if (res.success) setUnitsCache((prev) => ({ ...prev, [equipmentId]: res.data ?? [] }));
    else Swal.fire('Error', res.error, 'error');
  }

  async function expand(equipmentId: string) {
    setExpandedId(equipmentId);
    setLoadingUnits(true);
    await refreshUnits(equipmentId);
    setLoadingUnits(false);
  }

  function toggleExpand(equipmentId: string) {
    if (expandedId === equipmentId) setExpandedId(null);
    else expand(equipmentId);
  }

  // Load Equipment and Lab Metadata
  function fetchInventory() {
    return Promise.all([getEquipment(searchQuery, selectedLab, showArchived), getLabs()]);
  }

  async function loadInventory() {
    setLoading(true);
    applyInventory(await fetchInventory());
  }

  function applyInventory([equipRes, labsRes]: Awaited<ReturnType<typeof fetchInventory>>) {
    if (equipRes.success) {
      setEquipmentList(equipRes.data);
      setManagesAnyLab(equipRes.managesAnyLab);
      // A serial / location search that hits exactly one type opens it, highlighting the unit.
      const hits = equipRes.data.filter((e) => e.unitMatches.length > 0);
      if (hits.length === 1) expand(hits[0].id);
    } else {
      Swal.fire('Error', equipRes.error, 'error');
    }
    if (labsRes.success) setLabs(labsRes.data);
    setLoading(false);
  }

  useEffect(() => {
    fetchInventory().then(applyInventory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLab, showArchived]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    loadInventory();
  }

  function unitDefaults(formData: FormData) {
    return {
      condition: formData.get('condition') as ItemCondition,
      assetStatus: formData.get('assetStatus') as AssetStatus,
      location: formData.get('location') as string,
      purchasedAt: formData.get('purchasedAt') as string,
    };
  }

  // Submit Handler: Add New Equipment
  function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
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
        serialNumbers: formData.get('serialNumbers') as string,
        ...unitDefaults(formData),
      });
      if (res.success) {
        setShowAddModal(false);
        Swal.fire(res.merged ? 'Units Added' : 'Saved', res.message, 'success');
        loadInventory();
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  // Submit Handler: Request Borrow
  function handleBorrowSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!borrowItem) return;
    const formData = new FormData(e.currentTarget);
    const item = borrowItem;
    startTransition(async () => {
      const res = await createBorrowRequest({
        equipmentId: item.id,
        borrowDate: formData.get('borrowDate') as string,
        returnDate: formData.get('returnDate') as string,
        notes: formData.get('notes') as string,
      });
      if (res.success) {
        Swal.fire('Submitted', `Your request for "${item.name}" was sent to the lab Coordinator. Track it under My Requests.`, 'success');
        setBorrowItem(null);
        loadInventory();
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  function handleAddUnitsSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!addUnitsTarget) return;
    const formData = new FormData(e.currentTarget);
    const target = addUnitsTarget;
    startTransition(async () => {
      const res = await addUnitsToEquipment(
        target.id,
        parseInt(formData.get('quantity') as string) || 1,
        formData.get('serialNumbers') as string,
        unitDefaults(formData)
      );
      if (res.success) {
        setAddUnitsTarget(null);
        if (expandedId === target.id) await refreshUnits(target.id);
        loadInventory();
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editTarget) return;
    const formData = new FormData(e.currentTarget);
    const target = editTarget;
    startTransition(async () => {
      const res = await updateEquipmentDetails(target.id, {
        name: formData.get('name') as string,
        brand: formData.get('brand') as string,
        model: formData.get('model') as string,
        remarks: formData.get('remarks') as string,
      });
      if (res.success) {
        setEditTarget(null);
        loadInventory();
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  async function handleArchiveType(item: EquipmentSummary) {
    const archiving = !item.archived;
    const confirm = await Swal.fire({
      title: archiving ? `Archive "${item.name}"?` : `Restore "${item.name}"?`,
      text: archiving
        ? 'Archived equipment is hidden and cannot be requested. Its history is kept and it can be restored later.'
        : 'The equipment type will be visible again.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: archiving ? 'Archive' : 'Restore',
    });
    if (!confirm.isConfirmed) return;
    startTransition(async () => {
      const res = await setEquipmentArchived(item.id, archiving);
      if (!res.success) Swal.fire('Error', res.error, 'error');
      loadInventory();
    });
  }

  function handleExport() {
    startTransition(async () => {
      const res = await exportInventory(selectedLab || undefined);
      if (!res.success) {
        Swal.fire('Error', res.error, 'error');
        return;
      }
      const lab = labs.find((l) => l.id === selectedLab)?.name ?? 'all-labs';
      downloadCsv(`inventory-${lab.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${todayLocal()}.csv`, [res.data.header, ...res.data.rows]);
    });
  }

  const columns = managesAnyLab ? 7 : 6;

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Laboratory Equipment</h1>
          <p className="text-sm text-slate-600">
            {managesAnyLab
              ? 'Manage hardware inventory for your laboratories and browse equipment you can borrow'
              : 'Laboratory equipment you can borrow. Greyed-out items are currently unavailable.'}
          </p>
        </div>
        {manageableLabs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExport}
              disabled={isPending}
              className="px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium text-sm rounded-lg transition disabled:opacity-50"
              title="Download one row per unit (filtered by the selected lab)"
            >
              ⬇ Export CSV
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="px-3 py-2 border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium text-sm rounded-lg transition"
            >
              ⬆ Import spreadsheet
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition shadow-sm"
            >
              + Add Equipment
            </button>
          </div>
        )}
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex flex-col md:flex-row gap-3">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
          <input
            type="text"
            placeholder={managesAnyLab ? 'Search by name, brand, model, serial number or location...' : 'Search by name, brand or model...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={inputCls}
          />
          <button type="submit" className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg transition hover:cursor-pointer">
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
        {managesAnyLab && (
          <label className="flex items-center gap-2 text-xs text-slate-600 whitespace-nowrap">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        )}
      </div>

      {/* Equipment Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading inventory...</div>
      ) : equipmentList.length === 0 ? (
        <div className="bg-white border border-dashed rounded-xl p-12 text-center text-slate-500 text-sm">No equipment items found.</div>
      ) : (
        <div className="bg-white border rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-600 uppercase text-[11px] font-semibold tracking-wider">
              <tr>
                {managesAnyLab && <th className="py-3 px-2"></th>}
                <th className="py-3 px-4">Equipment Name</th>
                <th className="py-3 px-4">Brand / Model</th>
                <th className="py-3 px-4">Lab</th>
                <th className="py-3 px-4 text-center">Available</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y text-slate-800">
              {equipmentList.map((item) => (
                <Fragment key={item.id}>
                  <tr
                    aria-disabled={!item.canManage && !item.requestable}
                    className={
                      !item.canManage && !item.requestable
                        ? 'bg-slate-50 opacity-50 cursor-not-allowed select-none' // shown, but dimmed like a disabled control
                        : `hover:bg-slate-50/50 ${item.archived ? 'opacity-60' : ''}`
                    }
                  >
                    {managesAnyLab && (
                      <td className="py-3 px-2 text-center whitespace-nowrap">
                        {item.canManage && (
                          <>
                            <button onClick={() => toggleExpand(item.id)} className="text-slate-400 hover:text-slate-700 mr-1" title="Show units">
                              {expandedId === item.id ? '▼' : '▶'}
                            </button>
                            {!item.archived && (
                              <button onClick={() => setAddUnitsTarget(item)} className="text-[10px] text-blue-600 hover:underline" title="Add more units of this type">
                                +Units
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    )}
                    <td className="py-3 px-4 font-medium text-slate-900">
                      {item.name}
                      {item.archived && <span className="ml-1 text-[10px] font-bold text-slate-500">(ARCHIVED)</span>}
                      {item.remarks && <span className="block text-xs text-slate-400 font-normal">{item.remarks}</span>}
                      {item.unitMatches.length > 0 && (
                        <span className="block text-[10px] font-mono text-yellow-800 bg-yellow-50 rounded px-1 mt-0.5 w-fit">
                          match: {item.unitMatches.slice(0, 3).join(', ')}
                          {item.unitMatches.length > 3 ? ` +${item.unitMatches.length - 3}` : ''}
                        </span>
                      )}
                      {item.placeholderSerials > 0 && (
                        <span className="block text-[10px] text-amber-700 font-normal">
                          {item.placeholderSerials} unit(s) with generated tag — no serial recorded
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {item.brand || '-'} {item.model ? `/ ${item.model}` : ''}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-700">
                      {item.lab.name}
                      {!item.labOperational && (
                        <span className="block text-[10px] font-semibold text-amber-700">Borrowing paused (staff not assigned)</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center font-bold">
                      {item.canManage ? `${item.availableUnits}/${item.totalUnits}` : item.requestable ? item.availableUnits : 0}
                    </td>
                    <td className="py-3 px-4">
                      {item.counts ? (
                        AVAILABILITY_ORDER.filter((a) => item.counts![a] > 0).map((a) => (
                          <AvailabilityBadge key={a} availability={a} count={item.counts![a]} />
                        ))
                      ) : item.requestable ? (
                        <AvailabilityBadge availability="AVAILABLE" />
                      ) : (
                        <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full border bg-slate-100 text-slate-500 border-slate-300">
                          {item.labOperational ? 'NOT AVAILABLE' : 'BORROWING PAUSED'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                      {item.canManage && (
                        <>
                          <button onClick={() => setEditTarget(item)} className="text-xs text-blue-600 hover:underline">
                            Edit
                          </button>
                          <button onClick={() => handleArchiveType(item)} className="text-xs text-slate-500 hover:underline">
                            {item.archived ? 'Restore' : 'Archive'}
                          </button>
                        </>
                      )}
                      {!item.archived && (
                        <button
                          onClick={() => setBorrowItem(item)}
                          disabled={!item.requestable}
                          title={
                            !item.labOperational
                              ? 'Borrowing is paused: this lab has no assigned Coordinator/Technical Officer'
                              : item.availableUnits <= 0
                              ? 'No unit is available to borrow right now'
                              : undefined
                          }
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition hover:cursor-pointer"
                        >
                          {!item.labOperational ? 'Borrowing Paused' : item.availableUnits <= 0 ? 'Not Available' : 'Request Borrow'}
                        </button>
                      )}
                    </td>
                  </tr>

                  {expandedId === item.id && item.canManage && (
                    <tr>
                      <td colSpan={columns} className="bg-slate-50 px-6 py-3">
                        {loadingUnits && !unitsCache[item.id] ? (
                          <p className="text-xs text-slate-500">Loading units...</p>
                        ) : (
                          <UnitsPanel
                            equipment={{ id: item.id, name: item.name }}
                            labId={item.lab.id}
                            units={unitsCache[item.id] || []}
                            highlight={item.unitMatches}
                            onChanged={async () => {
                              await refreshUnits(item.id);
                              loadInventory();
                            }}
                          />
                        )}
                        <p className="text-[10px] text-slate-400 mt-2">
                          Use Edit to correct a serial number, location, dates, remarks, or move a unit entered under the wrong type.
                          Availability (Reserved / Issued) changes only through the borrow workflow.
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showImport && (
        <ImportModal
          labs={manageableLabs.map((l) => ({ id: l.id, name: l.name }))}
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            loadInventory();
          }}
        />
      )}

      {/* Modal: Add units */}
      {addUnitsTarget && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-900">
              Add Units: <span className="text-blue-600">{addUnitsTarget.name}</span>
            </h2>
            <form onSubmit={handleAddUnitsSubmit} className="space-y-3">
              <div>
                <label className={labelCls}>How Many Additional Units?</label>
                <input name="quantity" type="number" min={1} max={200} defaultValue={1} required className={inputCls} />
              </div>
              <SerialsField />
              <UnitDefaultsFields />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setAddUnitsTarget(null)} className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">
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

      {/* Modal: Edit equipment details */}
      {editTarget && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={handleEditSubmit} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Edit Equipment Type</h2>
              <p className="text-xs text-slate-500">
                Name, brand and model apply to all {editTarget.totalUnits} unit(s) of this type. To fix one unit&apos;s serial, expand the row and
                use that unit&apos;s Edit.
              </p>
            </div>
            <div>
              <label className={labelCls}>Equipment Name *</label>
              <input name="name" required defaultValue={editTarget.name} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Brand</label>
                <input name="brand" defaultValue={editTarget.brand ?? ''} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Model</label>
                <input name="model" defaultValue={editTarget.model ?? ''} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Remarks / Notes</label>
              <input name="remarks" defaultValue={editTarget.remarks ?? ''} placeholder="e.g. Procured under 200M grant" className={inputCls} />
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <button type="button" onClick={() => setEditTarget(null)} className="px-4 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={isPending} className="px-4 py-2 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                {isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 1: Add Equipment */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Add Equipment</h2>
              <p className="text-xs text-slate-500">
                Adding many items from an existing sheet? Use <b>Import spreadsheet</b> instead.
              </p>
            </div>
            <form onSubmit={handleCreateSubmit} className="space-y-3">
              <div>
                <label className={labelCls}>Equipment Name *</label>
                <input name="name" required list="equipment-name-suggestions" placeholder="e.g. 2D Lidar" className={inputCls} />
                <datalist id="equipment-name-suggestions">
                  {Array.from(new Set(equipmentList.filter((e) => e.canManage).map((e) => e.name))).map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <p className="text-[10px] text-slate-400 mt-1">
                  If this name already exists in the selected lab, the units are added to that entry (its brand/model must match).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Brand</label>
                  <input name="brand" placeholder="e.g. SLAMTEC" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Model</label>
                  <input name="model" placeholder="e.g. A1 RPLIDAR" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Quantity *</label>
                  <input name="quantity" type="number" defaultValue={1} min={1} max={200} required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Lab *</label>
                  <select name="labId" required className={`${inputCls} bg-white`}>
                    {manageableLabs.map((lab) => (
                      <option key={lab.id} value={lab.id}>
                        {lab.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <SerialsField />
              <UnitDefaultsFields />

              <div>
                <label className={labelCls}>Remarks / Notes (equipment type)</label>
                <input name="remarks" placeholder="e.g. Procured under 200M grant" className={inputCls} />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
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
                  <label className={labelCls}>Borrow Date *</label>
                  <input type="date" name="borrowDate" required min={todayLocal()} defaultValue={todayLocal()} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Expected Return *</label>
                  <input type="date" name="returnDate" required min={todayLocal()} className={inputCls} />
                </div>
              </div>

              <div>
                <label className={labelCls}>Purpose / Notes</label>
                <textarea name="notes" rows={3} placeholder="e.g. Lab Experiment 03 for Telecommunications module" className={inputCls} />
              </div>

              <p className="text-[11px] text-slate-500">
                The lab Coordinator reviews your request. If recommended, a specific unit is reserved for you; collect your handover code from
                the Coordinator and present it to the Technical Officer.
              </p>

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
