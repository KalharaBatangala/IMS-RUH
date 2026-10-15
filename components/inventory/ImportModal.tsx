'use client';

import { useState, useTransition } from 'react';
import Swal from 'sweetalert2';
import { importEquipment } from '@/actions/equipment';
import { parseCsv, toCsv } from '@/lib/csv';
import { IMPORT_TEMPLATE_HEADER, mapSpreadsheet, type ImportRow } from '@/lib/inventory-import';

type Preview = Extract<Awaited<ReturnType<typeof importEquipment>>, { success: true }>['data'];

export function downloadCsv(filename: string, rows: unknown[][]) {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }); // BOM so Excel reads UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportModal({
  labs,
  onClose,
  onImported,
}: {
  labs: { id: string; name: string }[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [labId, setLabId] = useState(labs[0]?.id ?? '');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [ignored, setIgnored] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [isPending, startTransition] = useTransition();

  function check(nextRows: ImportRow[], nextLab: string) {
    if (!nextRows.length || !nextLab) return;
    startTransition(async () => {
      const res = await importEquipment({ labId: nextLab, rows: nextRows, commit: false });
      if (res.success) setPreview(res.data);
      else Swal.fire('Error', res.error, 'error');
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPreview(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      Swal.fire('CSV needed', 'In Excel or Google Sheets use File → Download / Save As → "CSV (comma separated)", then choose that file.', 'info');
      e.target.value = '';
      return;
    }
    const mapped = mapSpreadsheet(parseCsv(await file.text()));
    if (mapped.error) {
      Swal.fire('Could not read the sheet', mapped.error, 'error');
      return;
    }
    setFileName(file.name);
    setRows(mapped.rows);
    setIgnored(mapped.ignoredColumns);
    check(mapped.rows, labId);
  }

  function commit() {
    startTransition(async () => {
      const res = await importEquipment({ labId, rows, commit: true });
      if (res.success) {
        const s = res.data.summary;
        await Swal.fire(
          'Imported',
          `${s.rows} unit(s) imported: ${s.newTypes} new equipment type(s), ${s.existingTypes} existing type(s) extended, ${s.generatedTags} generated asset tag(s).`,
          'success'
        );
        onImported();
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  const errors = preview?.summary.errorRows ?? 0;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-5xl shadow-2xl space-y-4 max-h-[92vh] flex flex-col">
        <div className="flex justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Import equipment from a spreadsheet</h2>
            <p className="text-xs text-slate-500 mt-1">
              Save the lab&apos;s sheet as <b>CSV</b>. Recognised columns: Item, Status, Serial Number, Brand, Model, Condition, Current location,
              Date of Purchase, Last Checked, Remarks, Responsibility. Title rows above the header are skipped. Each row is one physical unit;
              rows with the same Item name become one equipment type. Nothing is saved until you confirm.
            </p>
          </div>
          <button
            type="button"
            onClick={() => downloadCsv('equipment-import-template.csv', [IMPORT_TEMPLATE_HEADER, ['2D Lidar', 'Received', '02785A3WL252402274', 'SLAMTEC', 'A1 RPLIDAR', 'Working', 'Stores Room', 'December 2025', '', '']])}
            className="text-xs text-blue-600 font-semibold hover:underline whitespace-nowrap self-start"
          >
            Download template
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Laboratory *</label>
            <select
              value={labId}
              onChange={(e) => {
                setLabId(e.target.value);
                check(rows, e.target.value);
              }}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-white outline-none"
            >
              {labs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">CSV file *</label>
            <input type="file" accept=".csv,text/csv" onChange={handleFile} className="w-full text-sm" />
          </div>
        </div>

        {fileName && ignored.length > 0 && (
          <p className="text-[11px] text-slate-500">Columns not imported: {ignored.join(', ')}</p>
        )}

        {isPending && !preview && <p className="text-sm text-slate-500">Checking rows…</p>}

        {preview && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-slate-100">{preview.summary.rows} units</span>
              <span className="px-2 py-1 rounded bg-blue-50 text-blue-700">{preview.summary.newTypes} new types</span>
              <span className="px-2 py-1 rounded bg-blue-50 text-blue-700">{preview.summary.existingTypes} existing types</span>
              <span className="px-2 py-1 rounded bg-amber-50 text-amber-700">{preview.summary.generatedTags} without serial (tag generated)</span>
              <span className={`px-2 py-1 rounded ${errors ? 'bg-rose-50 text-rose-700 font-semibold' : 'bg-emerald-50 text-emerald-700'}`}>
                {errors ? `${errors} row(s) with errors` : 'No errors'}
              </span>
            </div>
            <div className="overflow-auto border rounded-lg flex-1 min-h-0">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] sticky top-0">
                  <tr>
                    <th className="py-2 px-2 text-left">Row</th>
                    <th className="py-2 px-2 text-left">Item → type</th>
                    <th className="py-2 px-2 text-left">Serial</th>
                    <th className="py-2 px-2 text-left">Brand / Model</th>
                    <th className="py-2 px-2 text-left">Status / Condition</th>
                    <th className="py-2 px-2 text-left">Location</th>
                    <th className="py-2 px-2 text-left">Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className={`border-t align-top ${r.errors.length ? 'bg-rose-50' : ''}`}>
                      <td className="py-1.5 px-2 text-slate-400">{r.line}</td>
                      <td className="py-1.5 px-2">
                        {r.name || <i className="text-slate-400">missing</i>}
                        <span className={`block text-[10px] font-semibold ${r.typeAction === 'NEW_TYPE' ? 'text-blue-600' : 'text-slate-500'}`}>
                          {r.typeAction === 'NEW_TYPE' ? 'new type' : `adds to "${r.typeName}"`}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 font-mono">{r.serial ?? <i className="text-amber-700 font-sans">generated</i>}</td>
                      <td className="py-1.5 px-2">{[r.brand, r.model].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="py-1.5 px-2">
                        {r.assetStatus === 'RECEIVED' ? 'Received' : 'Not received'} · {r.condition}
                      </td>
                      <td className="py-1.5 px-2">{r.location ?? '—'}</td>
                      <td className="py-1.5 px-2">
                        {r.errors.map((m, i) => (
                          <div key={i} className="text-rose-700 font-medium">✖ {m}</div>
                        ))}
                        {r.warnings.map((m, i) => (
                          <div key={i} className="text-amber-700">• {m}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!preview || errors > 0 || isPending}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending && preview ? 'Importing…' : `Import ${preview?.summary.rows ?? ''} unit(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
