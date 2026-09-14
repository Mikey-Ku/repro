// Next.js App Router: a client component rendered once in app/layout.tsx.
// The key is public on purpose (ingestion keys are write-only). The dashboard's
// internal token is a different secret and must never be exposed like this.
'use client';

import { useEffect } from 'react';
import { Repro } from '@repro/browser-sdk';

export function ReproRecorder(): null {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_REPRO_KEY;
    const endpoint = process.env.NEXT_PUBLIC_REPRO_ENDPOINT;
    if (!key || !endpoint) return;
    const client = Repro.init({
      projectKey: key,
      endpoint,
      release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    });
    return () => client.stop();
  }, []);
  return null;
}

// app/layout.tsx
// import { ReproRecorder } from './repro-recorder';
// export default function RootLayout({ children }) {
//   return (
//     <html lang="en">
//       <body>
//         <ReproRecorder />
//         {children}
//       </body>
//     </html>
//   );
// }
