import type { Incident } from '@repro/contracts';
import { Badge, Table, Td, Th, statusTone } from '@/components/ui';
import { formatDateTime, formatOffset, formatRelative } from '@/lib/format';
import { projectPath } from '@/lib/paths';

const kindTone = { exception: 'danger', unhandledrejection: 'danger', network: 'warning', console: 'neutral' } as const;

/** Same whole-row link technique as SessionTable: one anchor, stretched over the row. */
export function IncidentTable({ slug, incidents, compact }: { slug: string; incidents: Incident[]; compact?: boolean }) {
  return (
    <Table caption="Incidents">
      <thead>
        <tr>
          <Th>Incident</Th>
          <Th>Kind</Th>
          {compact ? null : <Th>Route</Th>}
          {compact ? null : <Th>Release</Th>}
          <Th numeric>At</Th>
          <Th>Created</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {incidents.map((incident) => (
          <tr key={incident.id} className="relative focus-within:bg-raised">
            <Td className="max-w-md">
              <a href={projectPath(slug, 'incidents', incident.id)} className="block truncate text-text after:absolute after:inset-0 after:content-[''] hover:no-underline" title={incident.title}>
                {incident.title}
              </a>
              {compact ? null : <span className="block truncate text-2xs text-muted">{incident.message}</span>}
            </Td>
            <Td>
              <Badge tone={kindTone[incident.kind]}>{incident.kind}</Badge>
            </Td>
            {compact ? null : (
              <Td mono className="max-w-48 truncate">
                {incident.route ?? 'n/a'}
              </Td>
            )}
            {compact ? null : <Td mono>{incident.release ?? 'n/a'}</Td>}
            <Td numeric mono>
              {formatOffset(incident.offsetMs)}
            </Td>
            <Td className="whitespace-nowrap" title={formatDateTime(incident.createdAt)}>
              {formatRelative(incident.createdAt)}
            </Td>
            <Td>
              <Badge tone={statusTone(incident.status)}>{incident.status}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
