'use client';

import { useState } from 'react';
import { registerUser } from '@/actions/auth';
import Link from 'next/link';

export default function RegisterPage() {
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    const formData = new FormData(e.currentTarget);
    const res = await registerUser({
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    });

    setLoading(false);
    if (!res.success) {
      setError(res.error || 'Failed to register.');
    } else {
      setSuccessMessage(res.message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4 font-sans">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Ruhuna IMS Sign Up</h2>
          <p className="text-sm text-slate-600 mt-1">
            Restricted to <code className="bg-slate-100 px-1 py-0.5 rounded">@eie.ruh.ac.lk</code> and <code className="bg-slate-100 px-1 py-0.5 rounded">@eng.ruh.ac.lk</code> emails.
          </p>
        </div>

        {error && (
          <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-sm font-medium border border-rose-200">
            {error}
          </div>
        )}

        {successMessage ? (
          <div className="bg-amber-50 text-amber-900 p-4 rounded-xl border border-amber-200 space-y-3">
            <div className="text-3xl text-center">⏳</div>
            <h3 className="font-semibold text-lg text-center">Pending Approval</h3>
            <p className="text-sm text-amber-800 text-center leading-relaxed">{successMessage}</p>
            <div className="pt-2">
              <Link
                href="/login"
                className="block text-center w-full py-2 bg-amber-600 text-white font-medium text-sm rounded-lg hover:bg-amber-700 transition"
              >
                Return to Sign In
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Full Name
              </label>
              <input
                name="name"
                required
                placeholder="Kalhara Batangala"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                University Email
              </label>
              <input
                name="email"
                type="email"
                required
                placeholder="kalhara.b@eie.ruh.ac.lk"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Password
              </label>
              <input
                name="password"
                type="password"
                required
                placeholder="••••••••"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating Account...' : 'Register'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link href="/login" className="text-blue-600 font-semibold hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}