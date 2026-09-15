import { z } from 'zod';

export const FOLDERS = ['inbox', 'archive', 'sent'] as const;
export type Folder = (typeof FOLDERS)[number];

/** The client-side routes; the server serves the same page for all three. */
export const INBOX_PATHS: Record<Folder, string> = {
  inbox: '/examples/inbox',
  archive: '/examples/inbox/archive',
  sent: '/examples/inbox/sent',
};

export interface Message {
  id: string;
  folder: Folder;
  from: string;
  to: string;
  subject: string;
  body: string;
  at: string;
}

export const MessageBody = z.object({
  to: z.email('Enter a valid email address'),
  subject: z.string().trim().min(1, 'Subject is required').max(200, 'Subject is too long'),
  body: z.string().trim().min(1, 'Message body is required').max(5000, 'Message is too long'),
});
export type MessageInput = z.infer<typeof MessageBody>;

const ME = 'ada@example.com';

const SEED: Message[] = [
  { id: 'msg_1007', folder: 'inbox', from: 'sam@northwind.example', to: ME, subject: 'Your order NW-1021 is on its way', body: 'The courier picked it up this morning. Expect it by Thursday.', at: '2026-09-12T09:14:00Z' },
  { id: 'msg_1006', folder: 'inbox', from: 'grace@example.com', to: ME, subject: 'Notebook recommendations?', body: 'You mentioned a dotted A5 that lies flat. Which one was it?', at: '2026-09-11T16:40:00Z' },
  { id: 'msg_1005', folder: 'inbox', from: 'billing@northwind.example', to: ME, subject: 'Receipt for September', body: 'Your receipt is attached. Thanks for shopping with Northwind Supply.', at: '2026-09-10T08:02:00Z' },
  { id: 'msg_1004', folder: 'inbox', from: 'alan@example.com', to: ME, subject: 'Lunch on Friday', body: 'Same place as last time? I will book a table for 12:30.', at: '2026-09-09T12:05:00Z' },
  { id: 'msg_1003', folder: 'archive', from: 'sam@northwind.example', to: ME, subject: 'Welcome to Northwind Supply', body: 'Thanks for creating an account. Here is what to expect from us.', at: '2026-08-28T10:00:00Z' },
  { id: 'msg_1002', folder: 'archive', from: 'katherine@example.com', to: ME, subject: 'Slides from the talk', body: 'As promised, the slides. Let me know if the link does not work.', at: '2026-08-21T15:30:00Z' },
  { id: 'msg_1001', folder: 'sent', from: ME, to: 'grace@example.com', subject: 'Re: Notebook recommendations?', body: 'It was the Field notebook, dotted. Northwind still stocks it.', at: '2026-09-11T17:02:00Z' },
];

/** In-memory mailbox. Seeded messages come back after a restart; sent ones do not, on purpose. */
export class MessageStore {
  private messages: Message[] = SEED.map((m) => ({ ...m }));
  private nextId = 1008;

  list(folder: Folder): Message[] {
    return this.messages.filter((m) => m.folder === folder).sort((a, b) => b.at.localeCompare(a.at));
  }

  send(input: MessageInput, now = new Date()): Message {
    const message: Message = {
      id: `msg_${this.nextId}`,
      folder: 'sent',
      from: ME,
      to: input.to,
      subject: input.subject,
      body: input.body,
      at: now.toISOString(),
    };
    this.nextId += 1;
    this.messages.push(message);
    return message;
  }
}
