import React, { useEffect, useMemo, useState } from 'react';
import { SceneApp } from '@grafana/scenes';
import { AppRootProps } from '@grafana/data';
import { PluginPropsContext } from '../../utils/utils.plugin';
import { createOverviewPage } from '../../pages/Overview/overviewPage';
import { sloDetailPages } from '../../pages/Detail/detailPage';
import { components } from '../../api/generated/types';
import { mapSLOToDefinition, SLOControlPlaneClient } from '../../api/sloControlPlane';
import { setSLODefinitions } from '../../sloDefinitions';
import { ControlPlanePanel } from '../ControlPlane/ControlPlanePanel';

function getSceneApp() {
  return new SceneApp({
    pages: [createOverviewPage(), ...sloDetailPages()],
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
  const [burnEvents, setBurnEvents] = useState<components['schemas']['BurnEvent'][]>([]);
  const [scene, setScene] = useState<SceneApp>(() => getSceneApp());

  const refresh = async () => {
    const [teamItems, serviceItems, sloItems, burnItems] = await Promise.all([
      client.listTeams(),
      client.listServices(),
      client.listSLOs(),
      client.listBurnEvents(),
    ]);
    setTeams(teamItems);
    setServices(serviceItems);
    setBurnEvents(burnItems);
    setSLODefinitions(sloItems.map(mapSLOToDefinition));
    setScene(getSceneApp());
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  return (
    <PluginPropsContext.Provider value={props}>
      <ControlPlanePanel apiUrl={apiUrl} teams={teams} services={services} burnEvents={burnEvents} onRefresh={refresh} />
      <scene.Component model={scene} />
    </PluginPropsContext.Provider>
  );
}

export default App;
