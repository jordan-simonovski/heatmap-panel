import React from 'react';
import { EmbeddedScene, SceneAppPage, SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Button, Stack, Text } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { components } from '../../api/generated/types';
import { prefixRoute } from '../../utils/utils.routing';

interface ServiceBodyState extends SceneObjectState {
  service: components['schemas']['Service'];
  ownerTeam?: components['schemas']['Team'];
  slos: components['schemas']['SLO'][];
}

class ServiceBody extends SceneObjectBase<ServiceBodyState> {
  static Component = ({ model }: SceneComponentProps<ServiceBody>) => {
    const { service, ownerTeam, slos } = model.useState();
    return (
      <Stack direction="column" gap={2}>
        <Text element="h3">{service.name}</Text>
        <Text color="secondary">Service slug: {service.slug}</Text>
        {ownerTeam && (
          <Stack direction="row" gap={1}>
            <Text color="secondary">Owner team:</Text>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => locationService.push(prefixRoute(`team/${ownerTeam.id}`))}
            >
              {ownerTeam.name}
            </Button>
          </Stack>
        )}
        <Text element="h4">SLOs</Text>
        {slos.length === 0 && <Text>No SLOs for this service.</Text>}
        {slos.map((slo) => (
          <Stack direction="row" key={slo.id} gap={1}>
            <Button size="sm" variant="secondary" onClick={() => locationService.push(prefixRoute(`slo/${slo.id}`))}>
              {slo.name}
            </Button>
          </Stack>
        ))}
      </Stack>
    );
  };
}

export function createServicePages(args: {
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
}, parentPage?: SceneAppPage): SceneAppPage[] {
  const teamByID = new Map(args.teams.map((t) => [t.id, t] as const));

  return args.services.map((service) => {
    const serviceSLOs = args.slos.filter((slo) => slo.serviceId === service.id);
    const ownerTeam = teamByID.get(service.ownerTeamId);
    return new SceneAppPage({
      title: service.name,
      url: prefixRoute(`service/${service.id}`),
      routePath: `service/${service.id}`,
      subTitle: `SLOs for ${service.name}`,
      getParentPage: parentPage ? () => parentPage : undefined,
      getScene: () =>
        new EmbeddedScene({
          body: new ServiceBody({
            service,
            ownerTeam,
            slos: serviceSLOs,
          }),
        }),
    });
  });
}
