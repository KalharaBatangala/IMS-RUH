'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import Swal from 'sweetalert2';
import { getMyNotifications, markNotificationsRead } from '@/actions/notifications';

type NotificationItem = Extract<Awaited<ReturnType<typeof getMyNotifications>>, { success: true }>['data'][number];

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  function applyItems(res: Awaited<ReturnType<typeof getMyNotifications>>) {
    if (res.success) setItems(res.data);
    else Swal.fire('Error', res.error, 'error');
    setLoading(false);
  }

  async function load() {
    setLoading(true);
    applyItems(await getMyNotifications());
  }

  useEffect(() => {
    getMyNotifications().then(applyItems);
  }, []);

  function markAll() {
    startTransition(async () => {
      await markNotificationsRead();
      load();
    });
  }

  function markOne(id: string) {
    startTransition(async () => {
      await markNotificationsRead([id]);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date() } : n)));
    });
  }

  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="p-6 max-w-3xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
          <p className="text-sm text-slate-600">{unread} unread</p>
        </div>
        <button
          onClick={markAll}
          disabled={isPending || unread === 0}
          className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg disabled:opacity-50"
        >
          Mark all as read
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-dashed rounded-xl p-12 text-center text-slate-500 text-sm">No notifications yet.</div>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={`bg-white border rounded-xl p-4 shadow-sm ${n.readAt ? 'border-slate-200' : 'border-blue-300 bg-blue-50/40'}`}
            >
              <div className="flex justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                  <p className="text-sm text-slate-600 mt-0.5">{n.body}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {n.link && (
                    <Link href={n.link} onClick={() => !n.readAt && markOne(n.id)} className="text-xs text-blue-600 font-semibold hover:underline">
                      Open →
                    </Link>
                  )}
                  {!n.readAt && (
                    <button onClick={() => markOne(n.id)} className="text-[11px] text-slate-500 hover:underline">
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
