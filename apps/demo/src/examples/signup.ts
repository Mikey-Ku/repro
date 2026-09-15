import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const ROLES = ['engineer', 'designer', 'product', 'founder', 'other'] as const;
export const ROLE_LABELS: Record<(typeof ROLES)[number], string> = {
  engineer: 'Engineer',
  designer: 'Designer',
  product: 'Product manager',
  founder: 'Founder',
  other: 'Other',
};

/**
 * Presence checks only for the secrets. Generated reproduction tests replace the password and
 * the one-time code with redacted placeholders, and those must still be accepted so the replay
 * reaches the frontend behaviour under test.
 */
export const SignupBody = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().trim().min(1, 'Full name is required').max(80, 'Full name is too long'),
  role: z.enum(ROLES),
  terms: z.literal(true, { error: 'You must agree to the terms' }),
  code: z.string().trim().min(1, 'Verification code is required').max(64, 'Verification code is too long'),
});
export type SignupInput = z.infer<typeof SignupBody>;

export interface SignupUser {
  id: string;
  name: string;
  email: string;
}

export function createUser(input: SignupInput): SignupUser {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (const byte of randomBytes(6)) suffix += alphabet[byte % alphabet.length];
  return { id: `usr_${suffix}`, name: input.fullName, email: input.email };
}
