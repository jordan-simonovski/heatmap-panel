import React from 'react';
import {
  EmbeddedScene,
  SceneAppPage,
  SceneComponentProps,
  SceneObjectBase,
  SceneObjectState,
} from '@grafana/scenes';
import { components } from '../../api/generated/types';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';
import { ControlPlanePanel } from '../../components/ControlPlane/ControlPlanePanel';

interface ControlPlaneSceneState extends SceneObjectState {
  apiUrl: string;
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
  burnEvents: components['schemas']['BurnEvent'][];
  onRefresh: () => Promise<void>;
}

class ControlPlaneScene extends SceneObjectBase<ControlPlaneSceneState> {
  static Component = ({ model }: SceneComponentProps<ControlPlaneScene>) => {
    const state = model.useState();
    return (
      <ControlPlanePanel
        apiUrl={state.apiUrl}
        teams={state.teams}
        services={state.services}
        slos={state.slos}
        burnEvents={state.burnEvents}
        onRefresh={state.onRefresh}
      />
    );
  };
}

export function createControlPlanePage(args: Omit<ControlPlaneSceneState, 'key'>, parentPage?: SceneAppPage) {
  return new SceneAppPage({
    title: 'Operations',
    url: prefixRoute(ROUTES.Operations),
    routePath: ROUTES.Operations,
    subTitle: 'Manage entities while investigations stay in dedicated RCA flows.',
    getParentPage: parentPage ? () => parentPage : undefined,
    getScene: () =>
      new EmbeddedScene({
        body: new ControlPlaneScene({
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
