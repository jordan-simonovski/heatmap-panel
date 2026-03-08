import { components } from './generated/types';
import { SLODefinition } from '../sloDefinitions';

type Team = components['schemas']['Team'];
type Service = components['schemas']['Service'];
type SLO = components['schemas']['SLO'];
type BurnEvent = components['schemas']['BurnEvent'];
type AlertState = components['schemas']['AlertState'];

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

  async getSLOAlertStatus(sloId: string): Promise<AlertState[]> {
    const res = await fetch(`${this.baseUrl}/v1/slos/${encodeURIComponent(sloId)}/alert-status`);
    return this.unwrapList<AlertState>(res);
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
  const runtime = slo.runtime;
  const type = runtime.type === 'error_rate' ? 'error_rate' : 'latency';
  const route = runtime.route;
  const thresholdMs = type === 'latency' ? runtime.threshold : 500;
  const thresholdRate = type === 'error_rate' ? runtime.threshold : 0.01;

  return {
    id: slo.id,
    name: runtime.name,
    description: runtime.description ?? undefined,
    userExperience: runtime.userExperience ?? undefined,
    route,
    type,
    thresholdMs: type === 'latency' ? thresholdMs : undefined,
    thresholdRate: type === 'error_rate' ? thresholdRate : undefined,
    target: runtime.target,
    windowMinutes: runtime.windowMinutes,
    openslo: slo.openslo,
    datasourceUid: runtime.datasourceUid,
    datasourceType: runtime.datasourceType,
  };
}
