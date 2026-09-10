import type { IncidentGroup } from '@repro/contracts';
import { Badge, Table, Td, Th } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { projectPath } from '@/lib/paths';

const kindTone = { exception: 'danger', unhandledrejection: 'danger', network: 'warning', console: 'neutral' } as const;

/** Comma-joined list that truncates in the cell but shows everything on hover. */
function ValueList({ values }: { values: string[] }) {
  if (values.length === 0) return <span className="text-muted">n/a</span>;
  return (
    <span className="block max-w-48 truncate" title={values.join(', ')}>
      {values.join(', ')}
    </span>
  );
}

/**
 * One row per fingerprint. The row links to the newest incident in the group, which is the
 * session most likely to still have a fresh replay. Same stretched-anchor technique as IncidentTable.
 */
export function IncidentGroupTable({ slug, groups }: { slug: string; groups: IncidentGroup[] }) {
  return (
    <Table caption="Incident groups">
      <thead>
        <tr>
          <Th>Incident</Th>
          <Th>Kind</Th>
          <Th numeric>Sessions</Th>
          <Th>First seen</Th>
          <Th>Last seen</Th>
          <Th>Releases</Th>
          <Th>Routes</Th>
          <Th numeric>Open</Th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.fingerprint} className="relative focus-within:bg-raised">
            <Td className="max-w-md">
              <a
                href={projectPath(slug, 'incidents', group.latestIncidentId)}
                className="block truncate text-text after:absolute after:inset-0 after:content-[''] hover:no-underline"
                title={group.title}
              >
                {group.title}
              </a>
              <span className="block truncate text-2xs text-muted">{group.message}</span>
            </Td>
            <Td>
              <Badge tone={kindTone[group.kind]}>{group.kind}</Badge>
            </Td>
            <Td numeric mono>
              {group.sessionCount}
            </Td>
            <Td className="whitespace-nowrap" title={formatDateTime(group.firstSeen)}>
              {formatRelative(group.firstSeen)}
            </Td>
            <Td className="whitespace-nowrap" title={formatDateTime(group.lastSeen)}>
              {formatRelative(group.lastSeen)}
            </Td>
            <Td mono>
              <ValueList values={group.releases} />
            </Td>
            <Td mono>
              <ValueList values={group.routes} />
            </Td>
            <Td numeric>
              <Badge tone={group.openCount > 0 ? 'warning' : 'success'}>
                {group.openCount} / {group.sessionCount}
              </Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
