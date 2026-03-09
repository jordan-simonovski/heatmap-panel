import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, Stack, Text, useStyles2, type BadgeColor } from '@grafana/ui';

interface BadgeItem {
  color: BadgeColor;
  text: string;
}

interface ActionItem {
  label: string;
  onClick: () => void;
}

interface Props {
  title: string;
  summary?: string;
  badges?: BadgeItem[];
  primaryAction: ActionItem;
  secondaryActions?: ActionItem[];
  compact?: boolean;
}

export function InvestigationCard({
  title,
  summary,
  badges = [],
  primaryAction,
  secondaryActions = [],
  compact = false,
}: Props) {
  const styles = useStyles2(getStyles);
  return (
    <div className={compact ? styles.cardCompact : styles.card}>
      <Stack direction="column" gap={1}>
        <Text element="h5">{title}</Text>
        {summary && <Text color="secondary">{summary}</Text>}
        {badges.length > 0 && (
          <Stack direction="row" gap={1}>
            {badges.map((badge) => (
              <Badge key={`${badge.color}:${badge.text}`} color={badge.color} text={badge.text} />
            ))}
          </Stack>
        )}
        <Stack direction="row" gap={1}>
          <Button size="sm" variant="primary" onClick={primaryAction.onClick}>
            {primaryAction.label}
          </Button>
          {secondaryActions.slice(0, 2).map((action) => (
            <Button key={action.label} size="sm" variant="secondary" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </Stack>
      </Stack>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    card: css({
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
      padding: theme.spacing(1.5),
      marginBottom: theme.spacing(1),
    }),
    cardCompact: css({
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
      padding: theme.spacing(1),
      marginBottom: theme.spacing(1),
    }),
  };
}
