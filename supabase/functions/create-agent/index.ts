/**
 * DEPRECATED / DISABLED
 * ---------------------------------------------------------------------------
 * This function used to create agent logins with the service_role key. It was
 * reachable by any signed-up account, so it has been disabled.
 *
 * Privileged agent creation now lives in `admin-api`, which verifies the
 * caller and requires staff/manager privileges server-side.
 *
 * The deployed stub intentionally returns 410 so old clients fail closed.
 */
Deno.serve(() =>
  new Response(
    JSON.stringify({
      error: {
        message: 'This endpoint is disabled. Use the admin-api Edge Function.',
        code: 'GONE',
      },
    }),
    { status: 410, headers: { 'Content-Type': 'application/json' } }
  )
)
