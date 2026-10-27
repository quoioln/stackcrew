Goes to `src/features/kyc-registrations/schemas/register-kyc.schema.spec.ts`.

```ts
// Default location: src/features/kyc-registrations/schemas/register-kyc.schema.spec.ts
import { describe, expect, it } from 'vitest';
import { kycRegistrationText } from '../kyc-registration.messages';
import { registerKycSchema } from './register-kyc.schema';

const VALID = { fullName: '  Nguyen Van A ', dateOfBirth: '1990-04-12', documentType: 'NATIONAL_ID', idNumber: '079090001234' };
const errors = kycRegistrationText.errors;

const fieldErrors = (input: unknown): Partial<Record<string, string[]>> => {
  const parsed = registerKycSchema.safeParse(input);
  return parsed.success ? {} : parsed.error.flatten().fieldErrors;
};

describe('registerKycSchema', () => {
  it('accepts a complete registration, trims the name and drops keys the server owns', () => {
    const parsed = registerKycSchema.parse({ ...VALID, applicantId: 'mallory', tenantId: 'tenant-b', status: 'VERIFIED' });
    expect(parsed).toEqual({ fullName: 'Nguyen Van A', dateOfBirth: '1990-04-12', documentType: 'NATIONAL_ID', idNumber: '079090001234' });
  });

  it('names every missing or empty field with constant text', () => {
    expect(fieldErrors({ ...VALID, fullName: '   ', idNumber: '' })).toEqual({ fullName: [errors.required], idNumber: [errors.idNumber] });
    expect(Object.keys(fieldErrors({})).sort()).toEqual(['dateOfBirth', 'documentType', 'fullName', 'idNumber']);
  });

  it('refuses a day that does not exist, a day in the future and another format', () => {
    for (const dateOfBirth of ['2001-02-30', '2999-01-01', '12/04/1990', '1990-4-12', '']) {
      expect(fieldErrors({ ...VALID, dateOfBirth }), dateOfBirth).toEqual({ dateOfBirth: [errors.invalidDate] });
    }
  });

  it('refuses an unknown document type without quoting it back', () => {
    const result = registerKycSchema.safeParse({ ...VALID, documentType: '<script>DRIVER</script>' });
    expect(result.success).toBe(false);
    expect(fieldErrors({ ...VALID, documentType: '<script>DRIVER</script>' })).toEqual({ documentType: [errors.documentType] });
    expect(JSON.stringify(result.error?.flatten())).not.toContain('DRIVER');
  });

  it('accepts 6 to 20 capital letters and digits as the document number, and nothing else', () => {
    expect(fieldErrors({ ...VALID, idNumber: 'C1234567' })).toEqual({});
    for (const idNumber of ['c1234567', '12345', 'A'.repeat(21), '0790-9000', '079 090']) {
      expect(fieldErrors({ ...VALID, idNumber }), idNumber).toEqual({ idNumber: [errors.idNumber] });
    }
  });

  it('refuses a name over the column length', () => {
    expect(fieldErrors({ ...VALID, fullName: 'A'.repeat(201) })).toEqual({ fullName: [errors.tooLong] });
  });
});
```
