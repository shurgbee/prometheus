"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="py-16" role="alert">
      <h1 className="font-display font-semibold text-3xl text-ink">Something broke on this page</h1>
      <p className="mt-2 max-w-prose text-ink-2">{error.message || "An unexpected error happened."}</p>
      <button onClick={reset} className="btn-ghost mt-6">
        Reload this section
      </button>
    </div>
  );
}
