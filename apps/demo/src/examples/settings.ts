import { z } from 'zod';

export const THEMES = ['light', 'dark', 'system'] as const;
export const TIMEZONES = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'] as const;

export interface AccountSettings {
  displayName: string;
  bio: string;
  theme: (typeof THEMES)[number];
  emailNotifications: boolean;
  weeklyDigest: boolean;
  timezone: (typeof TIMEZONES)[number];
}

/** Everything the form sends. The two passwords are checked and then dropped; they are never stored. */
export const SettingsBody = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(80, 'Display name is too long'),
  bio: z.string().max(500, 'Bio must be 500 characters or fewer').default(''),
  theme: z.enum(THEMES),
  emailNotifications: z.boolean(),
  weeklyDigest: z.boolean(),
  timezone: z.enum(TIMEZONES),
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});
export type SettingsInput = z.infer<typeof SettingsBody>;

export const DEFAULT_SETTINGS: AccountSettings = {
  displayName: 'Ada Lovelace',
  bio: 'Analyst, metaphysician, and the first programmer.',
  theme: 'system',
  emailNotifications: true,
  weeklyDigest: false,
  timezone: 'Europe/London',
};

/** In-memory settings for the single demo account. Resets with the process, like the order store. */
export class SettingsStore {
  private current: AccountSettings = { ...DEFAULT_SETTINGS };
  private savedAt: string | null = null;

  get(): AccountSettings {
    return { ...this.current };
  }

  lastSavedAt(): string | null {
    return this.savedAt;
  }

  save(input: SettingsInput, now = new Date()): { settings: AccountSettings; savedAt: string } {
    const { displayName, bio, theme, emailNotifications, weeklyDigest, timezone } = input;
    this.current = { displayName, bio, theme, emailNotifications, weeklyDigest, timezone };
    this.savedAt = now.toISOString();
    return { settings: this.get(), savedAt: this.savedAt };
  }
}
