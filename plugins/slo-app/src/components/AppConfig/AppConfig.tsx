import React, { ChangeEvent, useState } from 'react';
import { Button, Field, Input, useStyles2 } from '@grafana/ui';
import { PluginConfigPageProps, AppPluginMeta, GrafanaTheme2, PluginMeta } from '@grafana/data';
import { getBackendSrv, locationService } from '@grafana/runtime';
import { css } from '@emotion/css';
import { lastValueFrom } from 'rxjs';

type JsonData = {
  apiUrl?: string;
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const AppConfig = ({ plugin }: AppConfigProps) => {
  const styles = useStyles2(getStyles);
  const [apiUrl, setApiUrl] = useState(plugin.meta.jsonData?.apiUrl ?? 'http://localhost:8080');

  const onChangeApiUrl = (event: ChangeEvent<HTMLInputElement>) => {
    setApiUrl(event.target.value.trim());
  };

  const onSubmit = async () => {
    await updatePluginAndReload(plugin.meta.id, {
      enabled: plugin.meta.enabled,
      pinned: plugin.meta.pinned,
      jsonData: { apiUrl },
    });
  };

  return (
    <form className={styles.container} onSubmit={onSubmit}>
      <Field label="SLO Control Plane URL" description="Base URL for the standalone Go control-plane API">
        <Input value={apiUrl} onChange={onChangeApiUrl} placeholder="http://localhost:8080" />
      </Field>
      <Button type="submit" disabled={!apiUrl}>
        Save
      </Button>
    </form>
  );
};

export default AppConfig;

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    padding: theme.spacing(3),
    color: theme.colors.text.secondary,
    maxWidth: 640,
  }),
});

const updatePluginAndReload = async (pluginId: string, data: Partial<PluginMeta<JsonData>>) => {
  const response = getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });
  await lastValueFrom(response);
  locationService.reload();
};
