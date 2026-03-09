export default function NotificationsPage() {
  const notifications: { id: string; title: string; body: string; time: string; isRead: boolean }[] = []

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Notifications
        </h1>
        {notifications.some((n) => !n.isRead) && (
          <button className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
            Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="mt-16 flex flex-col items-center justify-center text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
            <svg
              className="h-8 w-8 text-zinc-400 dark:text-zinc-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
              />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            You&apos;re all caught up
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Habit reminders and AI insights will appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`flex gap-4 px-5 py-4 ${
                !n.isRead ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : ''
              }`}
            >
              <div
                className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                  !n.isRead ? 'bg-indigo-500' : 'bg-transparent'
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{n.title}</p>
                <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{n.body}</p>
              </div>
              <span className="flex-shrink-0 text-xs text-zinc-400 dark:text-zinc-500">{n.time}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
