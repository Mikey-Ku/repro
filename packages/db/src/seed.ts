import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { generateIngestionKey, hashIngestionKey, keyPrefix } from './keys.js';
import { ingestionKeys, projectMembers, projects, users } from './schema.js';

export const LOCAL_USER = { email: 'dev@repro.local', name: 'Local developer' } as const;
export const DEMO_PROJECT = { slug: 'demo', name: 'Demo Store' } as const;

export interface SeedResult {
  userId: string;
  projectId: string;
  /** Plaintext ingestion key. Only returned when it was created in this call. */
  ingestionKey: string | null;
}

/**
 * Idempotent local seed: one developer user, the demo project, and one ingestion key.
 * Pass `key` to seed a specific key (used by the E2E suite); otherwise a random key is generated.
 */
export async function seed(options: { url?: string; key?: string } = {}): Promise<SeedResult> {
  const handle = createDb(options.url, { max: 1 });
  const { db } = handle;
  try {
    const [user] = await db
      .insert(users)
      .values(LOCAL_USER)
      .onConflictDoUpdate({ target: users.email, set: { name: LOCAL_USER.name } })
      .returning();
    const [project] = await db
      .insert(projects)
      .values(DEMO_PROJECT)
      .onConflictDoUpdate({ target: projects.slug, set: { name: DEMO_PROJECT.name } })
      .returning();
    await db
      .insert(projectMembers)
      .values({ projectId: project!.id, userId: user!.id, role: 'owner' })
      .onConflictDoNothing();

    let ingestionKey: string | null = null;
    if (options.key) {
      const existing = await db.select().from(ingestionKeys).where(eq(ingestionKeys.keyHash, hashIngestionKey(options.key)));
      if (existing.length === 0) {
        await db.insert(ingestionKeys).values({
          projectId: project!.id,
          label: 'Demo application',
          prefix: keyPrefix(options.key),
          keyHash: hashIngestionKey(options.key),
        });
      }
      ingestionKey = options.key;
    } else {
      const active = await db.select().from(ingestionKeys).where(eq(ingestionKeys.projectId, project!.id));
      if (active.filter((k) => !k.revokedAt).length === 0) {
        const generated = generateIngestionKey();
        await db.insert(ingestionKeys).values({
          projectId: project!.id,
          label: 'Demo application',
          prefix: generated.prefix,
          keyHash: generated.hash,
        });
        ingestionKey = generated.key;
      }
    }
    return { userId: user!.id, projectId: project!.id, ingestionKey };
  } finally {
    await handle.close();
  }
}

/** Write DEMO_PROJECT_KEY into the repo-root .env so the demo app can start recording. */
export function writeKeyToEnv(key: string, repoRoot: string): string {
  const envPath = path.join(repoRoot, '.env');
  const examplePath = path.join(repoRoot, '.env.example');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : fs.readFileSync(examplePath, 'utf8');
  if (/^DEMO_PROJECT_KEY=.*$/m.test(content)) {
    content = content.replace(/^DEMO_PROJECT_KEY=.*$/m, `DEMO_PROJECT_KEY=${key}`);
  } else {
    content += `\nDEMO_PROJECT_KEY=${key}\n`;
  }
  fs.writeFileSync(envPath, content);
  return envPath;
}

const here = path.dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requested = process.env.DEMO_PROJECT_KEY || undefined;
  seed({ key: requested })
    .then((result) => {
      console.log(`[db] seeded user ${result.userId} and project ${result.projectId}`);
      if (result.ingestionKey) {
        const envPath = writeKeyToEnv(result.ingestionKey, path.resolve(here, '..', '..', '..'));
        console.log(`[db] demo ingestion key written to ${envPath} as DEMO_PROJECT_KEY`);
      } else {
        console.log('[db] demo project already has an active ingestion key; nothing written');
      }
    })
    .catch((error) => {
      console.error('[db] seed failed', error);
      process.exit(1);
    });
}
