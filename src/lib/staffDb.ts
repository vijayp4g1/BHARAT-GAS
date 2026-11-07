import { supabase } from './supabase';

/**
 * staffDb
 * ---------------------------------------------------------------------------
 * A small Supabase-like query builder whose queries are normally executed by
 * the `admin-api` Edge Function, not by the browser.
 *
 * Why: the old code created a Supabase client with the service_role key in
 * the browser bundle, which exposed full database admin access to anyone who
 * opened devtools. The service key now lives only inside `admin-api`, which
 * verifies the signed-in user and enforces staff/manager rules server-side.
 *
 * Resilience: if `admin-api` is not deployed (or the platform returns 404),
 * every query transparently degrades to a direct PostgREST request made with
 * the signed-in user's JWT. That is the same trust level as before the
 * refactor (RLS still applies) and keeps staff screens syncing instead of
 * silently returning empty data.
 *
 * Supported chain: select, insert, update, delete, eq, neq, ilike, like, in,
 * gt, gte, lt, lte, or, order, limit, range, maybeSingle, single.
 */

const FUNCTION_NAME = 'admin-api';

export interface StaffDbError {
  message: string;
  code?: string;
}

export interface StaffDbResult<T = any> {
  data: T | null;
  error: StaffDbError | null;
}

type SingleMode = 'one' | 'maybe' | null;

let warnedMissingFunction = false;

/**
 * The Edge Function is considered missing when Supabase answers 404 (function
 * not deployed) or the request never reached a function runtime.
 */
function isMissingFunctionError(error: StaffDbError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'NOT_FOUND' || error.code === 'FUNCTION_MISSING') return true;
  const message = (error.message || '').toLowerCase();
  return (
    message.includes('requested function was not found') ||
    message.includes('failed to send a request to the edge function') ||
    (message.includes('function') && message.includes('not found'))
  );
}

function warnMissingFunction() {
  if (warnedMissingFunction) return;
  warnedMissingFunction = true;
  console.error(
    '[bgcls] The admin-api Edge Function is not deployed, so privileged queries ' +
      'are falling back to direct Supabase requests (RLS still applies). ' +
      'Deploy it with: npx supabase functions deploy admin-api'
  );
}

async function readFunctionError(error: any): Promise<StaffDbError> {
  const fallback: StaffDbError = {
    message: typeof error?.message === 'string' ? error.message : 'Request failed',
  };

  // supabase-js attaches the raw Response under `context`.
  const context = error?.context;
  if (context && typeof context.json === 'function') {
    try {
      const payload = await context.json();
      if (payload?.error?.message) {
        return { message: payload.error.message, code: payload.error.code };
      }
      if (typeof payload?.message === 'string') {
        return { message: payload.message, code: payload.code };
      }
    } catch (_) {
      // Fall back to the transport error message below.
    }
  }

  const status = Number(error?.context?.status || error?.status || 0);
  if (status === 404) return { message: fallback.message, code: 'NOT_FOUND' };

  return fallback;
}

class StaffQueryBuilder implements PromiseLike<StaffDbResult<any>> {
  private readonly table: string;
  private action: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private columns = '*';
  private filters: Array<Record<string, unknown>> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitValue?: number;
  private offsetValue?: number;
  private values: unknown;
  private singleMode: SingleMode = null;

  constructor(table: string) {
    this.table = table;
  }

  select(columns = '*'): this {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ op: 'eq', column, value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ op: 'neq', column, value });
    return this;
  }

  ilike(column: string, value: unknown): this {
    this.filters.push({ op: 'ilike', column, value });
    return this;
  }

  like(column: string, value: unknown): this {
    this.filters.push({ op: 'like', column, value });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ op: 'gt', column, value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ op: 'gte', column, value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ op: 'lt', column, value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ op: 'lte', column, value });
    return this;
  }

  in(column: string, value: unknown[]): this {
    this.filters.push({ op: 'in', column, value });
    return this;
  }

  or(expression: string): this {
    this.filters.push({ op: 'or', expression });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetValue = from;
    this.limitValue = to - from + 1;
    return this;
  }

  insert(values: unknown): this {
    this.action = 'insert';
    this.values = values;
    return this;
  }

  update(values: unknown): this {
    this.action = 'update';
    this.values = values;
    return this;
  }

  delete(): this {
    this.action = 'delete';
    return this;
  }

  maybeSingle(): Promise<StaffDbResult<any>> {
    this.singleMode = 'maybe';
    return this.execute();
  }

  single(): Promise<StaffDbResult<any>> {
    this.singleMode = 'one';
    return this.execute();
  }

  then<TResult1 = StaffDbResult<any>, TResult2 = never>(
    onfulfilled?: ((value: StaffDbResult<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private shape(rows: any): StaffDbResult<any> {
    if (this.singleMode === 'one') {
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row === undefined || row === null) {
        return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
      }
      return { data: row, error: null };
    }

    if (this.singleMode === 'maybe') {
      const row = Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
      return { data: row, error: null };
    }

    return { data: rows ?? null, error: null };
  }

  /** Same query, executed by PostgREST with the caller's own JWT. */
  private async executeFallback(): Promise<StaffDbResult<any>> {
    try {
      let query: any = supabase.from(this.table);

      if (this.action === 'select') {
        query = query.select(this.columns);
      } else if (this.action === 'insert') {
        query = query.insert(this.values).select(this.columns);
      } else if (this.action === 'update') {
        query = query.update(this.values).select(this.columns);
      } else {
        query = query.delete().select(this.columns);
      }

      for (const filter of this.filters) {
        const op = String(filter.op);
        if (op === 'or') {
          query = query.or(String(filter.expression));
        } else if (op === 'in') {
          query = query.in(String(filter.column), filter.value as unknown[]);
        } else {
          query = query[op](String(filter.column), filter.value);
        }
      }

      for (const ord of this.orders) {
        query = query.order(ord.column, { ascending: ord.ascending });
      }

      if (this.offsetValue !== undefined) {
        const size = this.limitValue ?? 1000;
        query = query.range(this.offsetValue, this.offsetValue + size - 1);
      } else if (this.limitValue !== undefined) {
        query = query.limit(this.limitValue);
      }

      const { data, error } = await query;
      if (error) {
        return { data: null, error: { message: error.message, code: error.code } };
      }
      return this.shape(data);
    } catch (err: any) {
      return { data: null, error: { message: err?.message || 'Direct query failed' } };
    }
  }

  private async execute(): Promise<StaffDbResult<any>> {
    const body: Record<string, unknown> = {
      action: this.action,
      table: this.table,
      columns: this.columns,
    };

    if (this.filters.length > 0) body.filters = this.filters;
    if (this.orders.length > 0) body.order = this.orders;
    if (this.limitValue !== undefined) body.limit = this.limitValue;
    if (this.offsetValue !== undefined) body.offset = this.offsetValue;
    if (this.action === 'insert' || this.action === 'update') body.values = this.values;

    let response: any = null;
    let invokeError: any = null;

    try {
      const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body });
      response = data;
      invokeError = error;
    } catch (err) {
      invokeError = err;
    }

    if (invokeError) {
      const error = await readFunctionError(invokeError);
      if (isMissingFunctionError(error)) {
        warnMissingFunction();
        return this.executeFallback();
      }
      return { data: null, error };
    }
    if (response?.error) {
      if (isMissingFunctionError(response.error as StaffDbError)) {
        warnMissingFunction();
        return this.executeFallback();
      }
      return { data: null, error: response.error as StaffDbError };
    }

    return this.shape(response?.data ?? null);
  }
}

