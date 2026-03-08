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

  async listServices(): Promise<Service[]> {
    const res = await fetch(`${this.baseUrl}/v1/services`);
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

  async listSLOs(): Promise<SLO[]> {
    const res = await fetch(`${this.baseUrl}/v1/slos`);
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

  async listBurnEvents(): Promise<BurnEvent[]> {
    const res = await fetch(`${this.baseUrl}/v1/burn-events`);
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
  const type = canonical['type'] === 'error_rate' ? 'error_rate' : 'latency';
  const route = typeof canonical['route'] === 'string' ? canonical['route'] : '/unknown';
  const thresholdMs = numberOr(canonical['thresholdMs'], 500);
  const thresholdRate = numberOr(canonical['thresholdRate'], 0.01);

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
