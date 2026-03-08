import React from 'react';
import { EmbeddedScene, SceneAppPage, SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Stack, Text, Button, Badge, Alert } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';
import { components } from '../../api/generated/types';
import { CreateEntityPanel } from '../../components/ControlPlane/CreateEntityPanel';
import { getBurnSeverity, getSeverityBadgeColor, getSeverityLabel } from '../../components/ControlPlane/burnSeverity';

interface OverviewBodyState extends SceneObjectState {
  apiUrl: string;
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
  burnEvents: components['schemas']['BurnEvent'][];
  onRefresh: () => Promise<void>;
}

class OverviewBody extends SceneObjectBase<OverviewBodyState> {
  static Component = ({ model }: SceneComponentProps<OverviewBody>) => {
    const state = model.useState();
    const teamById = new Map(state.teams.map((team) => [team.id, team] as const));
    const serviceById = new Map(state.services.map((service) => [service.id, service] as const));
    const sloById = new Map(state.slos.map((slo) => [slo.id, slo] as const));
    const activeBurns = state.burnEvents.filter((b) => b.eventType !== 'burn_resolved').slice(0, 8);
    const teams = state.teams.slice(0, 8);
    const services = state.services.slice(0, 8);
    const slos = state.slos.slice(0, 8);

    return (
      <Stack direction="column" gap={2}>
        <Text element="h3">SLO Dashboard</Text>
        <CreateEntityPanel apiUrl={state.apiUrl} teams={state.teams} services={state.services} onRefresh={state.onRefresh} />
        <Alert title="At a glance" severity="info">
          <Stack direction="row" gap={1}>
            <Badge color="blue" text={`Teams: ${state.teams.length}`} />
            <Badge color="green" text={`SLOs: ${state.slos.length}`} />
            <Badge color="orange" text={`Active burns: ${activeBurns.length}`} />
          </Stack>
        </Alert>

        <Stack direction="column" gap={1}>
          <Text element="h4">Teams</Text>
          {teams.length === 0 && <Text>No teams yet.</Text>}
          {teams.map((team) => (
            <Stack direction="row" key={team.id} gap={1}>
              <Button size="sm" onClick={() => locationService.push(prefixRoute(`team/${team.id}`))} variant="secondary">
                {team.name}
              </Button>
            </Stack>
          ))}
        </Stack>

        <Stack direction="column" gap={1}>
          <Text element="h4">Services</Text>
          {services.length === 0 && <Text>No services yet.</Text>}
          {services.map((service) => (
            <Stack direction="row" key={service.id} gap={1}>
              <Button
                size="sm"
                onClick={() => locationService.push(prefixRoute(`service/${service.id}`))}
                variant="secondary"
              >
                {service.name}
              </Button>
              {teamById.get(service.ownerTeamId) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => locationService.push(prefixRoute(`team/${service.ownerTeamId}`))}
                >
                  Team: {teamById.get(service.ownerTeamId)?.name}
                </Button>
              )}
            </Stack>
          ))}
        </Stack>

        <Stack direction="column" gap={1}>
          <Text element="h4">SLOs</Text>
          {slos.length === 0 && <Text>No SLOs yet.</Text>}
          {slos.map((slo) => (
            <Stack direction="row" key={slo.id} gap={1}>
              <Button size="sm" onClick={() => locationService.push(prefixRoute(`slo/${slo.id}`))} variant="secondary">
                {slo.name}
              </Button>
              {serviceById.get(slo.serviceId) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => locationService.push(prefixRoute(`service/${slo.serviceId}`))}
                >
                  Service: {serviceById.get(slo.serviceId)?.name}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => locationService.push(prefixRoute(`slo/${slo.id}`))}
                variant="secondary"
              >
                Open SLO
              </Button>
            </Stack>
          ))}
        </Stack>

        <Stack direction="column" gap={1}>
          <Text element="h4">Active burn events</Text>
          {activeBurns.length === 0 && <Text>No active burn events.</Text>}
          {activeBurns.map((burn) => {
            const severity = getBurnSeverity(burn.source);
            const slo = sloById.get(burn.sloId);
            const service = slo ? serviceById.get(slo.serviceId) : undefined;
            const team = service ? teamById.get(service.ownerTeamId) : undefined;
            return (
              <Stack direction="row" key={burn.id} gap={1}>
                <Badge color={getSeverityBadgeColor(severity)} text={getSeverityLabel(severity)} />
                <Text>{burn.eventType}</Text>
                <Button size="sm" variant="secondary" onClick={() => locationService.push(prefixRoute(`slo/${burn.sloId}`))}>
                  {slo ? `SLO: ${slo.name}` : `SLO: ${burn.sloId}`}
                </Button>
                {service && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => locationService.push(prefixRoute(`service/${service.id}`))}
                  >
                    Service: {service.name}
                  </Button>
                )}
                {team && (
                  <Button size="sm" variant="secondary" onClick={() => locationService.push(prefixRoute(`team/${team.id}`))}>
                    Team: {team.name}
                  </Button>
                )}
              </Stack>
            );
          })}
        </Stack>
      </Stack>
    );
  };
}

export function createOverviewPage(args: {
  apiUrl: string;
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
  burnEvents: components['schemas']['BurnEvent'][];
  onRefresh: () => Promise<void>;
}) {
  return new SceneAppPage({
    title: 'SLO Overview',
    url: prefixRoute(ROUTES.Overview),
    routePath: ROUTES.Overview,
    subTitle: 'Teams, SLOs, and active burn events.',
    getScene: () =>
      new EmbeddedScene({
        body: new OverviewBody({
          apiUrl: args.apiUrl,
          teams: args.teams,
          services: args.services,
          slos: args.slos,
          burnEvents: args.burnEvents,
          onRefresh: args.onRefresh,
        }),
      }),
  });
}
