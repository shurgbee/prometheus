import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16">
      <h1 className="font-display font-semibold text-3xl text-ink">This page doesn&apos;t exist</h1>
      <Link href="/" className="btn-ghost mt-6">
        Go to the overview
      </Link>
    </div>
  );
}
