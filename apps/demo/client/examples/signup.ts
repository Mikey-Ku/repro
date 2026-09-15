// Sign-up wizard example. Bug class: a purely visual failure with no error and no failed request.
import { JSON_HEADERS, byId, demo, hideAlert, query, repro, showAlert } from './shared.js';

interface SignupResponse {
  ok: boolean;
  user?: { id: string; name: string; email: string };
  error?: string;
}

const form = byId<HTMLFormElement>('signup-form');
const steps = [byId<HTMLFieldSetElement>('step-1'), byId<HTMLFieldSetElement>('step-2'), byId<HTMLFieldSetElement>('step-3')];
const progress = Array.from(document.querySelectorAll<HTMLElement>('.steps li'));
const error = query<HTMLElement>('[data-testid="signup-error"]');
const email = byId<HTMLInputElement>('signup-email');
const password = byId<HTMLInputElement>('signup-password');
const fullName = byId<HTMLInputElement>('full-name');
const role = byId<HTMLSelectElement>('role');
const terms = byId<HTMLInputElement>('terms');
const code = byId<HTMLInputElement>('verification-code');
const finishButton = query<HTMLButtonElement>('[data-testid="finish"]');
let step = 1;

query<HTMLButtonElement>('[data-testid="step1-next"]').addEventListener('click', () => {
  if (validateStep1()) showStep(2);
});
query<HTMLButtonElement>('[data-testid="step2-next"]').addEventListener('click', () => {
  if (validateStep2()) showStep(3);
});
code.addEventListener('input', updateFinish);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  // Enter in an earlier step advances it, like its Continue button. Finish only works with a complete code.
  if (step === 1) {
    if (validateStep1()) showStep(2);
  } else if (step === 2) {
    if (validateStep2()) showStep(3);
  } else if (isCodeComplete(code.value)) {
    void finishSignup();
  }
});

function validateStep1(): boolean {
  hideAlert(error);
  if (!email.value.trim() || !email.validity.valid) {
    showAlert(error, 'Enter a valid email address.');
    return false;
  }
  if (password.value.length < 8) {
    showAlert(error, 'Password must be at least 8 characters.');
    return false;
  }
  return true;
}

function validateStep2(): boolean {
  hideAlert(error);
  if (!fullName.value.trim()) {
    showAlert(error, 'Enter your full name.');
    return false;
  }
  if (!terms.checked) {
    showAlert(error, 'You must agree to the terms.');
    return false;
  }
  return true;
}

function showStep(next: number): void {
  step = next;
  hideAlert(error);
  steps.forEach((fieldset, index) => {
    fieldset.hidden = index !== next - 1;
  });
  progress.forEach((item, index) => {
    if (index === next - 1) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
    item.dataset.done = String(index < next - 1);
  });
  if (next === 2) fullName.focus();
  if (next === 3) {
    byId<HTMLElement>('code-hint').textContent = `Enter the 6-digit code we emailed to ${email.value.trim()}.`;
    code.focus();
  }
  repro.annotate('signup:step', { step: next });
}

/**
 * Whether the one-time code is complete. Both code paths live here on purpose: the input has
 * maxlength 6, so the number this compares against decides whether Finish can ever enable.
 */
function isCodeComplete(value: string): boolean {
  if (demo.mode === 'broken') {
    // BUG (broken mode): off by one. The input caps the value at six characters, so this is never true,
    // Finish stays visually disabled, and nothing but a console.warn per keystroke says why.
    return value.length === 7;
  }
  // FIX: a code is complete at six characters.
  return value.length === 6;
}

function updateFinish(): void {
  const complete = isCodeComplete(code.value);
  if (!complete) console.warn('code incomplete');
  // aria-disabled rather than disabled: a disabled button swallows the click a user makes on it,
  // and that click is exactly what a recording of this bug needs to contain.
  if (complete) finishButton.removeAttribute('aria-disabled');
  else finishButton.setAttribute('aria-disabled', 'true');
}

async function finishSignup(): Promise<void> {
  hideAlert(error);
  finishButton.disabled = true;
  finishButton.textContent = 'Creating account…';
  try {
    const response = await fetch('/api/examples/signup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        email: email.value.trim(),
        password: password.value,
        fullName: fullName.value.trim(),
        role: role.value,
        terms: terms.checked,
        code: code.value,
      }),
    });
    const data = (await response.json()) as SignupResponse;
    if (!response.ok || !data.ok || !data.user) {
      showAlert(error, data.error ?? 'We could not create your account.');
      return;
    }
    repro.identify(data.user.id, { role: role.value });
    repro.annotate('signup:complete');
    renderWelcome(data.user.name);
  } catch (cause) {
    showAlert(error, 'Network error while creating your account.');
    repro.captureException(cause, { where: 'signup' });
  } finally {
    finishButton.disabled = false;
    finishButton.textContent = 'Finish';
  }
}

function renderWelcome(name: string): void {
  const section = document.createElement('section');
  section.className = 'confirmation';
  section.dataset.testid = 'welcome';
  section.setAttribute('role', 'status');
  const heading = document.createElement('h2');
  heading.textContent = `Welcome, ${name}`;
  const detail = document.createElement('p');
  detail.textContent = 'Your account is ready. A confirmation is on its way to your inbox.';
  section.append(heading, detail);
  byId<HTMLElement>('welcome-slot').replaceChildren(section);
  form.hidden = true;
  for (const item of progress) {
    item.removeAttribute('aria-current');
    item.dataset.done = 'true';
  }
  section.focus();
}
