import React from 'react';
import { Alert, Badge, Stack, Text } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { components } from '../../api/generated/types';
import { prefixRoute } from '../../utils/utils.routing';
import { CreateEntityPanel } from './CreateEntityPanel';
import { getBurnSeverity, getSeverityBadgeColor, getSeverityLabel } from './burnSeverity';
import { routeFor } from '../../constants';
import { InvestigationCard } from '../Investigation/InvestigationCard';

interface Props {
  apiUrl: string;
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
  burnEvents: components['schemas']['BurnEvent'][];
  onRefresh: () => Promise<void>;
}

export function ControlPlanePanel({ apiUrl, teams, services, slos, burnEvents, onRefresh }: Props) {
  const activeBurns = burnEvents.filter((b) => b.eventType !== 'burn_resolved').slice(0, 8);
  const serviceById = new Map(services.map((service) => [service.id, service] as const));
  const teamById = new Map(teams.map((team) => [team.id, team] as const));
  const sloById = new Map(slos.map((slo) => [slo.id, slo] as const));

  return (
    <Stack direction="column" gap={2}>
      <Text element="h3">SLO Control Plane</Text>
      <Text color="secondary">Operational actions live here; active RCA paths start in Investigations.</Text>
      <Alert severity="info" title="Backend endpoint">
        <Text>{apiUrl}</Text>
      </Alert>
      <Stack direction="row" gap={1}>
        <Badge color="blue" text={`Teams: ${teams.length}`} />
        <Badge color="green" text={`Services: ${services.length}`} />
        <Badge color="orange" text={`Active burns: ${activeBurns.length}`} />
      </Stack>

      <CreateEntityPanel apiUrl={apiUrl} teams={teams} services={services} onRefresh={onRefresh} />

      <Text element="h4">Teams</Text>
      {teams.slice(0, 10).map((team) => (
        <InvestigationCard
          key={team.id}
          compact
          title={team.name}
          badges={[{ color: 'blue', text: 'Team' }]}
          primaryAction={{ label: 'Open team', onClick: () => locationService.push(prefixRoute(routeFor.team(team.id))) }}
        />
      ))}

      <Text element="h4">Active burn events</Text>
      {activeBurns.length === 0 && <Text>No active burn events.</Text>}
      {activeBurns.map((burn) => {
        const severity = getBurnSeverity(burn.source);
        const slo = sloById.get(burn.sloId);
        const service = slo ? serviceById.get(slo.serviceId) : undefined;
        const team = service ? teamById.get(service.ownerTeamId) : undefined;
        return (
          <InvestigationCard
            key={burn.id}
            compact
            title={slo ? slo.runtime.name : burn.sloId}
            summary={`${burn.eventType}${service ? ` | Service: ${service.name}` : ''}${team ? ` | Team: ${team.name}` : ''}`}
            badges={[{ color: getSeverityBadgeColor(severity), text: getSeverityLabel(severity) }]}
            primaryAction={{
              label: 'Investigate SLO',
              onClick: () => locationService.push(prefixRoute(routeFor.slo(burn.sloId))),
            }}
          />
        );
      })}
    </Stack>
  );
}
