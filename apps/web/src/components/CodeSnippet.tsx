import { CopyButton } from './CopyButton';

/** Monospace block with a copy button. Plain text only: React escapes the content. */
export function CodeSnippet({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative">
      <pre className="rounded-md border border-border bg-raised px-3 py-2 pr-20 text-xs" aria-label={label}>
        {code}
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton text={code} label={`Copy ${label}`} />
      </div>
    </div>
  );
}
