Goes to `src/features/kyc-registrations/schemas/register-kyc.schema.ts`.

```ts
// Default location: src/features/kyc-registrations/schemas/register-kyc.schema.ts
import { z } from 'zod';
import { DOCUMENT_TYPES, FULL_NAME_MAX, ID_NUMBER_MAX, ID_NUMBER_MIN } from '../kyc-registration.constants';
import { kycRegistrationText } from '../kyc-registration.messages';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Capital letters and digits, ID_NUMBER_MIN to ID_NUMBER_MAX of them: one check, so one message. */
const ID_NUMBER = new RegExp(`^[A-Z0-9]{${ID_NUMBER_MIN},${ID_NUMBER_MAX}}$`);
const errors = kycRegistrationText.errors;

/** YYYY-MM-DD, a real calendar day (2001-02-30 is not one), not after today (UTC). One check, so one message. */
function isPastDay(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value) && day.getTime() <= Date.now();
}

/**
 * The one schema of the registration: the form validates with it (zodResolver) for the user, the server action parses
 * with it again (safeParse) for security. It runs in the browser too, so it imports only constants and text, never the
 * entity. Every message is constant text: zod 3's own enum message quotes the received value, which would reach the
 * browser and the log line. Unknown keys (an applicantId, a tenant, a status) are stripped: the server sets those.
 */
export const registerKycSchema = z.object({
  fullName: z.string().trim().min(1, errors.required).max(FULL_NAME_MAX, errors.tooLong),
  dateOfBirth: z.string().refine(isPastDay, errors.invalidDate),
  documentType: z.enum(DOCUMENT_TYPES, { errorMap: () => ({ message: errors.documentType }) }),
  idNumber: z.string().trim().regex(ID_NUMBER, errors.idNumber),
});

export type RegisterKycInput = z.infer<typeof registerKycSchema>;
```
