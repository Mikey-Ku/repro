import { ROLES, ROLE_LABELS } from '../../examples/signup.js';
import { escapeHtml } from '../../html.js';
import { renderLayout, type DemoPageConfig } from '../../layout.js';
import { EXAMPLE_STYLES } from './styles.js';

export function renderSignupPage(demo: DemoPageConfig): string {
  const roles = ROLES.map((role) => `<option value="${role}">${escapeHtml(ROLE_LABELS[role])}</option>`).join('');

  const body = `
    <h1>Create your account</h1>
    <p class="lede">Three short steps. We will send a verification code to your email on the last one.</p>

    <ol class="steps" aria-label="Progress">
      <li data-step="1" aria-current="step">1. Account</li>
      <li data-step="2">2. Profile</li>
      <li data-step="3">3. Verify</li>
    </ol>

    <div id="welcome-slot"></div>
    <p class="alert" role="alert" data-testid="signup-error" data-visible="false"></p>

    <form data-testid="signup-form" id="signup-form" method="post" action="/api/examples/signup" novalidate>
      <fieldset id="step-1" data-testid="step-1">
        <legend>Step 1 of 3: Account</legend>
        <div class="field">
          <label for="signup-email">Email</label>
          <input type="email" name="email" id="signup-email" autocomplete="email" required>
        </div>
        <div class="field">
          <label for="signup-password">Password</label>
          <input type="password" name="password" id="signup-password" autocomplete="new-password" required minlength="8">
          <span class="hint">At least 8 characters.</span>
        </div>
        <button class="btn" type="button" data-testid="step1-next">Continue</button>
      </fieldset>

      <fieldset id="step-2" data-testid="step-2" hidden>
        <legend>Step 2 of 3: Profile</legend>
        <div class="field">
          <label for="full-name">Full name</label>
          <input type="text" name="fullName" id="full-name" autocomplete="name" required>
        </div>
        <div class="field">
          <label for="role">Role</label>
          <select name="role" id="role">${roles}</select>
        </div>
        <div class="field check">
          <input type="checkbox" name="terms" id="terms" required>
          <label for="terms">I agree to the terms</label>
        </div>
        <button class="btn" type="button" data-testid="step2-next">Continue</button>
      </fieldset>

      <fieldset id="step-3" data-testid="step-3" hidden>
        <legend>Step 3 of 3: Verify</legend>
        <div class="field">
          <label for="verification-code">Verification code</label>
          <input type="password" name="code" id="verification-code" autocomplete="one-time-code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required>
          <span class="hint" id="code-hint">Enter the 6-digit code we emailed you.</span>
        </div>
        <button class="btn" type="submit" data-testid="finish" aria-disabled="true">Finish</button>
      </fieldset>
    </form>`;

  return renderLayout({ title: 'Sign up', page: 'signup', body, demo, styles: EXAMPLE_STYLES, script: '/examples/signup.js' });
}
