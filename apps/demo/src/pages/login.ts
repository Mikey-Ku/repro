import { renderLayout, type DemoPageConfig } from '../layout.js';

export function renderLoginPage(demo: DemoPageConfig): string {
  const body = `
    <h1>Sign in</h1>
    <p class="lede">Welcome back. Sign in to finish your order.</p>
    <p class="alert" role="alert" data-testid="login-error" data-visible="false"></p>
    <form data-testid="login-form" id="login-form" method="post" action="/api/login" novalidate>
      <div class="field">
        <label for="email">Email</label>
        <input type="email" name="email" id="email" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" name="password" id="password" autocomplete="current-password" required minlength="8">
        <span class="hint">At least 8 characters.</span>
      </div>
      <button class="btn" type="submit" data-testid="sign-in">Sign in</button>
    </form>`;
  return renderLayout({ title: 'Sign in', page: 'login', body, demo });
}
