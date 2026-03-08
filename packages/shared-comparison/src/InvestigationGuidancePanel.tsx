import React from 'react';
import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, Stack, Text, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

interface GuidanceKpi {
  label: string;
  value: string;
  color: 'blue' | 'green' | 'orange' | 'purple' | 'red';
}

interface GuidanceAction {
  label: string;
  onClick: () => void;
}

interface InvestigationGuidanceState extends SceneObjectState {
  title: string;
  summary: string;
  kpis: GuidanceKpi[];
  actions: GuidanceAction[];
}

export class InvestigationGuidancePanel extends SceneObjectBase<InvestigationGuidanceState> {
  constructor(state: Omit<InvestigationGuidanceState, 'key'>) {
    super(state);
  }

  public static Component = ({ model }: SceneComponentProps<InvestigationGuidancePanel>) => {
    const state = model.useState();
    const styles = useStyles2(getStyles);
    return (
      <div className={styles.wrap}>
        <Stack direction="column" gap={1}>
          <Text element="h4">{state.title}</Text>
          <Text color="secondary">{state.summary}</Text>
          {state.kpis.length > 0 && (
            <Stack direction="row" gap={1}>
              {state.kpis.map((kpi) => (
                <Badge key={`${kpi.label}:${kpi.value}`} color={kpi.color} text={`${kpi.label}: ${kpi.value}`} />
              ))}
            </Stack>
          )}
          {state.actions.length > 0 && (
            <Stack direction="row" gap={1}>
              {state.actions.map((action) => (
                <Button key={action.label} size="sm" variant="secondary" onClick={action.onClick}>
                  {action.label}
                </Button>
              ))}
            </Stack>
          )}
        </Stack>
      </div>
    );
  };
}

function getStyles(theme: GrafanaTheme2) {
  return {
    wrap: css({
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
      margin: `${theme.spacing(0.5)} ${theme.spacing(1)} 0`,
      padding: theme.spacing(1),
    }),
  };
}
