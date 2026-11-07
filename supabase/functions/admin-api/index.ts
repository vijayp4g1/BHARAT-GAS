import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * admin-api
 * ---------------------------------------------------------------------------
 * Narrow, authenticated gateway for the few database operations that used to
 * run in the browser with the Supabase service_role key.
 *
 * The service key stays inside this function (injected by Supabase). Callers
 * must present a valid Supabase Auth access token. Authorization is decided
 * here, server-side, from fresh data:
 *
 *   - any authenticated user: read non-sensitive allowlisted tables
 *   - staff  (agents.is_staff = true, or manager): read staff-only tables and
 *            write day-end / settlement / audit / dispatch rows
 *   - manager (app_metadata.role = 'manager' or agents.role = 'MANAGER'):
 *            change agents.is_staff
 *
 * There is intentionally no generic "run any SQL" path and no access to
 * auth.users lists or arbitrary tables.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const fail = (message: string, code = 'FORBIDDEN', status = 200) =>
  json({ data: null, error: { message, code } }, status)

// ---------------------------------------------------------------------------
// Allowlists
// ---------------------------------------------------------------------------

/** Tables any signed-in user may read. */
const READ_TABLES = new Set([
  'agents',
  'audit_logs',
  'agent_locations',
])

/** Tables only staff may read (settlements, reports, customer data). */
const STAFF_READ_TABLES = new Set([
  'day_end_reports',
  'staff_cylinder_settlements',
  'dispatch_items',
  'daily_dispatch',
  'consumers',
  'manager_consumer_summary',
  'consumer_locations',
  'consumer_photos',
  'delivery_notes',
  'refill_orders',
  'tickets',
])

/** Tables staff may write directly through the generic actions. */
const WRITE_TABLES = new Set([
  'day_end_reports',
  'staff_cylinder_settlements',
  'dispatch_items',
])

/** Columns a staff member is allowed to change on the agents table. */
const AGENT_WRITABLE_COLUMNS = new Set(['name', 'phone', 'status'])

/** Agent columns that only a manager may change. */
const AGENT_MANAGER_COLUMNS = new Set(['is_staff', 'role'])

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const COLUMN_LIST = /^[A-Za-z0-9_*,\s]+$/
const FILTER_OPS = new Set(['eq', 'neq', 'ilike', 'like', 'in', 'gt', 'gte', 'lt', 'lte', 'or'])

const MAX_LIMIT = 1000

type Filter = {
  op: string
  column?: string
  value?: unknown
  expression?: string
}

type Caller = {
  userId: string
  email: string | null
  username: string
  name: string | null
  role: string
  is_staff: boolean
  isManager: boolean
  isStaff: boolean
}

const asString = (value: unknown, max = 500): string =>
  typeof value === 'string' ? value.slice(0, max) : ''

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

// ---------------------------------------------------------------------------
// Caller identity + authorization
// ---------------------------------------------------------------------------

