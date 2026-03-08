import React, { FormEvent, useMemo, useState } from 'react';
import { Button, Field, FieldSet, Input, Select, Stack, TextArea } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { components } from '../../api/generated/types';
import { SLOControlPlaneClient } from '../../api/sloControlPlane';

type Team = components['schemas']['Team'];
type Service = components['schemas']['Service'];

type CreateType = 'team' | 'service' | 'slo';

interface Props {
  apiUrl: string;
  teams: Team[];
  services: Service[];
  onRefresh: () => Promise<void>;
}

export function CreateEntityPanel({ apiUrl, teams, services, onRefresh }: Props) {
  const client = useMemo(() => new SLOControlPlaneClient(apiUrl), [apiUrl]);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CreateType>('team');

  const [teamName, setTeamName] = useState('');
  const [teamSlug, setTeamSlug] = useState('');

  const [serviceName, setServiceName] = useState('');
  const [serviceSlug, setServiceSlug] = useState('');
  const [serviceOwnerTeamId, setServiceOwnerTeamId] = useState<string>('');

  const [sloTeamId, setSloTeamId] = useState<string>('');
  const [sloServiceId, setSloServiceId] = useState<string>('');
  const [sloName, setSloName] = useState('');
  const [sloTarget, setSloTarget] = useState('0.99');
  const [sloWindowMinutes, setSloWindowMinutes] = useState('30');
  const [sloDatasourceUid, setSloDatasourceUid] = useState('clickhouse');
  const [sloType, setSloType] = useState<'latency' | 'error_rate'>('latency');
  const [sloRoute, setSloRoute] = useState('/cart/checkout');
  const [sloThreshold, setSloThreshold] = useState('500');

  const teamOptions: Array<SelectableValue<string>> = teams.map((t) => ({
    label: `${t.name} (${t.slug})`,
    value: t.id,
  }));

  const serviceOptions: Array<SelectableValue<string>> = services
    .filter((s) => (sloTeamId ? s.ownerTeamId === sloTeamId : true))
    .map((s) => ({
      label: `${s.name} (${s.slug})`,
      value: s.id,
    }));

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (kind === 'team') {
      await client.createTeam({ name: teamName, slug: teamSlug });
      setTeamName('');
      setTeamSlug('');
    } else if (kind === 'service') {
      await client.createService({
        name: serviceName,
        slug: serviceSlug,
        ownerTeamId: serviceOwnerTeamId,
        metadata: {},
      });
      setServiceName('');
      setServiceSlug('');
      setServiceOwnerTeamId('');
    } else {
      const openslo = [
        'apiVersion: openslo/v1',
        'kind: SLO',
        'metadata:',
        `  name: ${sloName || 'generated-slo'}`,
        'spec:',
        '  service: generated-service',
        '  objective:',
        `    target: ${sloTarget}`,
        '  indicator:',
        `    route: ${sloRoute}`,
        `    type: ${sloType}`,
        `    threshold: ${sloThreshold}`,
      ].join('\n');

      await client.createSLO({
        serviceId: sloServiceId,
        name: sloName,
        target: Number(sloTarget),
        windowMinutes: Number(sloWindowMinutes),
        openslo,
        datasourceType: 'clickhouse',
        datasourceUid: sloDatasourceUid,
      });
      setSloName('');
    }
    await onRefresh();
  };

  return (
    <FieldSet label="Create">
      <Stack direction="column" gap={1}>
        <Button onClick={() => setOpen((v) => !v)}>{open ? 'Hide create form' : 'Create team / service / SLO'}</Button>
        {open && (
          <form onSubmit={onCreate}>
            <Stack direction="column" gap={1}>
              <Field label="Entity type">
                <Select<CreateType>
                  options={[
                    { label: 'Team', value: 'team' },
                    { label: 'Service', value: 'service' },
                    { label: 'SLO', value: 'slo' },
                  ]}
                  value={{ label: kind, value: kind }}
                  onChange={(v) => setKind((v?.value as CreateType) ?? 'team')}
                />
              </Field>

              {kind === 'team' && (
                <>
                  <Field label="Team name">
                    <Input value={teamName} onChange={(e) => setTeamName(e.currentTarget.value)} />
                  </Field>
                  <Field label="Team slug">
                    <Input value={teamSlug} onChange={(e) => setTeamSlug(e.currentTarget.value)} />
                  </Field>
                </>
              )}

              {kind === 'service' && (
                <>
                  <Field label="Service name">
                    <Input value={serviceName} onChange={(e) => setServiceName(e.currentTarget.value)} />
                  </Field>
                  <Field label="Service slug">
                    <Input value={serviceSlug} onChange={(e) => setServiceSlug(e.currentTarget.value)} />
                  </Field>
                  <Field label="Owning team">
                    <Select<string>
                      options={teamOptions}
                      value={teamOptions.find((t) => t.value === serviceOwnerTeamId)}
                      onChange={(v) => setServiceOwnerTeamId(v?.value ?? '')}
                    />
                  </Field>
                </>
              )}

              {kind === 'slo' && (
                <>
                  <Field label="Team">
                    <Select<string>
                      options={teamOptions}
                      value={teamOptions.find((t) => t.value === sloTeamId)}
                      onChange={(v) => {
                        setSloTeamId(v?.value ?? '');
                        setSloServiceId('');
                      }}
                    />
                  </Field>
                  <Field label="Service">
                    <Select<string>
                      options={serviceOptions}
                      value={serviceOptions.find((s) => s.value === sloServiceId)}
                      onChange={(v) => setSloServiceId(v?.value ?? '')}
                    />
                  </Field>
                  <Field label="SLO name">
                    <Input value={sloName} onChange={(e) => setSloName(e.currentTarget.value)} />
                  </Field>
                  <Field label="Target">
                    <Input value={sloTarget} onChange={(e) => setSloTarget(e.currentTarget.value)} />
                  </Field>
                  <Field label="Window minutes">
                    <Input value={sloWindowMinutes} onChange={(e) => setSloWindowMinutes(e.currentTarget.value)} />
                  </Field>
                  <Field label="Route">
                    <Input value={sloRoute} onChange={(e) => setSloRoute(e.currentTarget.value)} />
                  </Field>
                  <Field label="Type">
                    <Select<'latency' | 'error_rate'>
                      options={[
                        { label: 'Latency', value: 'latency' },
                        { label: 'Error rate', value: 'error_rate' },
                      ]}
                      value={{ label: sloType, value: sloType }}
                      onChange={(v) => setSloType((v?.value as 'latency' | 'error_rate') ?? 'latency')}
                    />
                  </Field>
                  <Field label={sloType === 'latency' ? 'Threshold (ms)' : 'Threshold rate'}>
                    <Input value={sloThreshold} onChange={(e) => setSloThreshold(e.currentTarget.value)} />
                  </Field>
                  <Field label="Datasource UID">
                    <Input value={sloDatasourceUid} onChange={(e) => setSloDatasourceUid(e.currentTarget.value)} />
                  </Field>
                  <Field label="OpenSLO preview (generated on submit)">
                    <TextArea
                      rows={6}
                      disabled
                      value={[
                        'apiVersion: openslo/v1',
                        'kind: SLO',
                        'metadata:',
                        `  name: ${sloName || 'generated-slo'}`,
                        'spec:',
                        '  service: generated-service',
                        '  objective:',
                        `    target: ${sloTarget}`,
                        '  indicator:',
                        `    route: ${sloRoute}`,
                        `    type: ${sloType}`,
                        `    threshold: ${sloThreshold}`,
                      ].join('\n')}
                    />
                  </Field>
                </>
              )}

              <Button type="submit">Create</Button>
            </Stack>
          </form>
        )}
      </Stack>
    </FieldSet>
  );
}
