'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconCopy } from '@/components/icons';
import { Button } from '@/components/ui';

/**
 * Copies text to the clipboard and confirms it in an aria-live region, so a
 * screen reader hears "Copied" without focus moving anywhere.
 */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={copy} aria-label={label}>
        {state === 'copied' ? <IconCheck size={14} className="text-success" /> : <IconCopy size={14} />}
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </>
  );
}
