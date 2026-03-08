import React from 'react';
import { EmbeddedScene, SceneAppPage, SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Badge, Button, Stack, Text } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { components } from '../../api/generated/types';
import { prefixRoute } from '../../utils/utils.routing';
import { routeFor } from '../../constants';
import { getBurnSeverity, getSeverityWeight } from '../../components/ControlPlane/burnSeverity';
import { InvestigationCard } from '../../components/Investigation/InvestigationCard';

interface ServiceBodyState extends SceneObjectState {
  service: components['schemas']['Service'];
  ownerTeam?: components['schemas']['Team'];
  slos: components['schemas']['SLO'][];
  burnEvents: components['schemas']['BurnEvent'][];
}

class ServiceBody extends SceneObjectBase<ServiceBodyState> {
  static Component = ({ model }: SceneComponentProps<ServiceBody>) => {
    const { service, ownerTeam, slos, burnEvents } = model.useState();
    const riskBySlo = new Map<string, number>();
    for (const burn of burnEvents) {
      if (burn.eventType === 'burn_resolved') {
        continue;
      }
      const weight = getSeverityWeight(getBurnSeverity(burn.source));
      riskBySlo.set(burn.sloId, (riskBySlo.get(burn.sloId) ?? 0) + weight);
    }
    const serviceRisk = slos.reduce((acc, slo) => acc + (riskBySlo.get(slo.id) ?? 0), 0);
    return (
      <Stack direction="column" gap={2}>
        <Text element="h3">{service.name}</Text>
        <Text color="secondary">Service slug: {service.slug}</Text>
        <Stack direction="row" gap={1}>
          <Badge color={serviceRisk > 0 ? 'orange' : 'green'} text={`Risk score: ${serviceRisk}`} />
          <Badge color="purple" text={`SLOs: ${slos.length}`} />
        </Stack>
        {ownerTeam && (
          <Stack direction="row" gap={1}>
            <Text color="secondary">Owner team:</Text>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => locationService.push(prefixRoute(routeFor.team(ownerTeam.id)))}
            >
              {ownerTeam.name}
            </Button>
          </Stack>
        )}
        <Text element="h4">SLOs</Text>
        {slos.length === 0 && <Text>No SLOs for this service.</Text>}
        {slos.map((slo) => (
          <InvestigationCard
            key={slo.id}
            compact
            title={slo.runtime.name}
            badges={
              (riskBySlo.get(slo.id) ?? 0) > 0
                ? [{ color: 'orange', text: `Risk ${(riskBySlo.get(slo.id) ?? 0).toString()}` }]
                : [{ color: 'green', text: 'Healthy' }]
            }
            primaryAction={{ label: 'Open SLO', onClick: () => locationService.push(prefixRoute(routeFor.slo(slo.id))) }}
          />
        ))}
      </Stack>
    );
  };
}

export function createServicePages(args: {
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
  burnEvents: components['schemas']['BurnEvent'][];
}, parentPage?: SceneAppPage): SceneAppPage[] {
  const teamByID = new Map(args.teams.map((t) => [t.id, t] as const));

  return args.services.map((service) => {
    const serviceSLOs = args.slos.filter((slo) => slo.serviceId === service.id);
    const ownerTeam = teamByID.get(service.ownerTeamId);
    return new SceneAppPage({
      title: service.name,
      url: prefixRoute(routeFor.service(service.id)),
      routePath: routeFor.service(service.id),
      subTitle: `SLOs for ${service.name}`,
      getParentPage: parentPage ? () => parentPage : undefined,
      getScene: () =>
        new EmbeddedScene({
          body: new ServiceBody({
            service,
            ownerTeam,
            slos: serviceSLOs,
            burnEvents: args.burnEvents,
          }),
        }),
    });
  });
}
