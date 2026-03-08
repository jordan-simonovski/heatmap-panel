import React from 'react';
import { EmbeddedScene, SceneAppPage, SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Button, Stack, Text } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { components } from '../../api/generated/types';
import { prefixRoute } from '../../utils/utils.routing';

interface TeamBodyState extends SceneObjectState {
  team: components['schemas']['Team'];
  slos: components['schemas']['SLO'][];
}

class TeamBody extends SceneObjectBase<TeamBodyState> {
  static Component = ({ model }: SceneComponentProps<TeamBody>) => {
    const { team, slos } = model.useState();
    return (
      <Stack direction="column" gap={2}>
        <Text element="h3">{team.name}</Text>
        <Text color="secondary">Team slug: {team.slug}</Text>
        <Text element="h4">Owned SLOs</Text>
        {slos.length === 0 && <Text>No SLOs owned by this team.</Text>}
        {slos.map((slo) => (
          <Stack direction="row" key={slo.id} gap={1}>
            <Text>{slo.name}</Text>
            <Button size="sm" variant="secondary" onClick={() => locationService.push(prefixRoute(`slo/${slo.id}`))}>
              Open SLO
            </Button>
          </Stack>
        ))}
      </Stack>
    );
  };
}

export function createTeamPages(args: {
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
}, parentPage?: SceneAppPage): SceneAppPage[] {
  const serviceToTeam = new Map<string, string>();
  for (const service of args.services) {
    serviceToTeam.set(service.id, service.ownerTeamId);
  }

  return args.teams.map((team) => {
    const teamSLOs = args.slos.filter((slo) => serviceToTeam.get(slo.serviceId) === team.id);

    return new SceneAppPage({
      title: team.name,
      url: prefixRoute(`team/${team.id}`),
      routePath: `team/${team.id}`,
      subTitle: `SLOs owned by ${team.name}`,
      getParentPage: parentPage ? () => parentPage : undefined,
      getScene: () =>
        new EmbeddedScene({
          body: new TeamBody({
            team,
            slos: teamSLOs,
          }),
        }),
    });
  });
}
