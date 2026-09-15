import { FOLDERS, INBOX_PATHS, type Folder } from '../../examples/inbox.js';
import { escapeHtml } from '../../html.js';
import { renderLayout, type DemoPageConfig } from '../../layout.js';
import { EXAMPLE_STYLES } from './styles.js';

export const FOLDER_TITLES: Record<Folder, string> = { inbox: 'Inbox', archive: 'Archive', sent: 'Sent' };

/** The same page for every folder path; the bundle reads the route from location and renders it. */
export function renderInboxPage(demo: DemoPageConfig, folder: Folder): string {
  const links = FOLDERS.map(
    (name) =>
      `<a href="${INBOX_PATHS[name]}" data-folder="${name}"${name === folder ? ' aria-current="page"' : ''}>${FOLDER_TITLES[name]}</a>`,
  ).join('\n      ');

  const body = `
    <h1>Mail</h1>
    <p class="lede">A single-page mailbox. Folder links change the URL without reloading; "New message" opens a dialog.</p>

    <nav class="folders" aria-label="Folders">
      ${links}
    </nav>

    <div class="inbox-head">
      <h2 id="folder-title">${escapeHtml(FOLDER_TITLES[folder])}</h2>
      <button class="btn" type="button" data-testid="compose">New message</button>
    </div>
    <div id="inbox-status" aria-live="polite"></div>
    <ul class="messages" data-testid="message-list" id="message-list"><li class="empty">Loading messages…</li></ul>

    <dialog data-testid="compose-dialog" id="compose-dialog" aria-labelledby="compose-title">
      <h2 id="compose-title">New message</h2>
      <p class="alert" role="alert" data-testid="compose-error" data-visible="false"></p>
      <form data-testid="compose-form" id="compose-form" method="post" action="/api/examples/inbox/messages" novalidate>
        <div class="field">
          <label for="compose-to">To</label>
          <input type="email" name="to" id="compose-to" autocomplete="off" required>
        </div>
        <div class="field">
          <label for="compose-subject">Subject</label>
          <input type="text" name="subject" id="compose-subject" autocomplete="off" required>
          <span class="hint">Press Enter here to send.</span>
        </div>
        <div class="field">
          <label for="compose-body">Body</label>
          <textarea name="body" id="compose-body" rows="5" required></textarea>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-secondary" type="button" data-testid="cancel">Cancel</button>
          <button class="btn" type="submit" data-testid="send">Send</button>
        </div>
      </form>
    </dialog>`;

  return renderLayout({ title: FOLDER_TITLES[folder], page: 'inbox', body, demo, styles: EXAMPLE_STYLES, script: '/examples/inbox.js' });
}
