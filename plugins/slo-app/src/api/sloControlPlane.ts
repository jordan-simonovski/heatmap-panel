import { components } from './generated/types';
import { SLODefinition } from '../sloDefinitions';

type Team = components['schemas']['Team'];
type Service = components['schemas']['Service'];
type SLO = components['schemas']['SLO'];
type BurnEvent = components['schemas']['BurnEvent'];

export class SLOControlPlaneClient {
  constructor(private readonly baseUrl: string) {}

  async listTeams(): Promise<Team[]> {
    const res = await fetch(`${this.baseUrl}/v1/teams`);
    return this.unwrapList<Team>(res);
  }

  async createTeam(payload: components['schemas']['CreateTeamRequest']): Promise<Team> {
    const res = await fetch(`${this.baseUrl}/v1/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return this.unwrapItem<Team>(res);
  }

  async listServices(ownerTeamId?: string): Promise<Service[]> {
    const qs = ownerTeamId ? `?ownerTeamId=${encodeURIComponent(ownerTeamId)}` : '';
    const res = await fetch(`${this.baseUrl}/v1/services${qs}`);
    return this.unwrapList<Service>(res);
  }

  async createService(payload: components['schemas']['CreateServiceRequest']): Promise<Service> {
    const res = await fetch(`${this.baseUrl}/v1/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return this.unwrapItem<Service>(res);
  }

  async listSLOs(serviceId?: string): Promise<SLO[]> {
    const qs = serviceId ? `?serviceId=${encodeURIComponent(serviceId)}` : '';
    const res = await fetch(`${this.baseUrl}/v1/slos${qs}`);
    return this.unwrapList<SLO>(res);
  }

  async createSLO(payload: components['schemas']['CreateSLORequest']): Promise<SLO> {
    const res = await fetch(`${this.baseUrl}/v1/slos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return this.unwrapItem<SLO>(res);
  }

  async listBurnEvents(params?: { serviceId?: string; sloId?: string }): Promise<BurnEvent[]> {
    const queryParts: string[] = [];
    if (params?.serviceId) {
      queryParts.push(`serviceId=${encodeURIComponent(params.serviceId)}`);
    }
    if (params?.sloId) {
      queryParts.push(`sloId=${encodeURIComponent(params.sloId)}`);
    }
    const qs = queryParts.length ? `?${queryParts.join('&')}` : '';
    const res = await fetch(`${this.baseUrl}/v1/burn-events${qs}`);
    return this.unwrapList<BurnEvent>(res);
  }

  private async unwrapList<T>(res: Response): Promise<T[]> {
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const body = await res.json();
    return body.items as T[];
  }

  private async unwrapItem<T>(res: Response): Promise<T> {
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return (await res.json()) as T;
  }
}

export function mapSLOToDefinition(slo: SLO): SLODefinition {
  const canonical = slo.canonical ?? {};
  const parsed = parseOpenSLOIndicator(slo.openslo);

  const type = canonical['type'] === 'error_rate'
    ? 'error_rate'
    : canonical['type'] === 'latency'
      ? 'latency'
      : parsed.type ?? 'latency';
  const route = typeof canonical['route'] === 'string'
    ? canonical['route']
    : parsed.route ?? '/unknown';

  const thresholdMs = numberOr(canonical['thresholdMs'], parsed.threshold ?? 500);
  const thresholdRate = numberOr(canonical['thresholdRate'], parsed.threshold ?? 0.01);

  return {
    id: slo.id,
    name: slo.name,
    route,
    type,
    thresholdMs: type === 'latency' ? thresholdMs : undefined,
    thresholdRate: type === 'error_rate' ? thresholdRate : undefined,
    target: slo.target,
    windowMinutes: slo.windowMinutes,
  };
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function parseOpenSLOIndicator(openslo: string): {
  route?: string;
  type?: 'latency' | 'error_rate';
  threshold?: number;
} {
  const routeMatch = openslo.match(/^\s*route:\s*(.+)\s*$/m);
  const typeMatch = openslo.match(/^\s*type:\s*(.+)\s*$/m);
  const thresholdMatch = openslo.match(/^\s*threshold:\s*([0-9.]+)\s*$/m);

  const route = routeMatch?.[1]?.trim();
  const rawType = typeMatch?.[1]?.trim();
  const type = rawType === 'error_rate' ? 'error_rate' : rawType === 'latency' ? 'latency' : undefined;
  const threshold = thresholdMatch?.[1] ? Number(thresholdMatch[1]) : undefined;

  return {
    route: route || undefined,
    type,
    threshold: Number.isFinite(threshold ?? NaN) ? threshold : undefined,
  };
}
