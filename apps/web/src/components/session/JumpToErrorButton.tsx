'use client';

import { IconJump } from '@/components/icons';
import { usePlayerControls } from './PlayerContext';
import { Button } from '@/components/ui';
import { formatOffset } from '@/lib/format';

export function JumpToErrorButton({ offsetMs }: { offsetMs: number | null }) {
  const { seekTo } = usePlayerControls();
  if (offsetMs === null) {
    return (
      <Button disabled title="This session has no errors">
        <IconJump size={14} />
        Jump to first error
      </Button>
    );
  }
  return (
    <Button variant="primary" onClick={() => seekTo(offsetMs)}>
      <IconJump size={14} />
      Jump to first error <span className="font-mono text-2xs opacity-80">{formatOffset(offsetMs)}</span>
    </Button>
  );
}
