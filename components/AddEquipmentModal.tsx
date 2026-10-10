'use client';

import { useState } from 'react';
import { createEquipment } from '@/actions/equipment';
import { AssetStatus, ItemCondition } from '@prisma/client';

interface LabOption {
  id: string;
  name: string;
}

export default function AddEquipmentModal({ labs }: { labs: LabOption[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    
    await createEquipment({
      name: formData.get('name') as string,
      brand: (formData.get('brand') as string) || undefined,
      model: (formData.get('model') as string) || undefined,
      serialNumber: (formData.get('serialNumber') as string) || undefined,
      quantity: parseInt(formData.get('quantity') as string, 10) || 1,
      status: formData.get('status') as AssetStatus,
      condition: formData.get('condition') as ItemCondition,
      labId: formData.get('labId') as string,
      remarks: (formData.get('remarks') as string) || undefined,
    });

    setLoading(false);
    setIsOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors shadow-sm"
      >
        + Add New Equipment
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-lg font-bold text-slate-900">Add Equipment Item</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Item Name *
                </label>
                <input
                  name="name"
                  required
                  placeholder="e.g. Nvidia Jetson Orin Nano"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Brand
                  </label>
                  <input
                    name="brand"
                    placeholder="Nvidia"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Model
                  </label>
                  <input
                    name="model"
                    placeholder="Orin 8GB"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    defaultValue="1"
                    min="1"
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Assign to Lab *
                  </label>
                  <select
                    name="labId"
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {labs.map((lab) => (
                      <option key={lab.id} value={lab.id}>
                        {lab.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Status
                  </label>
                  <select
                    name="status"
                    defaultValue="RECEIVED"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="RECEIVED">RECEIVED</option>
                    <option value="NOT_RECEIVED">NOT_RECEIVED</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Condition
                  </label>
                  <select
                    name="condition"
                    defaultValue="WORKING"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="WORKING">WORKING</option>
                    <option value="DAMAGED">DAMAGED</option>
                    <option value="UNDER_REPAIR">UNDER_REPAIR</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}