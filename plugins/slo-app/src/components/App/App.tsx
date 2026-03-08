import React, { useEffect, useMemo, useState } from 'react';
import { SceneApp } from '@grafana/scenes';
import { AppRootProps } from '@grafana/data';
import { PluginPropsContext } from '../../utils/utils.plugin';
import { createOverviewPage } from '../../pages/Overview/overviewPage';
import { sloDetailPages } from '../../pages/Detail/detailPage';
import { components } from '../../api/generated/types';
import { mapSLOToDefinition, SLOControlPlaneClient } from '../../api/sloControlPlane';
import { setSLODefinitions } from '../../sloDefinitions';
import { createControlPlanePage } from '../../pages/ControlPlane/controlPlanePage';
import { createTeamPages } from '../../pages/Team/teamPage';
import { createServicePages } from '../../pages/Service/servicePage';

function getSceneApp(args: {
  apiUrl: string;
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  slos: components['schemas']['SLO'][];
  burnEvents: components['schemas']['BurnEvent'][];
  onRefresh: () => Promise<void>;
}) {
  const overviewPage = createOverviewPage({
    apiUrl: args.apiUrl,
    teams: args.teams,
    services: args.services,
    slos: args.slos,
    burnEvents: args.burnEvents,
    onRefresh: args.onRefresh,
  });

  return new SceneApp({
    pages: [
      overviewPage,
      createControlPlanePage({
        apiUrl: args.apiUrl,
        teams: args.teams,
        services: args.services,
        burnEvents: args.burnEvents,
        onRefresh: args.onRefresh,
      }, overviewPage),
      ...createTeamPages({
        teams: args.teams,
        services: args.services,
        slos: args.slos,
      }, overviewPage),
      ...createServicePages({
        teams: args.teams,
        services: args.services,
        slos: args.slos,
      }, overviewPage),
      ...sloDetailPages(overviewPage),
    ],
    urlSyncOptions: {
      updateUrlOnInit: true,
      createBrowserHistorySteps: true,
    },
  });
}

function App(props: AppRootProps) {
  const apiUrl = props.meta.jsonData?.apiUrl ?? 'http://localhost:8080';
  const client = useMemo(() => new SLOControlPlaneClient(apiUrl), [apiUrl]);
  const [teams, setTeams] = useState<components['schemas']['Team'][]>([]);
  const [services, setServices] = useState<components['schemas']['Service'][]>([]);
  const [slos, setSlos] = useState<components['schemas']['SLO'][]>([]);
  const [burnEvents, setBurnEvents] = useState<components['schemas']['BurnEvent'][]>([]);
  const [scene, setScene] = useState<SceneApp>(() =>
    getSceneApp({
      apiUrl,
      teams: [],
      services: [],
      slos: [],
      burnEvents: [],
      onRefresh: async () => {},
    })
  );

  const refresh = async () => {
    const [teamItems, serviceItems, sloItems, burnItems] = await Promise.all([
      client.listTeams(),
      client.listServices(),
      client.listSLOs(),
      client.listBurnEvents(),
    ]);
    setTeams(teamItems);
    setServices(serviceItems);
    setSlos(sloItems);
    setBurnEvents(burnItems);
    setSLODefinitions(sloItems.map(mapSLOToDefinition));
    setScene(
      getSceneApp({
        apiUrl,
        teams: teamItems,
        services: serviceItems,
        slos: sloItems,
        burnEvents: burnItems,
        onRefresh: refresh,
      })
    );
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  useEffect(() => {
    setScene(
      getSceneApp({
        apiUrl,
        teams,
        services,
        slos,
        burnEvents,
        onRefresh: refresh,
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, teams, services, slos, burnEvents]);

  return (
    <PluginPropsContext.Provider value={props}>
      <scene.Component model={scene} />
    </PluginPropsContext.Provider>
  );
}

export default App;
