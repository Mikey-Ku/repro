/**
 * Canary corpus. Every value is unique and greppable so a leak shows up as an exact substring
 * match in the serialised payload. Tests seed them into forms, urls, headers and bodies.
 */
export const CANARIES = {
  CANARY_PASSWORD_: 'CANARY_PASSWORD_9f3a1c7e2b',
  CANARY_CARD_: 'CANARY_CARD_4111111111111111',
  CANARY_CVC_: 'CANARY_CVC_7318',
  CANARY_EXPIRY_: 'CANARY_EXPIRY_1229',
  CANARY_TOKEN_: 'CANARY_TOKEN_5d2e8b1f0a',
  CANARY_COOKIE_: 'CANARY_COOKIE_c0ffee4211',
  CANARY_BEARER_: 'CANARY_BEARER_a1b2c3d4e5',
  CANARY_QS_: 'CANARY_QS_77aa88bb99',
  CANARY_APIKEY_: 'CANARY_APIKEY_0011223344',
  CANARY_MASKED_TEXT_: 'CANARY_MASKED_TEXT_6e6f7365',
  CANARY_BLOCKED_: 'CANARY_BLOCKED_5b5b5b5b5b',
  CANARY_RESPONSE_SECRET_: 'CANARY_RESPONSE_SECRET_4f4f4f4f',
  CANARY_REQUEST_BODY_: 'CANARY_REQUEST_BODY_2a2a2a2a',
  CANARY_IGNORED_: 'CANARY_IGNORED_ffeeddcc',
  CANARY_STRICT_TEXT_: 'CANARY_STRICT_TEXT_31415926',
  CANARY_SESSION_: 'CANARY_SESSION_8899aabbcc',
  CANARY_HIDDEN_: 'CANARY_HIDDEN_deadbeef01',
} as const;

export type CanaryName = keyof typeof CANARIES;

export const CANARY_VALUES: string[] = Object.values(CANARIES);
