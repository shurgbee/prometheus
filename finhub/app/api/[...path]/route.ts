import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, { params }: { params: { path: string[] } }) {
  if (params.path[0] === "internal") return Response.json({ detail: "Not found" }, { status: 404 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") || request.nextUrl.host;
  if (origin && !["GET", "HEAD"].includes(request.method)) {
    let sameHost = false;
    try { sameHost = new URL(origin).host === host; } catch { /* Opaque origins are not trusted. */ }
    if (!sameHost) return Response.json({ detail: "Cross-origin mutation denied" }, { status: 403 });
  }
  const token = process.env.BACKEND_API_TOKEN || process.env.API_TOKEN;
  if (!token) return Response.json({ detail: "Configure BACKEND_API_TOKEN on the app server, or use the root dev launcher." }, { status: 503 });
  const base = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
  const url = `${base}/api/${params.path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  const headers = new Headers({ Authorization: `Bearer ${token}`, Accept: request.headers.get("accept") || "application/json" });
  for (const name of ["content-type", "last-event-id"]) {
    const value = request.headers.get(name); if (value) headers.set(name, value);
  }
  try {
    const upstream = await fetch(url, { method: request.method, headers, cache: "no-store", redirect: "manual",
      signal: request.signal,
      ...(!["GET", "HEAD"].includes(request.method) ? { body: await request.arrayBuffer() } : {}) });
    const responseHeaders = new Headers({ "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    responseHeaders.set("Content-Type", upstream.headers.get("content-type") || "application/json");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ detail: "The backend is unavailable. Start FastAPI and check BACKEND_URL." }, { status: 502 });
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
