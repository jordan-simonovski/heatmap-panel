import React, { FormEvent, useMemo, useState } from 'react';
import { Button, Field, Input, Stack, TextArea } from '@grafana/ui';
import { components } from '../../api/generated/types';
import { SLOControlPlaneClient } from '../../api/sloControlPlane';

interface Props {
  apiUrl: string;
  teams: components['schemas']['Team'][];
  services: components['schemas']['Service'][];
  burnEvents: components['schemas']['BurnEvent'][];
  onRefresh: () => Promise<void>;
}

export function ControlPlanePanel({ apiUrl, teams, services, burnEvents, onRefresh }: Props) {
  const client = useMemo(() => new SLOControlPlaneClient(apiUrl), [apiUrl]);
  const [teamName, setTeamName] = useState('');
  const [teamSlug, setTeamSlug] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [serviceSlug, setServiceSlug] = useState('');
  const [serviceOwner, setServiceOwner] = useState('');
  const [sloName, setSloName] = useState('');
  const [sloServiceId, setSloServiceId] = useState('');
  const [sloTarget, setSloTarget] = useState('0.99');
  const [sloWindow, setSloWindow] = useState('30');
  const [sloDatasourceUid, setSloDatasourceUid] = useState('clickhouse');
  const [sloOpenslo, setSloOpenslo] = useState(
    `apiVersion: openslo/v1\nkind: SLO\nmetadata:\n  name: example\nspec:\n  service: my-service\n  objective:\n    target: 0.99`
  );

  const createTeam = async (e: FormEvent) => {
    e.preventDefault();
    await client.createTeam({ name: teamName, slug: teamSlug });
    setTeamName('');
    setTeamSlug('');
    await onRefresh();
  };

  const createService = async (e: FormEvent) => {
    e.preventDefault();
    await client.createService({
      name: serviceName,
      slug: serviceSlug,
      ownerTeamId: serviceOwner,
      metadata: {},
    });
    setServiceName('');
    setServiceSlug('');
    await onRefresh();
  };

  const createSlo = async (e: FormEvent) => {
    e.preventDefault();
    await client.createSLO({
      serviceId: sloServiceId,
      name: sloName,
      target: Number(sloTarget),
      windowMinutes: Number(sloWindow),
      openslo: sloOpenslo,
      datasourceType: 'clickhouse',
      datasourceUid: sloDatasourceUid,
    });
    setSloName('');
    await onRefresh();
  };

  return (
    <Stack direction="column" gap={2}>
      <h3>Control Plane</h3>
      <small>API: {apiUrl}</small>

      <form onSubmit={createTeam}>
        <Stack direction="row" gap={1}>
          <Field label="Team name">
            <Input value={teamName} onChange={(e) => setTeamName(e.currentTarget.value)} />
          </Field>
          <Field label="Team slug">
            <Input value={teamSlug} onChange={(e) => setTeamSlug(e.currentTarget.value)} />
          </Field>
          <Button type="submit">Create team</Button>
        </Stack>
      </form>

      <form onSubmit={createService}>
        <Stack direction="row" gap={1}>
          <Field label="Service name">
            <Input value={serviceName} onChange={(e) => setServiceName(e.currentTarget.value)} />
          </Field>
          <Field label="Service slug">
            <Input value={serviceSlug} onChange={(e) => setServiceSlug(e.currentTarget.value)} />
          </Field>
          <Field label="Owner team ID">
            <Input value={serviceOwner} onChange={(e) => setServiceOwner(e.currentTarget.value)} />
          </Field>
          <Button type="submit">Create service</Button>
        </Stack>
      </form>

      <form onSubmit={createSlo}>
        <Stack direction="column" gap={1}>
          <Field label="SLO name">
            <Input value={sloName} onChange={(e) => setSloName(e.currentTarget.value)} />
          </Field>
          <Field label="Service ID">
            <Input value={sloServiceId} onChange={(e) => setSloServiceId(e.currentTarget.value)} />
          </Field>
          <Field label="Target">
            <Input value={sloTarget} onChange={(e) => setSloTarget(e.currentTarget.value)} />
          </Field>
          <Field label="Window (minutes)">
            <Input value={sloWindow} onChange={(e) => setSloWindow(e.currentTarget.value)} />
          </Field>
          <Field label="Datasource UID">
            <Input value={sloDatasourceUid} onChange={(e) => setSloDatasourceUid(e.currentTarget.value)} />
          </Field>
          <Field label="OpenSLO YAML">
            <TextArea rows={6} value={sloOpenslo} onChange={(e) => setSloOpenslo(e.currentTarget.value)} />
          </Field>
          <Button type="submit">Create SLO</Button>
        </Stack>
      </form>

      <small>Teams: {teams.length} | Services: {services.length} | Burn events: {burnEvents.length}</small>
    </Stack>
  );
}
