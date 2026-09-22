import type { RunTarget } from '@repro/contracts';
import { RemoveTargetButton } from './RemoveTargetButton';
import { EmptyState, Table, Td, Th } from '@/components/ui';

/** The project's external reproduction targets. The bundled demo is implicit and not listed here. */
export function TargetsTable({ slug, targets }: { slug: string; targets: RunTarget[] }) {
  if (!targets.length) {
    return <EmptyState compact title="No external targets" description="Runs use the bundled demo until you add the origin of an application you control below." />;
  }
  return (
    <Table caption="Reproduction targets">
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>Origin</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {targets.map((target) => (
          <tr key={target.id}>
            <Td>{target.name}</Td>
            <Td mono>{target.url}</Td>
            <Td numeric>
              <RemoveTargetButton slug={slug} targetId={target.id} name={target.name} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
