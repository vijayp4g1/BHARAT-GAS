import { supabase } from './supabase';

/**
 * staffDb
 * ---------------------------------------------------------------------------
 * A small Supabase-like query builder whose queries are executed by the
 * `admin-api` Edge Function, not by the browser.
 *
 * Why: the old code created a Supabase client with the service_role key in
 * the browser bundle, which exposed full database admin access to anyone who
 * opened devtools. The service key now lives only inside `admin-api`, which
 * verifies the signed-in user and enforces staff/manager rules server-side.
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

async function readFunctionError(error: any): Promise<StaffDbError> {
  const fallback: StaffDbError = {
    message: typeof error?.message === 'string' ? error.message : 'Request failed',
  };

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
      return { data: null, error: await readFunctionError(invokeError) };
    }
    if (response?.error) {
      return { data: null, error: response.error as StaffDbError };
    }

    const rows = response?.data ?? null;

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

    return { data: rows, error: null };
  }
}

export const staffDb = {
  from(table: string): StaffQueryBuilder {
    return new StaffQueryBuilder(table);
  },
};

export type StaffActionName = 'me' | 'create_agent' | 'assign_delivery_boy';

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

  if (invokeError) {
    return { data: null as any, error: await readFunctionError(invokeError) };
  }
  if (response?.error) {
    return { data: null as any, error: response.error as StaffDbError };
  }

  return { data: (response?.data ?? null) as T, error: null };
}