async function loadCaller(admin: SupabaseClient, user: Record<string, any>): Promise<Caller> {
  const { data: agent } = await admin
    .from('agents')
    .select('id, name, username, role, is_staff, status')
    .eq('id', user.id)
    .maybeSingle()

  const activeAgent = agent && agent.status !== 'DELETED' ? agent : null
  const appRole = user.app_metadata?.role
  const isManager = appRole === 'manager' || activeAgent?.role === 'MANAGER'
  const email = typeof user.email === 'string' ? user.email : null
  const username = String(activeAgent?.username || (email || '').split('@')[0] || '')
    .toLowerCase()
    .trim()
  const isStaff = isManager || activeAgent?.is_staff === true

  return {
    userId: user.id,
    email,
    username,
    name: activeAgent?.name ?? null,
    role: activeAgent?.role || (isManager ? 'MANAGER' : 'AGENT'),
    is_staff: activeAgent?.is_staff === true,
    isManager,
    isStaff,
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function checkColumn(column: unknown): string {
  if (typeof column !== 'string' || !IDENT.test(column)) {
    throw new Error(`Invalid column name: ${String(column)}`)
  }
  return column
}

function checkColumns(columns: unknown): string {
  const value = typeof columns === 'string' && columns.trim() ? columns.trim() : '*'
  if (!COLUMN_LIST.test(value)) {
    throw new Error('Invalid column list')
  }
  return value
}

function applyFilters(query: any, filters: unknown): any {
  if (filters === undefined || filters === null) return query
  if (!Array.isArray(filters)) throw new Error('filters must be an array')

  let q = query
  for (const filter of filters as Filter[]) {
    if (!filter || typeof filter !== 'object' || typeof filter.op !== 'string') {
      throw new Error('Invalid filter')
    }
    if (!FILTER_OPS.has(filter.op)) {
      throw new Error(`Unsupported filter operator: ${filter.op}`)
    }

    switch (filter.op) {
      case 'eq':
        q = q.eq(checkColumn(filter.column), filter.value)
        break
      case 'neq':
        q = q.neq(checkColumn(filter.column), filter.value)
        break
      case 'ilike':
        q = q.ilike(checkColumn(filter.column), filter.value)
        break
      case 'like':
        q = q.like(checkColumn(filter.column), filter.value)
        break
      case 'gt':
        q = q.gt(checkColumn(filter.column), filter.value)
        break
      case 'gte':
        q = q.gte(checkColumn(filter.column), filter.value)
        break
      case 'lt':
        q = q.lt(checkColumn(filter.column), filter.value)
        break
      case 'lte':
        q = q.lte(checkColumn(filter.column), filter.value)
        break
      case 'in': {
        if (!Array.isArray(filter.value)) throw new Error('in filter requires an array')
        q = q.in(checkColumn(filter.column), filter.value)
        break
      }
      case 'or': {
        const expression = asString(filter.expression, 2000)
        if (!expression) throw new Error('or filter requires an expression')
        q = q.or(expression)
        break
      }
    }
  }
  return q
}

function applyOrder(query: any, order: unknown): any {
  if (order === undefined || order === null) return query
  if (!Array.isArray(order)) throw new Error('order must be an array')

  let q = query
  for (const item of order) {
    if (!item || typeof item !== 'object') throw new Error('Invalid order clause')
    const column = checkColumn((item as any).column)
    q = q.order(column, { ascending: (item as any).ascending !== false })
  }
  return q
}

function applyWindow(query: any, limit: unknown, offset: unknown): any {
  const parsedLimit = Number(limit)
  const parsedOffset = Number(offset)
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(Math.floor(parsedLimit), MAX_LIMIT)
    : MAX_LIMIT
  const safeOffset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? Math.floor(parsedOffset) : 0

  if (safeOffset > 0) {
    return query.range(safeOffset, safeOffset + safeLimit - 1)
  }
  return query.limit(safeLimit)
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleSelect(admin: SupabaseClient, caller: Caller, body: any) {
  const table = asString(body.table, 100)
  if (!READ_TABLES.has(table) && !STAFF_READ_TABLES.has(table)) {
    return fail(`Table not allowed: ${table}`, 'TABLE_NOT_ALLOWED')
  }
  if (STAFF_READ_TABLES.has(table) && !caller.isStaff) {
    return fail('Staff access required', 'FORBIDDEN')
  }

  try {
    let query = admin.from(table).select(checkColumns(body.columns))
    query = applyFilters(query, body.filters)
    query = applyOrder(query, body.order)
    query = applyWindow(query, body.limit, body.offset)

    const { data, error } = await query
    if (error) return fail(error.message, error.code || 'DB_ERROR')
    return json({ data: data ?? [], error: null })
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Query failed', 'BAD_REQUEST')
  }
}

async function handleWrite(admin: SupabaseClient, caller: Caller, action: string, body: any) {
  const table = asString(body.table, 100)
  if (!WRITE_TABLES.has(table)) {
    return fail(`Table not writable: ${table}`, 'TABLE_NOT_ALLOWED')
  }
  if (!caller.isStaff) {
    return fail('Staff access required', 'FORBIDDEN')
  }
  if (action !== 'insert' && (!Array.isArray(body.filters) || body.filters.length === 0)) {
    return fail('update/delete requires at least one filter', 'BAD_REQUEST')
  }

  try {
    let query: any
    const columns = checkColumns(body.columns)

    if (action === 'insert') {
      const values = body.values
      if (!values || (typeof values !== 'object' && !Array.isArray(values))) {
        return fail('values are required', 'BAD_REQUEST')
      }
      query = admin.from(table).insert(values).select(columns)
    } else {
      if (action === 'update') {
        const values = body.values
        if (!values || typeof values !== 'object' || Array.isArray(values)) {
          return fail('values are required', 'BAD_REQUEST')
        }
        query = admin.from(table).update(values)
      } else {
        query = admin.from(table).delete()
      }
      query = applyFilters(query, body.filters)
      query = query.select(columns)
    }

    const { data, error } = await query
    if (error) return fail(error.message, error.code || 'DB_ERROR')
    return json({ data: data ?? [], error: null })
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Write failed', 'BAD_REQUEST')
  }
}

async function handleAgentUpdate(admin: SupabaseClient, caller: Caller, body: any) {
  if (!caller.isStaff) return fail('Staff access required', 'FORBIDDEN')
  if (!Array.isArray(body.filters) || body.filters.length === 0) {
    return fail('agents update requires a filter (id or username)', 'BAD_REQUEST')
  }

  const values = body.values
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return fail('values are required', 'BAD_REQUEST')
  }

  const requestedKeys = Object.keys(values)
  if (requestedKeys.length === 0) return fail('No fields to update', 'BAD_REQUEST')

  const forbidden = requestedKeys.filter(
    (key) => !AGENT_WRITABLE_COLUMNS.has(key) && !AGENT_MANAGER_COLUMNS.has(key)
  )
  if (forbidden.length > 0) {
    return fail(`Fields not allowed: ${forbidden.join(', ')}`, 'FORBIDDEN')
  }

  const managerFieldChanged = requestedKeys.some((key) => AGENT_MANAGER_COLUMNS.has(key))
  if (managerFieldChanged && !caller.isManager) {
    return fail('Only a manager can change staff access or roles', 'FORBIDDEN')
  }

  if ('role' in values && values.role !== 'AGENT' && values.role !== 'MANAGER') {
    return fail('role must be AGENT or MANAGER', 'BAD_REQUEST')
  }
  if ('is_staff' in values && typeof values.is_staff !== 'boolean') {
    return fail('is_staff must be a boolean', 'BAD_REQUEST')
  }

  try {
    let query = admin.from('agents').update(values)
    query = applyFilters(query, body.filters)
    query = query.select(checkColumns(body.columns))

    const { data, error } = await query
    if (error) return fail(error.message, error.code || 'DB_ERROR')
    return json({ data: data ?? [], error: null })
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Update failed', 'BAD_REQUEST')
  }
}

const sanitizeUsername = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 40)

const randomSuffix = (min: number, max: number): number =>
  Math.floor(min + Math.random() * (max - min))

async function handleCreateAgent(admin: SupabaseClient, caller: Caller, body: any) {
  if (!caller.isStaff) return fail('Staff access required', 'FORBIDDEN')

  const name = asString(body.name, 120).trim()
  if (!name) return fail('Agent name is required', 'BAD_REQUEST')

  const requestedRole = asString(body.role, 20).toUpperCase() === 'MANAGER' ? 'MANAGER' : 'AGENT'
  if (requestedRole === 'MANAGER' && !caller.isManager) {
    return fail('Only a manager can create manager accounts', 'FORBIDDEN')
  }

  const phone = asString(body.phone, 30).trim().replace(/\s+/g, '')
  const suppliedPassword = asString(body.password, 200)
  const password = suppliedPassword.length >= 6
    ? suppliedPassword
    : phone.length >= 6
    ? phone
    : '123456'

  const baseUsername = sanitizeUsername(asString(body.username, 60)) ||
    sanitizeUsername(name) ||
    `agent_${randomSuffix(1000, 9999)}`

  let username = baseUsername
  const { data: existing } = await admin
    .from('agents')
    .select('id')
    .eq('username', username)
    .maybeSingle()
  if (existing) {
    username = `${baseUsername}_${randomSuffix(100, 899)}`
  }

  const createAuthUser = async (email: string) =>
    admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

  let email = `${username}@bgcls.local`
  let authUser: { id: string } | null = null

  const first = await createAuthUser(email)
  if (first.error) {
    const message = String(first.error.message || '')
    if (message.includes('already been registered') || message.includes('already exists')) {
      username = `${username}_${randomSuffix(1000, 8999)}`
      email = `${username}@bgcls.local`
      const retry = await createAuthUser(email)
      if (retry.error) {
        return fail(retry.error.message || 'Failed to create agent login', 'AUTH_ERROR')
      }
      authUser = retry.data.user as { id: string }
    } else {
      return fail(first.error.message || 'Failed to create agent login', 'AUTH_ERROR')
    }
  } else {
    authUser = first.data.user as { id: string }
  }

  if (!authUser?.id) {
    return fail('Failed to generate agent user account', 'AUTH_ERROR')
  }

  const { data: agentRow, error: dbError } = await admin
    .from('agents')
    .insert({
      id: authUser.id,
      name,
      username,
      phone: phone || null,
      role: requestedRole,
      status: 'ACTIVE',
      is_staff: false,
    })
    .select()
    .single()

  if (dbError) {
    // Roll back the auth user so a retry does not collide with a ghost login.
    try {
      await admin.auth.admin.deleteUser(authUser.id)
    } catch (_) {
      // best effort
    }
    return fail(dbError.message, dbError.code || 'DB_ERROR')
  }

  return json({ data: agentRow, error: null })
}

async function handleAssignDeliveryBoy(admin: SupabaseClient, caller: Caller, body: any) {
  if (!caller.isStaff) return fail('Staff access required', 'FORBIDDEN')

  const agentId = body.agentId
  if (!isUuid(agentId)) return fail('A valid agent id is required', 'BAD_REQUEST')

  const { data: targetAgent } = await admin
    .from('agents')
    .select('id')
    .eq('id', agentId)
    .maybeSingle()
  if (!targetAgent) return fail('Agent not found', 'NOT_FOUND')

  const normalized = asString(body.deliveryBoyName, 120).trim().toUpperCase()
  const label = normalized || 'UNASSIGNED'

  // 1. Persist on the agent's auth record so their device picks it up.
  try {
    await admin.auth.admin.updateUserById(agentId, {
      user_metadata: { assigned_delivery_boy: normalized },
    })
  } catch (err) {
    console.warn('assign_delivery_boy auth update failed:', err)
  }

  // 2. Append to the audit trail every client reads.
  const { error: logError } = await admin.from('audit_logs').insert({
    action_type: `ASSIGN_DELIVERY_BOY:${label}`,
    entity_id: agentId,
    performed_by: caller.userId,
  })
  if (logError) {
    return fail(logError.message, logError.code || 'DB_ERROR')
  }

  return json({
    data: { agentId, assigned_delivery_boy: normalized },
    error: null,
  })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail('Method not allowed', 'METHOD_NOT_ALLOWED', 405)
  }

  try {
    // New-style secret key (`sb_secret_...`) is independent of the legacy JWT
    // secret, so the leaked `service_role` JWT can be revoked without breaking
    // this function. Fallback keeps older deployments/local dev working.
    const adminKey =
      Deno.env.get('ADMIN_API_KEY') ??
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      ''

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      adminKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return fail('Missing authorization token', 'UNAUTHORIZED', 401)

    const { data: { user }, error: userError } = await admin.auth.getUser(token)
    if (userError || !user) {
      return fail('Invalid or expired session', 'UNAUTHORIZED', 401)
    }

    const caller = await loadCaller(admin, user as Record<string, any>)
    const body = await req.json().catch(() => ({}))
    const action = asString(body.action, 40)

    switch (action) {
      case 'me':
        return json({
          data: {
            userId: caller.userId,
            email: caller.email,
            username: caller.username,
            name: caller.name,
            role: caller.role,
            is_staff: caller.is_staff,
            isManager: caller.isManager,
            isStaff: caller.isStaff,
          },
          error: null,
        })
      case 'select':
        return await handleSelect(admin, caller, body)
      case 'insert':
      case 'update':
      case 'delete':
        if (asString(body.table, 100) === 'agents') {
          if (action !== 'update') return fail('Agents can only be updated here', 'TABLE_NOT_ALLOWED')
          return await handleAgentUpdate(admin, caller, body)
        }
        return await handleWrite(admin, caller, action, body)
      case 'create_agent':
        return await handleCreateAgent(admin, caller, body)
      case 'assign_delivery_boy':
        return await handleAssignDeliveryBoy(admin, caller, body)
      default:
        return fail(`Unknown action: ${action || '(none)'}`, 'BAD_REQUEST')
    }
  } catch (err) {
    console.error('admin-api fatal error:', err)
    return fail(err instanceof Error ? err.message : 'Unexpected server error', 'SERVER_ERROR', 500)
  }
})
