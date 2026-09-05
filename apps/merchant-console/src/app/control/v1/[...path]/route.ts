import { NextResponse, type NextRequest } from "next/server";

const CONTROL_PLANE_URL =
  process.env["CONTROL_PLANE_URL"] ??
  process.env["CONTROL_PLANE_API_URL"] ??
  "https://counter-control-plane-api.fly.dev";

async function forwardRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const upstreamPath = `/control/v1/${path.join("/")}${request.nextUrl.search}`;
  const upstreamUrl = `${CONTROL_PLANE_URL}${upstreamPath}`;

  // Forward ONLY functional headers — deliberately omit `cookie`!
  // Auth0 transaction cookies (__txn_*) and session cookies accumulate on
  // localhost:3000 and easily exceed 8KB-16KB, causing Fly.io / Fastify to
  // reject requests with HTTP 431 (Request Header Fields Too Large).
  // control-plane-api authenticates purely via Authorization: Bearer <token>
  // and never uses cookies.
  const headers: Record<string, string> = {};
  const auth = request.headers.get("authorization");
  if (auth) headers["authorization"] = auth;
  const contentType = request.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  const ifMatch = request.headers.get("if-match");
  if (ifMatch) headers["if-match"] = ifMatch;
  const accept = request.headers.get("accept");
  if (accept) headers["accept"] = accept;

  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.text() : undefined;

  const upstreamResponse = await fetch(upstreamUrl, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });

  const responseHeaders = new Headers();
  const upstreamContentType = upstreamResponse.headers.get("content-type");
  if (upstreamContentType) {
    responseHeaders.set("content-type", upstreamContentType);
  }

  const responseBody = await upstreamResponse.text();
  return new NextResponse(responseBody, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export const GET = forwardRequest;
export const POST = forwardRequest;
export const PATCH = forwardRequest;
export const PUT = forwardRequest;
export const DELETE = forwardRequest;
export const OPTIONS = forwardRequest;
