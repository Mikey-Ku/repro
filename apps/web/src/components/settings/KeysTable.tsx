import type { IngestionKey } from '@repro/contracts';
import { RevokeKeyButton } from './RevokeKeyButton';
import { Badge, EmptyState, Table, Td, Th } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';

export function KeysTable({ slug, keys }: { slug: string; keys: IngestionKey[] }) {
  if (!keys.length) return <EmptyState compact title="No keys" description="Create one below to start recording." />;
  return (
    <Table caption="Ingestion keys">
      <thead>
        <tr>
          <Th>Label</Th>
          <Th>Prefix</Th>
          <Th>Created</Th>
          <Th>Last used</Th>
          <Th>Status</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key.id}>
            <Td>{key.label}</Td>
            <Td mono>{key.prefix}</Td>
            <Td className="whitespace-nowrap" title={formatDateTime(key.createdAt)}>
              {formatRelative(key.createdAt)}
            </Td>
            <Td className="whitespace-nowrap" title={key.lastUsedAt ? formatDateTime(key.lastUsedAt) : undefined}>
              {formatRelative(key.lastUsedAt)}
            </Td>
            <Td>{key.revokedAt ? <Badge tone="danger">revoked</Badge> : <Badge tone="success">active</Badge>}</Td>
            <Td numeric>{key.revokedAt ? null : <RevokeKeyButton slug={slug} keyId={key.id} label={key.label} />}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
