'use client';

import { useRouter, useSearchParams } from 'next/navigation';

/** Switches the ?v= search param; the server re-renders the Test and Runs tabs for that version. */
export function VersionSelect({ versions, selected }: { versions: number[]; selected: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const change = (version: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('v', version);
    params.set('tab', 'test');
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Version
      <select value={selected} onChange={(event) => change(event.target.value)} className="h-7 rounded-md border border-border bg-raised px-2 text-xs text-text">
        {versions.map((version) => (
          <option key={version} value={version}>
            v{version}
          </option>
        ))}
      </select>
    </label>
  );
}
