import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-6 font-sans">
      <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center text-2xl font-bold mb-4">
        🚫
      </div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h1>
      <p className="text-slate-600 max-w-md mb-6 text-sm">
        You do not have permission to access this administration module. If you believe this is an error, please contact the laboratory staff.
      </p>
      <Link
        href="/"
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}