export const staffDb = {
  from(table: string): StaffQueryBuilder {
    return new StaffQueryBuilder(table);
  },
};

export type StaffActionName = 'me' | 'create_agent' | 'assign_delivery_boy';

async function fallbackIdentity(): Promise<StaffDbResult<any>> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      return { data: null, error: { message: 'Not signed in', code: 'UNAUTHORIZED' } };
    }

    const { data: agent, error } = await supabase
      .from('agents')
      .select('id, name, username, role, is_staff, status')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      return { data: null, error: { message: error.message, code: error.code } };
    }

    const activeAgent = agent && agent.status !== 'DELETED' ? agent : null;
    const appRole = (user.app_metadata as Record<string, any> | undefined)?.role;
    const isManager = appRole === 'manager' || activeAgent?.role === 'MANAGER';
    const email = typeof user.email === 'string' ? user.email : null;
    const username = String(activeAgent?.username || (email || '').split('@')[0] || '')
      .toLowerCase()
      .trim();

    return {
      data: {
        userId: user.id,
        email,
        username,
        name: activeAgent?.name ?? null,
        role: activeAgent?.role || (isManager ? 'MANAGER' : 'AGENT'),
        is_staff: activeAgent?.is_staff === true,
        isManager,
        isStaff: isManager || activeAgent?.is_staff === true,
      },
      error: null,
    };
  } catch (err: any) {
    return { data: null, error: { message: err?.message || 'Identity lookup failed' } };
  }
}

export async function staffAction<T = any>(
  action: StaffActionName,
  payload: Record<string, unknown> = {}
): Promise<StaffDbResult<T>> {
  let response: any = null;
  let invokeError: any = null;

  try {
    const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
      body: { action, ...payload },
    });
    response = data;
    invokeError = error;
  } catch (err) {
    invokeError = err;
  }

  const handleMissing = async (): Promise<StaffDbResult<T>> => {
    warnMissingFunction();

    if (action === 'me') {
      return (await fallbackIdentity()) as StaffDbResult<T>;
    }

    if (action === 'assign_delivery_boy') {
      // The auth-metadata update needs the service key, but the audit row is
      // what every device reads to rebuild the assignment map, so write it
      // directly. If RLS blocks it the caller gets a real error below.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          return { data: null, error: { message: 'Not signed in', code: 'UNAUTHORIZED' } };
        }
        const agentId = typeof payload.agentId === 'string' ? payload.agentId : '';
        const normalized = String(payload.deliveryBoyName || '').trim().toUpperCase();
        const { error } = await supabase.from('audit_logs').insert({
          action_type: `ASSIGN_DELIVERY_BOY:${normalized || 'UNASSIGNED'}`,
          entity_id: agentId,
          performed_by: session.user.id,
        });
        if (error) {
          return { data: null, error: { message: error.message, code: error.code } };
        }
        return {
          data: { agentId, assigned_delivery_boy: normalized } as unknown as T,
          error: null,
        };
      } catch (err: any) {
        return { data: null, error: { message: err?.message || 'Assignment failed' } };
      }
    }

    return {
      data: null,
      error: {
        message:
          'admin-api is not deployed, so this action is unavailable. ' +
          'Run: npx supabase functions deploy admin-api',
        code: 'FUNCTION_MISSING',
      },
    };
  };

  if (invokeError) {
    const error = await readFunctionError(invokeError);
    if (isMissingFunctionError(error)) return handleMissing();
    return { data: null as any, error };
  }
  if (response?.error) {
    if (isMissingFunctionError(response.error as StaffDbError)) return handleMissing();
    return { data: null as any, error: response.error as StaffDbError };
  }

  return { data: (response?.data ?? null) as T, error: null };
}
