import React from 'react';
import { Alert, Badge, Button, Stack, Text } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { components } from '../../api/generated/types';
import { prefixRoute } from '../../utils/utils.routing';
import { CreateEntityPanel } from './CreateEntityPanel';
import { getBurnSeverity, getSeverityBadgeColor, getSeverityLabel } from './burnSeverity';

interface Props {
  apiUrl: string;
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  burnEvents: components['schemas']['BurnEvent'][];
  onRefresh: () => Promise<void>;
}

export function ControlPlanePanel({ apiUrl, teams, services, burnEvents, onRefresh }: Props) {
  const activeBurns = burnEvents.filter((b) => b.eventType !== 'burn_resolved').slice(0, 8);

  return (
    <Stack direction="column" gap={2}>
      <Text element="h3">SLO Control Plane</Text>
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
        <Stack direction="row" key={team.id} gap={1}>
          <Text>{team.name}</Text>
          <Button size="sm" variant="secondary" onClick={() => locationService.push(prefixRoute(`team/${team.id}`))}>
            View team
          </Button>
        </Stack>
      ))}

      <Text element="h4">Active burn events</Text>
      {activeBurns.length === 0 && <Text>No active burn events.</Text>}
      {activeBurns.map((burn) => {
        const severity = getBurnSeverity(burn.source);
        return (
          <Stack direction="row" key={burn.id} gap={1}>
            <Badge color={getSeverityBadgeColor(severity)} text={getSeverityLabel(severity)} />
            <Text>{burn.eventType}</Text>
            <Text color="secondary">SLO {burn.sloId}</Text>
          </Stack>
        );
      })}
    </Stack>
  );
}
