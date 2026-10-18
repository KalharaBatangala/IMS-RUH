'use client';

import { Suspense, useState } from 'react';
import { loginUser, verify2FALogin } from '@/actions/auth';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState(searchParams.get('error') ?? '');
  const [loading, setLoading] = useState(false);
  const [require2FA, setRequire2FA] = useState(false);
  const [totpToken, setTotpToken] = useState('');
  function goHome() {
    // Full reload so proxy.ts routes by role: staff -> /dashboard, borrowers -> inventory.
    window.location.assign('/login');
  }

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
      setError(res.error);
    } else if (res.require2FA) {
      setRequire2FA(true);
    } else {
      goHome();
    }
  }

  async function handle2FAVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await verify2FALogin(totpToken);
    setLoading(false);

    if (!res.success) {
      setError(res.error);
    } else {
      goHome();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4 font-sans">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            {require2FA ? 'Two-Factor Authentication' : 'Sign in to DEIE Labs'}
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            {require2FA
              ? 'Enter the 6-digit code from your authenticator app'
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
                autoComplete="username"
                placeholder="name@eie.ruh.ac.lk"
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
                autoComplete="current-password"
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
                inputMode="numeric"
                autoComplete="one-time-code"
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
        <p className="text-center text-xs text-slate-400">
          Forgot your password? Contact the system administrator for a temporary password.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
