import type { DataSource, QueryRequest } from './datasource';
import type { DataFrame, FieldType } from './frame';
import type { Dashboard, DataSourceRef } from './schema';

/**
 * Talks to a Grafana instance's HTTP API with a service-account token.
 * Works with self-hosted Grafana, Grafana Cloud and Amazon Managed Grafana
 * (service accounts are available on AMG workspaces running Grafana 9+).
 *
 * Panel queries go through /api/ds/query, so Grafana runs the PromQL/SQL/CloudWatch
 * query server-side and the app never needs to understand query languages.
 */

export interface GrafanaConfig {
  /** e.g. https://g-abc123.grafana-workspace.us-east-1.amazonaws.com */
  url: string;
  token: string;
  fetch?: typeof fetch;
}

export interface GrafanaSearchHit {
  uid: string;
  title: string;
  type: 'dash-db' | 'dash-folder';
  folderTitle?: string;
  tags: string[];
  url: string;
}

interface FrontendSettings {
  defaultDatasource: string;
  datasources: Record<string, { uid: string; type: string; name: string; isDefault?: boolean }>;
}

interface WireFrame {
  schema?: {
    name?: string;
    refId?: string;
    fields: Array<{ name: string; type?: string; labels?: Record<string, string>; config?: any }>;
  };
  data?: { values: unknown[][] };
}

export class GrafanaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class GrafanaClient {
  private settings?: Promise<FrontendSettings>;
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: GrafanaConfig) {
    this.base = config.url.replace(/\/+$/, '');
    // Browsers throw "Illegal invocation" if fetch is called with a `this` other than window.
    this.doFetch = config.fetch ?? ((input, init) => fetch(input, init));
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.doFetch(`${this.base}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.token}`,
        ...init.headers,
      },
    });
    const body = await res.text();
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        message = JSON.parse(body).message ?? message;
      } catch {}
      throw new GrafanaError(message, res.status);
    }
    return (body ? JSON.parse(body) : undefined) as T;
  }

  /** Returns the signed-in identity; handy as a connection test. */
  user() {
    return this.request<{ login: string; name?: string; orgId: number }>('/api/user');
  }

  search(query = '', options: { tag?: string[]; limit?: number } = {}) {
    const params = new URLSearchParams({ type: 'dash-db', query, limit: String(options.limit ?? 100) });
    options.tag?.forEach((t) => params.append('tag', t));
    return this.request<GrafanaSearchHit[]>(`/api/search?${params}`);
  }

  async dashboard(uid: string): Promise<Dashboard> {
    const res = await this.request<{ dashboard: Dashboard }>(`/api/dashboards/uid/${encodeURIComponent(uid)}`);
    return res.dashboard;
  }

  /** Resolve name / "${DS_X}" placeholder / missing refs to a concrete {type, uid}. */
  async resolveRef(ref: DataSourceRef | undefined): Promise<DataSourceRef> {
    if (ref?.uid && !isPlaceholder(ref.uid) && ref.uid !== 'default') {
      if (ref.type) return ref;
    }
    this.settings ??= this.request<FrontendSettings>('/api/frontend/settings');
    let settings: FrontendSettings;
    try {
      settings = await this.settings;
    } catch (e) {
      this.settings = undefined;
      throw e;
    }
    const all = Object.values(settings.datasources);
    const found =
      (ref?.uid && !isPlaceholder(ref.uid) && all.find((d) => d.uid === ref.uid || d.name === ref.uid)) ||
      (ref?.type && all.find((d) => d.type === ref.type && d.isDefault)) ||
      (ref?.type && all.find((d) => d.type === ref.type)) ||
      settings.datasources[settings.defaultDatasource];
    if (!found) throw new GrafanaError(`No datasource matches ${JSON.stringify(ref)}`);
    return { uid: found.uid, type: found.type };
  }

  async query(request: QueryRequest, signal?: AbortSignal): Promise<DataFrame[]> {
    const queries = await Promise.all(
      request.targets.map(async (t) => ({
        ...t,
        datasource: await this.resolveRef(t.datasource),
        intervalMs: request.intervalMs,
        maxDataPoints: request.maxDataPoints,
      })),
    );
    const res = await this.request<{ results: Record<string, { frames?: WireFrame[]; error?: string; status?: number }> }>(
      '/api/ds/query',
      {
        method: 'POST',
        signal,
        body: JSON.stringify({ queries, from: String(request.range.from), to: String(request.range.to) }),
      },
    );
    const errors = Object.entries(res.results ?? {}).filter(([, r]) => r.error);
    if (errors.length) throw new GrafanaError(errors.map(([refId, r]) => `${refId}: ${r.error}`).join('\n'));
    return Object.values(res.results ?? {}).flatMap((r) => (r.frames ?? []).map(fromWire));
  }
}

/** A DataSource that sends every query to Grafana. One instance serves all of a dashboard's datasources. */
export class GrafanaDataSource implements DataSource {
  constructor(readonly client: GrafanaClient) {}
  query(request: QueryRequest, signal?: AbortSignal) {
    return this.client.query(request, signal);
  }
}

const FIELD_TYPES: FieldType[] = ['time', 'number', 'string', 'boolean'];

export function fromWire(frame: WireFrame): DataFrame {
  const fields = frame.schema?.fields ?? [];
  const values = frame.data?.values ?? [];
  return {
    name: frame.schema?.name,
    refId: frame.schema?.refId,
    fields: fields.map((f, i) => ({
      name: f.name,
      type: FIELD_TYPES.includes(f.type as FieldType) ? (f.type as FieldType) : 'other',
      values: values[i] ?? [],
      labels: f.labels,
      config: f.config,
    })),
  };
}

const isPlaceholder = (uid: string) => uid.startsWith('$');
