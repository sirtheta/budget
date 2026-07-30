import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

const log = logger.child({ module: "health" });

/**
 * Liveness/readiness probe for the container healthcheck.
 *
 * It deliberately touches the database. The previous healthcheck probed
 * `/api/auth/session`, which answers an anonymous request straight from the
 * JWT layer without opening SQLite — so a database that was corrupt, missing,
 * or on a volume that failed to mount still reported the container healthy,
 * which is precisely the failure a healthcheck exists to catch.
 *
 * Counting users rather than running `SELECT 1` is what makes this a readiness
 * check: it only succeeds once the migrations have created the schema, so a
 * container still applying them isn't advertised as ready.
 *
 * The body stays deliberately thin — this endpoint is reachable without a
 * session, so it must not become a way to fingerprint the instance. Failure
 * details go to the log, where an operator can see them, and not to the caller.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.user.count();
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    log.error({ err }, "Health check failed");
    return NextResponse.json(
      { status: "error" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
