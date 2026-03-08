import React from 'react';
import { EmbeddedScene, SceneAppPage, SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Stack, Text } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { components } from '../../api/generated/types';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES, routeFor } from '../../constants';
import { getBurnSeverity, getSeverityWeight } from '../../components/ControlPlane/burnSeverity';
import { InvestigationCard } from '../../components/Investigation/InvestigationCard';

interface OwnershipBodyState extends SceneObjectState {
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
  burnEvents: components['schemas']['BurnEvent'][];
}

class OwnershipBody extends SceneObjectBase<OwnershipBodyState> {
  static Component = ({ model }: SceneComponentProps<OwnershipBody>) => {
    const state = model.useState();
    const servicesByTeam = new Map<string, components['schemas']['Service'][]>();
    const slosByService = new Map<string, components['schemas']['SLO'][]>();
    const activeBurnsBySlo = new Map<string, number>();

    for (const service of state.services) {
      const list = servicesByTeam.get(service.ownerTeamId) ?? [];
      list.push(service);
      servicesByTeam.set(service.ownerTeamId, list);
    }
    for (const slo of state.slos) {
      const list = slosByService.get(slo.serviceId) ?? [];
      list.push(slo);
      slosByService.set(slo.serviceId, list);
    }
    for (const burn of state.burnEvents) {
      if (burn.eventType === 'burn_resolved') {
        continue;
      }
      const weight = getSeverityWeight(getBurnSeverity(burn.source));
      activeBurnsBySlo.set(burn.sloId, (activeBurnsBySlo.get(burn.sloId) ?? 0) + weight);
    }

    return (
      <Stack direction="column" gap={2}>
        <Text element="h3">Ownership</Text>
        <Text color="secondary">Locate hot teams/services quickly, then continue investigation at service or SLO level.</Text>
        {state.teams.map((team) => {
          const teamServices = servicesByTeam.get(team.id) ?? [];
          const teamSLOs = teamServices.flatMap((service) => slosByService.get(service.id) ?? []);
          const teamRisk = teamSLOs.reduce((acc, slo) => acc + (activeBurnsBySlo.get(slo.id) ?? 0), 0);
          return (
            <InvestigationCard
              key={team.id}
              title={team.name}
              summary={`Top services: ${teamServices
                .slice(0, 3)
                .map((service) => service.name)
                .join(', ') || 'none'}`}
              badges={[
                { color: teamRisk > 0 ? 'orange' : 'green', text: `Risk ${teamRisk}` },
                { color: 'blue', text: `Services ${teamServices.length}` },
                { color: 'purple', text: `SLOs ${teamSLOs.length}` },
              ]}
              primaryAction={{ label: 'Open team', onClick: () => locationService.push(prefixRoute(routeFor.team(team.id))) }}
              secondaryActions={
                teamServices[0]
                  ? [{ label: 'Open top service', onClick: () => locationService.push(prefixRoute(routeFor.service(teamServices[0].id))) }]
                  : []
              }
            />
          );
        })}
      </Stack>
    );
  };
}

export function createOwnershipPage(args: Omit<OwnershipBodyState, 'key'>, parentPage?: SceneAppPage) {
  return new SceneAppPage({
    title: 'Ownership',
    url: prefixRoute(ROUTES.Ownership),
    routePath: ROUTES.Ownership,
    subTitle: 'Team and service ownership hotspots for RCA follow-through.',
    getParentPage: parentPage ? () => parentPage : undefined,
    getScene: () =>
      new EmbeddedScene({
        body: new OwnershipBody({
          teams: args.teams,
          services: args.services,
          slos: args.slos,
          burnEvents: args.burnEvents,
        }),
      }),
  });
}
