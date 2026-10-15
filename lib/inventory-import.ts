import type { AssetStatus, ItemCondition } from '@prisma/client';

// Pure helpers shared by the browser (import preview) and the server (validation).
// They map the department's existing inventory spreadsheet columns onto the model.

// Serial cells meaning "no manufacturer serial": the unit gets a generated asset tag.
const NO_SERIAL = /^(n\/?a|none|nil|-+|—|not available|no serial)$/i;

export function normalizeSerial(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || NO_SERIAL.test(text)) return null;
  return text;
}

export function parseAssetStatus(value: string): { value: AssetStatus; remark?: string } | null {
  const text = value.trim().toLowerCase();
  if (!text) return { value: 'RECEIVED' };
  if (/not\s*received|pending|awaiting/.test(text)) return { value: 'NOT_RECEIVED' };
  if (/received/.test(text)) {
    return /remark/.test(text) ? { value: 'RECEIVED', remark: 'Received with remarks' } : { value: 'RECEIVED' };
  }
  return null;
}

export function parseCondition(value: string): ItemCondition | null {
  const text = value.trim().toLowerCase();
  if (!text || /working|good|ok|functional/.test(text)) return 'WORKING';
  if (/repair|maintenance|service/.test(text)) return 'UNDER_REPAIR';
  if (/damag|broken|fault|defect|not working/.test(text)) return 'DAMAGED';
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Accepts "2025-12-03", "2025-12", "December 2025", "Dec 2025", "03/12/2025" (day first).
// Returns 'YYYY-MM-DD' or null. Month-only values become the 1st of that month.
export function parseFlexibleDate(value: string): string | null | 'invalid' {
  const text = value.trim();
  if (!text) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const ok = (y: number, m: number, d: number) => {
    const date = new Date(y, m - 1, d);
    return y > 1950 && y < 2200 && date.getMonth() === m - 1 && date.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : 'invalid';
  };
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text))) return ok(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(text))) return ok(+m[1], +m[2], 1);
  if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text))) return ok(+m[3], +m[2], +m[1]);
  if ((m = /^(\d{1,2})[/.](\d{4})$/.exec(text))) return ok(+m[2], +m[1], 1);
  if ((m = /^([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(text))) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return month >= 0 ? ok(+m[2], month + 1, 1) : 'invalid';
  }
  return 'invalid';
}

// ---------------------------------------------------------------------------
// Spreadsheet column mapping
// ---------------------------------------------------------------------------

export interface ImportRow {
  line: number; // spreadsheet row number, for messages
  name: string;
  status: string;
  serial: string;
  brand: string;
  model: string;
  condition: string;
  location: string;
  purchased: string;
  lastChecked: string;
  remarks: string;
}

type Field = Exclude<keyof ImportRow, 'line'>;

// Header text (lower-case, trimmed) -> field. "Location" alone in the department sheet
// is the owning lab, so it is ignored; "Current location" is the physical location.
const HEADER_MAP: [RegExp, Field | "responsibility"][] = [
  [/^(item|item name|equipment|equipment name|name|description)$/, 'name'],
  [/^(status|asset status|receipt status)$/, 'status'],
  [/^(serial|serial no\.?|serial number|s\/n|sn)$/, 'serial'],
  [/^(brand|make|manufacturer)$/, 'brand'],
  [/^(model|model no\.?|model number)$/, 'model'],
  [/^(condition)$/, 'condition'],
  [/^(current location|storage location|stored at|room)$/, 'location'],
  [/^(date of purchase|purchase date|purchased|date purchased)$/, 'purchased'],
  [/^(last checked|last verified|last check)$/, 'lastChecked'],
  [/^(remarks?|notes?|comments?)$/, 'remarks'],
  [/^(responsibility|responsible|custodian)$/, 'responsibility'], // kept as "Responsibility: …" in remarks
];

export function mapSpreadsheet(table: string[][]): { rows: ImportRow[]; error?: string; ignoredColumns: string[] } {
  // The department sheets have title rows above the header; find the header row.
  const headerIndex = table.slice(0, 20).findIndex((r) =>
    r.some((c) => HEADER_MAP.some(([re, f]) => f === 'name' && re.test(c.trim().toLowerCase())))
  );
  if (headerIndex < 0) {
    return { rows: [], ignoredColumns: [], error: 'Could not find a header row with an "Item" (or "Equipment"/"Name") column.' };
  }
  const header = table[headerIndex].map((c) => c.trim().toLowerCase());
  const columns: (Field | 'responsibility' | null)[] = header.map((h) => HEADER_MAP.find(([re]) => re.test(h))?.[1] ?? null);
  const ignoredColumns = table[headerIndex].filter((h, i) => h.trim() && !columns[i]).map((h) => h.trim());

  const rows: ImportRow[] = [];
  table.slice(headerIndex + 1).forEach((cells, i) => {
    const row: ImportRow = { line: headerIndex + i + 2, name: '', status: '', serial: '', brand: '', model: '', condition: '', location: '', purchased: '', lastChecked: '', remarks: '' };
    columns.forEach((field, c) => {
      const raw = (cells[c] ?? '').trim();
      if (!field || !raw || /^[-—–]+$/.test(raw)) return; // a lone dash means "empty"
      const target: Field = field === 'responsibility' ? 'remarks' : field;
      const value = field === 'responsibility' ? `Responsibility: ${raw}` : raw;
      row[target] = target === 'remarks' && row.remarks ? `${row.remarks}; ${value}` : value;
    });
    if (Object.entries(row).some(([k, v]) => k !== 'line' && v)) rows.push(row);
  });
  return { rows, ignoredColumns };
}

export const IMPORT_TEMPLATE_HEADER = [
  'Item', 'Status', 'Serial Number', 'Brand', 'Model', 'Condition', 'Current location', 'Date of Purchase', 'Last Checked', 'Remarks',
];
