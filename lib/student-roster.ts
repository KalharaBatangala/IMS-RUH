// Maps an uploaded student list (CSV parsed by lib/csv.ts) to roster rows.
// Shared by the browser (preview) and the server action (which re-validates every row).

export interface RosterRow {
  indexNumber: string;
  name: string;
  email: string;
}

export const ROSTER_TEMPLATE_HEADER = ['Index Number', 'Name', 'Email'];
export const ROSTER_MAX_ROWS = 5000;

function normalizeHeader(cell: string) {
  return cell.toLowerCase().replace(/[^a-z]/g, '');
}

function findColumn(header: string[], test: (h: string) => boolean) {
  return header.findIndex((h) => test(normalizeHeader(h)));
}

// Header row is required; column order does not matter. Accepts e.g. "Index Number",
// "Index No", "Reg No", "Name", "Full Name", "Email", "E-mail".
export function mapRosterSheet(cells: string[][]): { rows: RosterRow[]; error?: string } {
  if (cells.length < 2) return { rows: [], error: 'The file needs a header row and at least one student.' };
  const header = cells[0];
  const indexCol = findColumn(header, (h) => h.startsWith('index') || h.startsWith('regno') || h.startsWith('registration'));
  const nameCol = findColumn(header, (h) => h === 'name' || h === 'fullname' || h === 'studentname' || h === 'nameofstudent');
  const emailCol = findColumn(header, (h) => h.startsWith('email'));

  const missing = [
    indexCol < 0 && 'Index Number',
    nameCol < 0 && 'Name',
    emailCol < 0 && 'Email',
  ].filter(Boolean);
  if (missing.length) return { rows: [], error: `Missing column(s): ${missing.join(', ')}. Expected headers: ${ROSTER_TEMPLATE_HEADER.join(', ')}.` };

  const rows = cells.slice(1).map((r) => ({
    indexNumber: (r[indexCol] ?? '').trim(),
    name: (r[nameCol] ?? '').trim(),
    email: (r[emailCol] ?? '').trim().toLowerCase(),
  }));
  if (rows.length > ROSTER_MAX_ROWS) return { rows: [], error: `At most ${ROSTER_MAX_ROWS} students per file.` };
  return { rows };
}
