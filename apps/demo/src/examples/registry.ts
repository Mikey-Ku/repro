/**
 * The examples gallery: four small applications that live next to the Northwind checkout, each
 * built around one foundational UI element and broken in a different way. They share the
 * checkout's global broken|fixed mode, so the reproduction runner drives them unchanged.
 */
export interface ExampleMeta {
  slug: 'settings' | 'inbox' | 'orders' | 'signup';
  path: string;
  title: string;
  /** The foundational UI element the example is built around. */
  element: string;
  /** The class of bug the broken mode exhibits. */
  bugClass: string;
  /** The data-testid a fixed build renders when the workflow succeeds. Tests generate against it. */
  successTestId: string;
  /** One sentence for the gallery card. */
  summary: string;
}

export const EXAMPLES: readonly ExampleMeta[] = [
  {
    slug: 'settings',
    path: '/examples/settings',
    title: 'Account settings',
    element: 'Form with text, textarea, radio, checkbox, select and password controls',
    bugClass: 'Failed request with no uncaught error',
    successTestId: 'settings-saved',
    summary: 'Saving the form sends JSON with a text/plain header; the API refuses it and the page says nothing.',
  },
  {
    slug: 'inbox',
    path: '/examples/inbox',
    title: 'Inbox',
    element: 'Client-side routing with a modal dialog',
    bugClass: 'TypeError in a DOM handler, modal stuck',
    successTestId: 'message-sent',
    summary: 'Sending a message succeeds on the server, then a misspelled element id throws and the dialog never closes.',
  },
  {
    slug: 'orders',
    path: '/examples/orders',
    title: 'Orders',
    element: 'Sortable, filterable, paginated table',
    bugClass: 'Exception on user interaction with real data',
    successTestId: 'orders-table',
    summary: 'Sorting by total calls toFixed on an order that has no price yet, and the table is replaced by a spinner forever.',
  },
  {
    slug: 'signup',
    path: '/examples/signup',
    title: 'Sign-up wizard',
    element: 'Three-step wizard with a one-time code',
    bugClass: 'Purely visual failure: no error, no failed request',
    successTestId: 'welcome',
    summary: 'The last step checks the code for seven characters instead of six, so Finish never enables and nothing is logged.',
  },
];

/** The shape served by GET /__demo/examples and documented in docs/EXAMPLES.md. */
export function publicExampleMeta(example: ExampleMeta) {
  const { slug, path, title, element, bugClass, successTestId } = example;
  return { slug, path, title, element, bugClass, successTestId };
}
