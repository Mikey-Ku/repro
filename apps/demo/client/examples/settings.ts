// Account settings example. Bug class: a failed request with no uncaught error.
import { byId, demo, hideAlert, query, repro, showAlert } from './shared.js';

interface SettingsPayload {
  displayName: string;
  bio: string;
  theme: string;
  emailNotifications: boolean;
  weeklyDigest: boolean;
  timezone: string;
  currentPassword: string;
  newPassword: string;
}
interface SaveResponse {
  ok: boolean;
  savedAt?: string;
  error?: string;
}

const form = byId<HTMLFormElement>('settings-form');
const button = query<HTMLButtonElement>('[data-testid="save-settings"]');
const error = query<HTMLElement>('[data-testid="settings-error"]');
const toastSlot = byId<HTMLElement>('toast-slot');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void save();
});

function readForm(): SettingsPayload {
  const data = new FormData(form);
  const value = (key: string) => String(data.get(key) ?? '');
  return {
    displayName: value('displayName'),
    bio: value('bio'),
    theme: value('theme'),
    emailNotifications: data.get('emailNotifications') === 'on',
    weeklyDigest: data.get('weeklyDigest') === 'on',
    timezone: value('timezone'),
    currentPassword: value('currentPassword'),
    newPassword: value('newPassword'),
  };
}

async function save(): Promise<void> {
  hideAlert(error);
  toastSlot.replaceChildren();
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const response = await sendSettings(readForm());
    if (response.ok) {
      const data = (await response.json()) as SaveResponse;
      byId<HTMLInputElement>('current-password').value = '';
      byId<HTMLInputElement>('new-password').value = '';
      showToast(data.savedAt);
      repro.annotate('settings:saved');
    }
  } catch (cause) {
    showAlert(error, 'Network error while saving.');
    repro.captureException(cause, { where: 'settings' });
  } finally {
    button.disabled = false;
    button.textContent = 'Save changes';
  }
}

/**
 * Sends the form to the API. Both code paths live here on purpose so the difference is one header.
 * The API is right to refuse a body it cannot parse; the bug is that the page never says so.
 */
async function sendSettings(payload: SettingsPayload): Promise<Response> {
  const body = JSON.stringify(payload);
  if (demo.mode === 'broken') {
    // BUG (broken mode): the body is JSON but the header says text/plain, so the API answers 415.
    // The status is only logged; the form stays exactly as it was and the user never learns the save failed.
    const response = await fetch('/api/examples/settings', {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body,
    });
    if (!response.ok) console.error('Save failed', response.status);
    return response;
  }
  // FIX: declare the body as JSON, and show a failed save in the form instead of the console.
  const response = await fetch('/api/examples/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (!response.ok) {
    const data = (await response.json()) as SaveResponse;
    showAlert(error, data.error ?? 'We could not save your settings.');
  }
  return response;
}

function showToast(savedAt: string | undefined): void {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.dataset.testid = 'settings-saved';
  toast.textContent = 'Settings saved';
  if (savedAt) toast.title = `Saved at ${savedAt}`;
  toastSlot.replaceChildren(toast);
}
