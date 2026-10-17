'use client';

// Opens the browser's print dialog. "Save as PDF" there produces the downloadable PDF
// locally, with no PDF library and no network service.
export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition"
    >
      🖨 Print / Save as PDF
    </button>
  );
}
