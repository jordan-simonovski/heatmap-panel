import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { PluginConfigPageProps, AppPluginMeta, GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

type JsonData = {};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const AppConfig = (_props: AppConfigProps) => {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.container}>
      <p>No configuration required. SLO definitions are managed in code.</p>
    </div>
  );
};

export default AppConfig;

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    padding: theme.spacing(3),
    color: theme.colors.text.secondary,
  }),
});
