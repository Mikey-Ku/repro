import type { Metadata } from 'next';
import { CodeSnippet } from '@/components/CodeSnippet';
import { PageHeader } from '@/components/PageHeader';
import { CreateKeyForm } from '@/components/settings/CreateKeyForm';
import { KeysTable } from '@/components/settings/KeysTable';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { listKeys } from '@/lib/api';
import { ingestUrl } from '@/lib/env';
import { requireProject } from '@/lib/project';
import { scriptTagSnippet, sdkSnippet } from '@/lib/snippet';

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage({ params }: Props) {
  const { slug } = await params;
  const project = await requireProject(slug);
  const keys = await listKeys(project.id);
  const endpoint = ingestUrl();
  const activeKey = keys.find((key) => !key.revokedAt);
  const placeholder = activeKey ? `${activeKey.prefix}...` : 'rp_...';

  return (
    <>
      <PageHeader title="Settings" description={`Project ${project.name} (${project.slug})`} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Ingestion keys" description="Keys are hashed at rest. The plaintext is shown once, when created." />
          <KeysTable slug={slug} keys={keys} />
          <CardBody className="border-t border-border">
            <CreateKeyForm slug={slug} />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="SDK snippet" description="Replace the key with the plaintext from a newly created key." />
            <CardBody className="space-y-3">
              <CodeSnippet label="ESM snippet" code={sdkSnippet(placeholder, endpoint)} />
              <CodeSnippet label="script tag snippet" code={scriptTagSnippet(placeholder, endpoint)} />
              <p className="text-xs text-muted">
                Options such as <code>strict</code>, <code>maskSelector</code>, <code>blockSelector</code> and <code>sampleRate</code> are documented in packages/browser-sdk.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Retention" />
            <CardBody className="text-sm">
              <p>
                Sessions, events and incidents are kept for <strong>{project.retentionDays} days</strong>, then deleted by the worker. Generated tests are kept until their session is deleted.
              </p>
              <p className="mt-2 text-xs text-muted">Retention is a project setting in the database; there is no UI to change it in this release.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
