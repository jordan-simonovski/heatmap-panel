import React, { useContext } from 'react';
import { AppRootProps } from '@grafana/data';

export const PluginPropsContext = React.createContext<AppRootProps | null>(null);

export const usePluginProps = () => {
  const pluginProps = useContext(PluginPropsContext);
  return pluginProps;
};

export const usePluginMeta = () => {
  const pluginProps = usePluginProps();
  return pluginProps?.meta;
};
