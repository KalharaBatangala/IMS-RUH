'use client';

import { useState } from 'react';
import { loginUser, verify2FALogin } from '@/actions/auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [require2FA, setRequire2FA] = useState(false);
  const [totpToken, setTotpToken] = useState('');
  const router = useRouter();

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    const res = await loginUser({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    });

    setLoading(false);
    if (!res.success) {
      setError(res.error || 'Login failed.');
    } else if (res.require2FA) {
      setRequire2FA(true);
    } else {
      router.push('/');
      router.refresh();
    }
  }

  async function handle2FAVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await verify2FALogin(totpToken);
    setLoading(false);

    if (!res.success) {
      setError(res.error || 'Invalid 2FA code.');
    } else {
      router.push('/');
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4 font-sans">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            {require2FA ? 'Two-Factor Authentication' : 'Ruhuna IMS Login'}
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            {require2FA
              ? 'Enter the 6-digit code from Google Authenticator'
              : 'Sign in with your University credentials'}
          </p>
        </div>

        {error && (
          <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-sm font-medium border border-rose-200">
            {error}
          </div>
        )}

        {!require2FA ? (
          <form onSubmit={handleLogin} className="space-y-4">
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
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handle2FAVerify} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Authenticator Code
              </label>
              <input
                value={totpToken}
                onChange={(e) => setTotpToken(e.target.value)}
                maxLength={6}
                required
                placeholder="123456"
                className="w-full px-3 py-2 text-center text-xl tracking-widest border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify 2FA'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-slate-600">
          Need an account?{' '}
          <Link href="/register" className="text-blue-600 font-semibold hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}