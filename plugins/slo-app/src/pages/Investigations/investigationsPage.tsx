import React from 'react';
import { EmbeddedScene, SceneAppPage, SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Badge, Stack, Text } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { components } from '../../api/generated/types';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES, routeFor } from '../../constants';
import { getBurnSeverity, getSeverityBadgeColor, getSeverityLabel, getSeverityWeight } from '../../components/ControlPlane/burnSeverity';
import { InvestigationCard } from '../../components/Investigation/InvestigationCard';

interface InvestigationsBodyState extends SceneObjectState {
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
  burnEvents: components['schemas']['BurnEvent'][];
}

class InvestigationsBody extends SceneObjectBase<InvestigationsBodyState> {
  static Component = ({ model }: SceneComponentProps<InvestigationsBody>) => {
    const state = model.useState();
    const teamById = new Map(state.teams.map((team) => [team.id, team] as const));
    const serviceById = new Map(state.services.map((service) => [service.id, service] as const));
    const sloById = new Map(state.slos.map((slo) => [slo.id, slo] as const));
    const activeBurns = state.burnEvents
      .filter((event) => event.eventType !== 'burn_resolved')
      .sort((a, b) => getSeverityWeight(getBurnSeverity(b.source)) - getSeverityWeight(getBurnSeverity(a.source)))
      .slice(0, 20);

    return (
      <Stack direction="column" gap={2}>
        <Text element="h3">Investigations</Text>
        <Text color="secondary">
          Start from active risk, then pivot into SLO detail, service ownership, and trace evidence.
        </Text>
        <Stack direction="row" gap={1}>
          <Badge color="orange" text={`Active burns: ${activeBurns.length}`} />
          <Badge color="blue" text={`Teams: ${state.teams.length}`} />
          <Badge color="green" text={`Services: ${state.services.length}`} />
          <Badge color="purple" text={`SLOs: ${state.slos.length}`} />
        </Stack>

        <Text element="h4">Risk queue</Text>
        {activeBurns.length === 0 && <Text>No active burn events. Use catalog to inspect latent risk.</Text>}
        {activeBurns.map((burn) => {
          const severity = getBurnSeverity(burn.source);
          const slo = sloById.get(burn.sloId);
          const service = slo ? serviceById.get(slo.serviceId) : undefined;
          const team = service ? teamById.get(service.ownerTeamId) : undefined;
          return (
            <InvestigationCard
              key={burn.id}
              title={slo ? slo.runtime.name : burn.sloId}
              summary={`${burn.eventType}${service ? ` | Service: ${service.name}` : ''}${team ? ` | Team: ${team.name}` : ''}`}
              badges={[
                { color: getSeverityBadgeColor(severity), text: getSeverityLabel(severity) },
                { color: 'orange', text: 'Active burn' },
              ]}
              primaryAction={{
                label: 'Investigate SLO',
                onClick: () => locationService.push(prefixRoute(routeFor.slo(burn.sloId))),
              }}
              secondaryActions={[
                ...(service
                  ? [
                      {
                        label: 'Open service',
                        onClick: () => locationService.push(prefixRoute(routeFor.service(service.id))),
                      },
                    ]
                  : []),
                ...(team
                  ? [
                      {
                        label: 'Open team',
                        onClick: () => locationService.push(prefixRoute(routeFor.team(team.id))),
                      },
                    ]
                  : []),
              ]}
            />
          );
        })}
      </Stack>
    );
  };
}

export function createInvestigationsPage(args: Omit<InvestigationsBodyState, 'key'>) {
  return new SceneAppPage({
    title: 'Investigations',
    url: prefixRoute(ROUTES.Investigations),
    routePath: ROUTES.Investigations,
    subTitle: 'Triage active risk and keep drilling until you have evidence.',
    getScene: () =>
      new EmbeddedScene({
        body: new InvestigationsBody({
          teams: args.teams,
          services: args.services,
          slos: args.slos,
          burnEvents: args.burnEvents,
        }),
      }),
  });
}
