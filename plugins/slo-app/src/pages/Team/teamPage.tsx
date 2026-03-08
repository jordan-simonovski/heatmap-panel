import React, { useState } from 'react';
import { EmbeddedScene, SceneAppPage, SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Badge, Stack, Text } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { components } from '../../api/generated/types';
import { prefixRoute } from '../../utils/utils.routing';
import { routeFor } from '../../constants';
import { getBurnSeverity, getSeverityWeight } from '../../components/ControlPlane/burnSeverity';
import { InvestigationCard } from '../../components/Investigation/InvestigationCard';

interface TeamBodyState extends SceneObjectState {
  team: components['schemas']['Team'];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
  burnEvents: components['schemas']['BurnEvent'][];
}

class TeamBody extends SceneObjectBase<TeamBodyState> {
  static Component = ({ model }: SceneComponentProps<TeamBody>) => {
    const { team, services, slos, burnEvents } = model.useState();
    const [expandedByService, setExpandedByService] = useState<Record<string, boolean>>({});
    const activeRiskBySlo = new Map<string, number>();
    for (const burn of burnEvents) {
      if (burn.eventType === 'burn_resolved') {
        continue;
      }
      const weight = getSeverityWeight(getBurnSeverity(burn.source));
      activeRiskBySlo.set(burn.sloId, (activeRiskBySlo.get(burn.sloId) ?? 0) + weight);
    }

    const teamRisk = slos.reduce((acc, slo) => acc + (activeRiskBySlo.get(slo.id) ?? 0), 0);
    const slosByService = new Map<string, components['schemas']['SLO'][]>();
    for (const slo of slos) {
      const existing = slosByService.get(slo.serviceId) ?? [];
      existing.push(slo);
      slosByService.set(slo.serviceId, existing);
    }

    const toggle = (serviceId: string) =>
      setExpandedByService((prev) => ({ ...prev, [serviceId]: !prev[serviceId] }));

    return (
      <Stack direction="column" gap={2}>
        <Text element="h3">{team.name}</Text>
        <Text color="secondary">Team slug: {team.slug}</Text>
        <Stack direction="row" gap={1}>
          <Badge color={teamRisk > 0 ? 'orange' : 'green'} text={`Risk score: ${teamRisk}`} />
          <Badge color="blue" text={`Services: ${services.length}`} />
          <Badge color="purple" text={`SLOs: ${slos.length}`} />
        </Stack>
        <Text element="h4">Owned services</Text>
        {services.length === 0 && <Text>No services owned by this team.</Text>}
        {services.map((service) => {
          const serviceSLOs = slosByService.get(service.id) ?? [];
          const serviceRisk = serviceSLOs.reduce((acc, slo) => acc + (activeRiskBySlo.get(slo.id) ?? 0), 0);
          const expanded = expandedByService[service.id] ?? serviceSLOs.length <= 3;

          return (
            <Stack key={service.id} direction="column" gap={1}>
              <InvestigationCard
                compact
                title={service.name}
                summary={`${serviceSLOs.length} SLOs aligned to this service owner`}
                badges={[
                  { color: 'blue', text: 'Service' },
                  {
                    color: serviceRisk > 0 ? 'orange' : 'green',
                    text: serviceRisk > 0 ? `Risk ${serviceRisk}` : 'Healthy',
                  },
                ]}
                primaryAction={{ label: expanded ? 'Collapse SLOs' : 'Expand SLOs', onClick: () => toggle(service.id) }}
                secondaryActions={[
                  {
                    label: 'Open service',
                    onClick: () => locationService.push(prefixRoute(routeFor.service(service.id))),
                  },
                ]}
              />

              {expanded && serviceSLOs.length === 0 && <Text color="secondary">No SLOs defined for this service yet.</Text>}

              {expanded &&
                serviceSLOs.map((slo) => {
                  const risk = activeRiskBySlo.get(slo.id) ?? 0;
                  return (
                    <InvestigationCard
                      key={slo.id}
                      compact
                      title={slo.runtime.name}
                      summary={`${inferUXIntent(slo)} • ${buildSLODefinitionSummary(slo)}`}
                      badges={[
                        {
                          color: risk > 0 ? 'orange' : 'green',
                          text: risk > 0 ? `Risk ${risk}` : 'Healthy',
                        },
                        {
                          color: 'purple',
                          text: `Target ${(slo.runtime.target * 100).toFixed(1).replace('.0', '')}%`,
                        },
                      ]}
                      primaryAction={{ label: 'Open SLO', onClick: () => locationService.push(prefixRoute(routeFor.slo(slo.id))) }}
                    />
                  );
                })}
            </Stack>
          );
        })}
      </Stack>
    );
  };
}

function buildSLODefinitionSummary(slo: components['schemas']['SLO']): string {
  const runtime = slo.runtime;
  const type = runtime.type;
  const route = runtime.route;
  if (type === 'error_rate') {
    const thresholdRate = runtime.threshold;
    const thresholdPct = thresholdRate !== undefined ? `${(thresholdRate * 100).toFixed(2).replace(/\.00$/, '')}%` : 'n/a';
    return `Error rate SLO on ${route} • threshold ${thresholdPct} • window ${runtime.windowMinutes}m`;
  }
  const thresholdMs = runtime.threshold;
  return `Latency SLO on ${route} • p99 < ${thresholdMs ?? 'n/a'}ms • window ${runtime.windowMinutes}m`;
}

function inferUXIntent(slo: components['schemas']['SLO']): string {
  if (slo.runtime.description && slo.runtime.description.trim() !== '') {
    return slo.runtime.description.trim();
  }
  if (slo.runtime.userExperience && slo.runtime.userExperience.trim() !== '') {
    return slo.runtime.userExperience.trim();
  }
  return 'Protects a critical user journey for this service';
}

export function createTeamPages(args: {
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
  burnEvents: components['schemas']['BurnEvent'][];
}, parentPage?: SceneAppPage): SceneAppPage[] {
  const serviceToTeam = new Map<string, string>();
  for (const service of args.services) {
    serviceToTeam.set(service.id, service.ownerTeamId);
  }

  return args.teams.map((team) => {
    const teamServices = args.services.filter((service) => service.ownerTeamId === team.id);
    const teamSLOs = args.slos.filter((slo) => serviceToTeam.get(slo.serviceId) === team.id);

    return new SceneAppPage({
      title: team.name,
      url: prefixRoute(routeFor.team(team.id)),
      routePath: routeFor.team(team.id),
      subTitle: `SLOs owned by ${team.name}`,
      getParentPage: parentPage ? () => parentPage : undefined,
      getScene: () =>
        new EmbeddedScene({
          body: new TeamBody({
            team,
            services: teamServices,
            slos: teamSLOs,
            burnEvents: args.burnEvents,
          }),
        }),
    });
  });
}
