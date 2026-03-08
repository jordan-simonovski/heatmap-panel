import React from 'react';
import { EmbeddedScene, SceneAppPage, SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Stack, Text } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { components } from '../../api/generated/types';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES, routeFor } from '../../constants';
import { InvestigationCard } from '../../components/Investigation/InvestigationCard';

interface CatalogBodyState extends SceneObjectState {
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
}

class CatalogBody extends SceneObjectBase<CatalogBodyState> {
  static Component = ({ model }: SceneComponentProps<CatalogBody>) => {
    const state = model.useState();
    const serviceById = new Map(state.services.map((service) => [service.id, service] as const));
    const teamById = new Map(state.teams.map((team) => [team.id, team] as const));

    return (
      <Stack direction="column" gap={2}>
        <Text element="h3">SLO Catalog</Text>
        <Text color="secondary">Use this page to pivot by SLO -&gt; service -&gt; owner team during RCA.</Text>
        {state.slos.length === 0 && <Text>No SLOs available.</Text>}
        {state.slos.map((slo) => {
          const service = serviceById.get(slo.serviceId);
          const team = service ? teamById.get(service.ownerTeamId) : undefined;
          return (
            <InvestigationCard
              key={slo.id}
              title={slo.runtime.name}
              summary={`${service ? `Service: ${service.name}` : 'Unmapped service'}${team ? ` | Team: ${team.name}` : ''}`}
              badges={[{ color: 'purple', text: 'SLO' }]}
              primaryAction={{ label: 'Open SLO', onClick: () => locationService.push(prefixRoute(routeFor.slo(slo.id))) }}
              secondaryActions={[
                ...(service
                  ? [{ label: 'Open service', onClick: () => locationService.push(prefixRoute(routeFor.service(service.id))) }]
                  : []),
                ...(team ? [{ label: 'Open team', onClick: () => locationService.push(prefixRoute(routeFor.team(team.id))) }] : []),
              ]}
            />
          );
        })}
      </Stack>
    );
  };
}

export function createCatalogPage(args: Omit<CatalogBodyState, 'key'>, parentPage?: SceneAppPage) {
  return new SceneAppPage({
    title: 'SLO Catalog',
    url: prefixRoute(ROUTES.Catalog),
    routePath: ROUTES.Catalog,
    subTitle: 'Dense entity catalog for fast pivoting during investigation.',
    getParentPage: parentPage ? () => parentPage : undefined,
    getScene: () =>
      new EmbeddedScene({
        body: new CatalogBody({
          teams: args.teams,
          services: args.services,
          slos: args.slos,
        }),
      }),
  });
}
