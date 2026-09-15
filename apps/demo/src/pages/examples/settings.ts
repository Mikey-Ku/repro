import { THEMES, TIMEZONES, type AccountSettings } from '../../examples/settings.js';
import { escapeHtml } from '../../html.js';
import { renderLayout, type DemoPageConfig } from '../../layout.js';
import { EXAMPLE_STYLES } from './styles.js';

const THEME_LABELS: Record<AccountSettings['theme'], string> = { light: 'Light', dark: 'Dark', system: 'System' };

export function renderSettingsPage(demo: DemoPageConfig, settings: AccountSettings, savedAt: string | null): string {
  const themes = THEMES.map(
    (theme) => `
          <div class="check">
            <input type="radio" name="theme" id="theme-${theme}" value="${theme}"${settings.theme === theme ? ' checked' : ''}>
            <label for="theme-${theme}">${THEME_LABELS[theme]}</label>
          </div>`,
  ).join('');
  const timezones = TIMEZONES.map(
    (zone) => `<option value="${escapeHtml(zone)}"${settings.timezone === zone ? ' selected' : ''}>${escapeHtml(zone)}</option>`,
  ).join('');

  const body = `
    <h1>Account settings</h1>
    <p class="lede">Update your profile, appearance and notification preferences.${
      savedAt ? ` Last saved <time datetime="${escapeHtml(savedAt)}">${escapeHtml(savedAt)}</time>.` : ''
    }</p>

    <div id="toast-slot" aria-live="polite"></div>
    <p class="alert" role="alert" data-testid="settings-error" data-visible="false"></p>

    <form data-testid="settings-form" id="settings-form" method="post" action="/api/examples/settings" novalidate>
      <fieldset>
        <legend>Profile</legend>
        <div class="field">
          <label for="display-name">Display name</label>
          <input type="text" name="displayName" id="display-name" autocomplete="nickname" value="${escapeHtml(settings.displayName)}" required>
        </div>
        <div class="field">
          <label for="bio">Bio</label>
          <textarea name="bio" id="bio" rows="3" maxlength="500">${escapeHtml(settings.bio)}</textarea>
          <span class="hint">Up to 500 characters.</span>
        </div>
      </fieldset>

      <fieldset>
        <legend>Appearance</legend>
        <div class="field">
          <span class="label" id="theme-label">Theme</span>
          <div class="radio-group" role="radiogroup" aria-labelledby="theme-label">${themes}
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Notifications</legend>
        <div class="field check">
          <input type="checkbox" name="emailNotifications" id="email-notifications"${settings.emailNotifications ? ' checked' : ''}>
          <label for="email-notifications">Email notifications</label>
        </div>
        <div class="field check">
          <input type="checkbox" name="weeklyDigest" id="weekly-digest"${settings.weeklyDigest ? ' checked' : ''}>
          <label for="weekly-digest">Weekly digest</label>
        </div>
        <div class="field">
          <label for="timezone">Timezone</label>
          <select name="timezone" id="timezone">${timezones}</select>
        </div>
      </fieldset>

      <fieldset>
        <legend>Password</legend>
        <div class="row">
          <div class="field">
            <label for="current-password">Current password</label>
            <input type="password" name="currentPassword" id="current-password" autocomplete="current-password" required>
          </div>
          <div class="field">
            <label for="new-password">New password</label>
            <input type="password" name="newPassword" id="new-password" autocomplete="new-password" required minlength="8">
            <span class="hint">At least 8 characters.</span>
          </div>
        </div>
      </fieldset>

      <button class="btn" type="submit" data-testid="save-settings">Save changes</button>
    </form>`;

  return renderLayout({ title: 'Account settings', page: 'settings', body, demo, styles: EXAMPLE_STYLES, script: '/examples/settings.js' });
}
