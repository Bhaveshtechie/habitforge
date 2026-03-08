export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-zinc-950">
      <main className="flex flex-col items-center gap-6 px-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          HabitForge
        </h1>
        <p className="max-w-md text-zinc-600 dark:text-zinc-400">
          Tell it what habit you want to build. It handles the rest.
        </p>
      </main>
    </div>
  );
}
