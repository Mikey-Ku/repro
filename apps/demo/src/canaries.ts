import canariesJson from '../canaries.json';

/**
 * Canary secrets planted throughout the demo. Privacy tests elsewhere in the repo
 * read canaries.json and assert that none of these values ever reach the ingest API.
 */
export interface Canaries {
  password: string;
  cardNumber: string;
  cvc: string;
  expiry: string;
  token: string;
  cookie: string;
  bearerHeader: string;
  queryToken: string;
  apiKey: string;
  maskedText: string;
  blockedText: string;
  responseSecret: string;
}

export const canaries: Canaries = canariesJson;
