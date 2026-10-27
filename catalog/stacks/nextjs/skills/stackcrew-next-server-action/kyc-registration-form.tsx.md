Goes to `src/features/kyc-registrations/components/kyc-registration-form.tsx`.

```tsx
// Default location: src/features/kyc-registrations/components/kyc-registration-form.tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
// Shared components: imports use the project's alias for {{sc:sharedComponents}} (shadcn components.json → aliases.ui;
// cn at aliases.utils). These assume @/components/ui and @/lib/utils.
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import type { ActionResult } from '../../../shared/action-result';
import { registerKyc } from '../actions';
import { DOCUMENT_TYPES, DocumentType } from '../kyc-registration.constants';
import type { KycRegistrationDto } from '../kyc-registration.dto';
import { kycRegistrationText as text } from '../kyc-registration.messages';
import { registerKycSchema, type RegisterKycInput } from '../schemas/register-kyc.schema';

const EMPTY: RegisterKycInput = { fullName: '', dateOfBirth: '', documentType: DocumentType.NATIONAL_ID, idNumber: '' };
const FIELDS = registerKycSchema.keyof().options;
const SERVER_ERROR = 'root.server';
const fieldId = (field: keyof RegisterKycInput): string => `kyc-${field}`;
const errorId = (field: keyof RegisterKycInput): string => `kyc-${field}-error`;

/**
 * The eKYC registration form. react-hook-form validates with the action's own schema (zodResolver), then calls the
 * server action with the parsed values. States: pending (the button is disabled while the action runs), success (the
 * confirmation replaces the form and takes the focus), refusal (the server's field errors on their fields, the refusal text above the
 * button) and unexpected failure (constant text; the server already logged it).
 */
export function KycRegistrationForm() {
  const [registered, setRegistered] = useState<KycRegistrationDto | null>(null);
  const confirmation = useRef<HTMLParagraphElement>(null);
  const form = useForm<RegisterKycInput>({ resolver: zodResolver(registerKycSchema), defaultValues: EMPTY });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    confirmation.current?.focus(); // the form the user was in is gone: put them on what replaced it
  }, [registered]);

  const onSubmit = async (values: RegisterKycInput): Promise<void> => {
    let result: ActionResult<KycRegistrationDto>;
    try {
      result = await registerKyc(values);
    } catch {
      // A thrown action (a 500, a lost connection) rejects here and never reaches error.tsx. The server logged it with
      // its digest; the user gets constant text, never the exception message.
      form.setError(SERVER_ERROR, { message: text.unexpected });
      return;
    }
    if (result.ok) {
      setRegistered(result.data);
      return;
    }
    for (const field of FIELDS) {
      const message = result.error.fieldErrors?.[field]?.[0];
      if (message !== undefined) {
        form.setError(field, { message });
      }
    }
    form.setError(SERVER_ERROR, { message: text.refusals[result.error.code] });
  };

  if (registered !== null) {
    return (
      <p ref={confirmation} tabIndex={-1} role="status" className="rounded-lg border bg-muted p-4 text-sm outline-none">
        {text.submitted}
      </p>
    );
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} aria-busy={isSubmitting} className={cn('grid max-w-md gap-4', isSubmitting && 'opacity-70')}>
      <p className="text-sm text-muted-foreground">{text.intro}</p>
      <div className="grid gap-2">
        <Label htmlFor={fieldId('fullName')}>{text.fields.fullName}</Label>
        <Input
          id={fieldId('fullName')}
          autoComplete="name"
          aria-invalid={errors.fullName !== undefined}
          aria-describedby={errors.fullName === undefined ? undefined : errorId('fullName')}
          {...form.register('fullName')}
        />
        <FieldMessage id={errorId('fullName')} message={errors.fullName?.message} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={fieldId('dateOfBirth')}>{text.fields.dateOfBirth}</Label>
        <Input
          id={fieldId('dateOfBirth')}
          type="date"
          autoComplete="bday"
          aria-invalid={errors.dateOfBirth !== undefined}
          aria-describedby={errors.dateOfBirth === undefined ? undefined : errorId('dateOfBirth')}
          {...form.register('dateOfBirth')}
        />
        <FieldMessage id={errorId('dateOfBirth')} message={errors.dateOfBirth?.message} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={fieldId('documentType')}>{text.fields.documentType}</Label>
        <NativeSelect
          id={fieldId('documentType')}
          aria-invalid={errors.documentType !== undefined}
          aria-describedby={errors.documentType === undefined ? undefined : errorId('documentType')}
          {...form.register('documentType')}
        >
          {DOCUMENT_TYPES.map((type) => (
            <NativeSelectOption key={type} value={type}>
              {text.documentTypes[type]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldMessage id={errorId('documentType')} message={errors.documentType?.message} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={fieldId('idNumber')}>{text.fields.idNumber}</Label>
        <Input
          id={fieldId('idNumber')}
          autoComplete="off"
          aria-invalid={errors.idNumber !== undefined}
          aria-describedby={errors.idNumber === undefined ? undefined : errorId('idNumber')}
          {...form.register('idNumber')}
        />
        <FieldMessage id={errorId('idNumber')} message={errors.idNumber?.message} />
      </div>
      {errors.root?.server?.message !== undefined && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? text.submitting : text.submit}
      </Button>
    </form>
  );
}

function FieldMessage({ id, message }: { id: string; message: string | undefined }) {
  return message === undefined ? null : (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}
```
