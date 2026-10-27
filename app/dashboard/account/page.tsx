'use client';

import { useEffect, useState, useTransition } from 'react';
import Swal from 'sweetalert2';
import { changePassword, disable2FA, setup2FA, verifyAndEnable2FA } from '@/actions/auth';

interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null);
  const [qr, setQr] = useState<{ qrCodeUrl: string; secret: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setMe(data.user);
        setTwoFactorEnabled(data.user ? Boolean(data.user.twoFactorEnabled) : null);
      });
  }, []);

  function handlePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (data.get('newPassword') !== data.get('confirmPassword')) {
      Swal.fire('Error', 'The new passwords do not match.', 'error');
      return;
    }
    startTransition(async () => {
      const res = await changePassword(String(data.get('currentPassword')), String(data.get('newPassword')));
      if (res.success) {
        form.reset();
        Swal.fire('Saved', res.message, 'success');
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  function startSetup() {
    startTransition(async () => {
      const res = await setup2FA();
      if (res.success) setQr({ qrCodeUrl: res.qrCodeUrl, secret: res.secret });
      else Swal.fire('Error', res.error, 'error');
    });
  }

  function confirmSetup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    startTransition(async () => {
      const res = await verifyAndEnable2FA(code);
      if (res.success) {
        setQr(null);
        setTwoFactorEnabled(true);
        Swal.fire('Enabled', res.message, 'success');
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  async function handleDisable() {
    const result = await Swal.fire({
      title: 'Disable 2FA',
      text: 'Enter a current code from your authenticator app to confirm.',
      input: 'text',
      inputAttributes: { maxlength: '6', inputmode: 'numeric' },
      showCancelButton: true,
      confirmButtonText: 'Disable',
      confirmButtonColor: '#e11d48',
    });
    if (!result.isConfirmed) return;
    startTransition(async () => {
      const res = await disable2FA(String(result.value ?? ''));
      if (res.success) {
        setTwoFactorEnabled(false);
        Swal.fire('Disabled', res.message, 'success');
      } else {
        Swal.fire('Error', res.error, 'error');
      }
    });
  }

  const input = 'w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500';
  const label = 'block text-xs font-semibold text-slate-700 uppercase mb-1';

  return (
    <div className="p-6 max-w-3xl mx-auto font-sans space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Account</h1>
        {me && (
          <p className="text-sm text-slate-600">
            {me.name} · <span className="font-mono">{me.email}</span>
          </p>
        )}
      </div>

      <section className="bg-white border rounded-xl shadow-sm p-5 space-y-3">
        <h2 className="text-base font-bold text-slate-900">Change password</h2>
        <form onSubmit={handlePassword} className="grid gap-3 md:grid-cols-3">
          <div>
            <label className={label}>Current password</label>
            <input name="currentPassword" type="password" required autoComplete="current-password" className={input} />
          </div>
          <div>
            <label className={label}>New password</label>
            <input name="newPassword" type="password" required minLength={8} autoComplete="new-password" className={input} />
          </div>
          <div>
            <label className={label}>Confirm new password</label>
            <input name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" className={input} />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <button type="submit" disabled={isPending} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              Change password
            </button>
          </div>
        </form>
      </section>

      <section className="bg-white border rounded-xl shadow-sm p-5 space-y-3">
        <h2 className="text-base font-bold text-slate-900">Two-factor authentication (2FA)</h2>
        <p className="text-sm text-slate-600">
          Use an authenticator app (Google Authenticator, Microsoft Authenticator, etc.).
        </p>

        {twoFactorEnabled === null ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : twoFactorEnabled ? (
          <div className="flex items-center justify-between">
            <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">ENABLED</span>
            <button onClick={handleDisable} disabled={isPending} className="px-3 py-1.5 text-xs font-medium rounded border border-rose-200 text-rose-700 hover:bg-rose-50">
              Disable 2FA
            </button>
          </div>
        ) : qr ? (
          <form onSubmit={confirmSetup} className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.qrCodeUrl} alt="2FA QR code" className="w-48 h-48 border rounded" />
            <p className="text-xs text-slate-500">
              Can&apos;t scan? Enter this key manually: <span className="font-mono break-all">{qr.secret}</span>
            </p>
            <div className="flex gap-2 items-end">
              <div>
                <label className={label}>6-digit code</label>
                <input name="code" required maxLength={6} inputMode="numeric" autoComplete="one-time-code" className={`${input} font-mono tracking-widest`} />
              </div>
              <button type="submit" disabled={isPending} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                Verify &amp; enable
              </button>
            </div>
          </form>
        ) : (
          <button onClick={startSetup} disabled={isPending} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
            Set up 2FA
          </button>
        )}
      </section>
    </div>
  );
}
