import type { RunTarget } from '@repro/contracts';
import { runTargetChoices } from '@/lib/run-target';

/**
 * Picks where a run executes: the bundled demo in broken or fixed mode, or one of the project's
 * external targets. Plain markup so it can sit inside a server-action form; the chosen value is
 * decoded by parseRunTargetChoice in the action.
 */
export function RunTargetSelect({ targets, disabled, id = 'run-target' }: { targets: RunTarget[]; disabled?: boolean; id?: string }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs text-muted">
      Target
      <select
        id={id}
        name="target"
        defaultValue="demo:broken"
        disabled={disabled}
        className="h-7 min-w-0 max-w-64 truncate rounded-md border border-border bg-raised px-2 text-xs text-text disabled:opacity-50"
      >
        {runTargetChoices(targets).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}
