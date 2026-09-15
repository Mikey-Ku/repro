// Inbox example. Bug class: a TypeError in a DOM handler that leaves a modal stuck open.
import { JSON_HEADERS, byId, demo, hideAlert, query, repro, showAlert } from './shared.js';

type Folder = 'inbox' | 'archive' | 'sent';
interface Message {
  id: string;
  folder: Folder;
  from: string;
  to: string;
  subject: string;
  body: string;
  at: string;
}
interface ListResponse {
  ok: boolean;
  messages: Message[];
}
interface SendResponse {
  ok: boolean;
  message?: Message;
  error?: string;
}

const ROUTES: Record<string, Folder> = {
  '/examples/inbox': 'inbox',
  '/examples/inbox/archive': 'archive',
  '/examples/inbox/sent': 'sent',
};
const TITLES: Record<Folder, string> = { inbox: 'Inbox', archive: 'Archive', sent: 'Sent' };

const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.folders a'));
const title = byId<HTMLElement>('folder-title');
const statusSlot = byId<HTMLElement>('inbox-status');
const list = byId<HTMLUListElement>('message-list');
const dialog = byId<HTMLDialogElement>('compose-dialog');
const form = byId<HTMLFormElement>('compose-form');
const composeError = query<HTMLElement>('[data-testid="compose-error"]');
const sendButton = query<HTMLButtonElement>('[data-testid="send"]');

for (const link of links) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    statusSlot.replaceChildren();
    history.pushState({}, '', link.getAttribute('href') ?? '/examples/inbox');
    void renderRoute();
  });
}
window.addEventListener('popstate', () => void renderRoute());
query<HTMLButtonElement>('[data-testid="compose"]').addEventListener('click', () => {
  hideAlert(composeError);
  dialog.showModal();
  byId<HTMLInputElement>('compose-to').focus();
});
query<HTMLButtonElement>('[data-testid="cancel"]').addEventListener('click', () => dialog.close());
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void send();
});
void renderRoute();

function currentFolder(): Folder {
  return ROUTES[location.pathname.replace(/\/+$/, '')] ?? 'inbox';
}

async function renderRoute(): Promise<void> {
  const folder = currentFolder();
  for (const link of links) {
    if (link.dataset.folder === folder) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  title.textContent = TITLES[folder];
  document.title = `${TITLES[folder]} · Northwind Supply`;
  try {
    const response = await fetch(`/api/examples/inbox/messages?folder=${folder}`);
    const data = (await response.json()) as ListResponse;
    renderList(data.messages, folder);
    repro.annotate('inbox:folder', { folder });
  } catch (cause) {
    renderEmpty('We could not load this folder. Please refresh the page.');
    repro.captureException(cause, { where: 'inbox:list' });
  }
}

function renderEmpty(text: string): void {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  list.replaceChildren(li);
}

function renderList(messages: Message[], folder: Folder): void {
  if (messages.length === 0) {
    renderEmpty('Nothing here yet.');
    return;
  }
  const items = messages.map((message) => {
    const li = document.createElement('li');
    li.dataset.testid = `message-${message.id}`;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = folder === 'sent' ? `To ${message.to}` : message.from;
    const subject = document.createElement('span');
    subject.className = 'subject';
    subject.textContent = message.subject;
    const snippet = document.createElement('span');
    snippet.className = 'snippet';
    snippet.textContent = message.body.length > 80 ? `${message.body.slice(0, 80)}…` : message.body;
    subject.appendChild(snippet);
    const time = document.createElement('time');
    time.dateTime = message.at;
    time.textContent = new Date(message.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    li.append(who, subject, time);
    return li;
  });
  list.replaceChildren(...items);
}

function readCompose(): { to: string; subject: string; body: string } {
  const data = new FormData(form);
  const value = (key: string) => String(data.get(key) ?? '');
  return { to: value('to'), subject: value('subject'), body: value('body') };
}

async function send(): Promise<void> {
  hideAlert(composeError);
  sendButton.disabled = true;
  try {
    const response = await fetch('/api/examples/inbox/messages', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(readCompose()),
    });
    const data = (await response.json()) as SendResponse;
    if (!response.ok || !data.ok || !data.message) {
      showAlert(composeError, data.error ?? 'We could not send your message.');
      return;
    }
    repro.annotate('inbox:sent');
    finishSend(data.message);
  } finally {
    sendButton.disabled = false;
  }
}

/**
 * Closes the compose dialog and shows the sent message. Both code paths live here on purpose:
 * the only difference is one character in an element id.
 */
function finishSend(message: Message): void {
  if (demo.mode === 'broken') {
    // BUG (broken mode): the id is misspelled ("dialg"), so getElementById returns null and
    // calling .close() on it throws a TypeError. The dialog stays open and the message never shows.
    (document.getElementById('compose-dialg') as HTMLDialogElement).close();
  } else {
    // FIX: the real id. The dialog closes and the rest of this function runs.
    (document.getElementById('compose-dialog') as HTMLDialogElement).close();
  }
  form.reset();
  history.pushState({}, '', '/examples/inbox/sent');
  const status = document.createElement('p');
  status.className = 'toast';
  status.setAttribute('role', 'status');
  status.dataset.testid = 'message-sent';
  status.textContent = `Message sent to ${message.to}`;
  statusSlot.replaceChildren(status);
  void renderRoute();
}
