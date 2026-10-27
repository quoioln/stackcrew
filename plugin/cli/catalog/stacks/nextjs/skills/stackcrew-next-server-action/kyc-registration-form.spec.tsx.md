Goes to `src/features/kyc-registrations/components/kyc-registration-form.spec.tsx`.

```tsx
// Default location: src/features/kyc-registrations/components/kyc-registration-form.spec.tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionErrorCode, fail, ok, type ActionResult } from '../../../shared/action-result';
import { registerKyc } from '../actions';
import type { KycRegistrationDto } from '../kyc-registration.dto';
import { kycRegistrationText as text } from '../kyc-registration.messages';
import { KycRegistrationForm } from './kyc-registration-form';

// The server action is the boundary of a client component: the form, react-hook-form, the schema and the shared
// components run for real.
vi.mock('../actions', () => ({ registerKyc: vi.fn() }));

const REGISTERED: KycRegistrationDto = { id: 'reg-1', documentType: 'PASSPORT', status: 'PENDING', submittedAt: '2026-10-27T03:00:00.000Z' };

const fillValid = (): void => {
  fireEvent.change(screen.getByLabelText(text.fields.fullName), { target: { value: 'Nguyen Van A' } });
  fireEvent.change(screen.getByLabelText(text.fields.dateOfBirth), { target: { value: '1990-04-12' } });
  fireEvent.change(screen.getByLabelText(text.fields.documentType), { target: { value: 'PASSPORT' } });
  fireEvent.change(screen.getByLabelText(text.fields.idNumber), { target: { value: 'C1234567' } });
};
const submit = (): void => {
  fireEvent.click(screen.getByRole('button', { name: text.submit }));
};

describe('KycRegistrationForm', () => {
  beforeEach(() => {
    vi.mocked(registerKyc).mockReset();
    render(<KycRegistrationForm />);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the schema errors on their fields and never calls the action with invalid input', async () => {
    submit();

    expect(await screen.findAllByText(text.errors.required)).toHaveLength(1);
    expect(screen.getByLabelText(text.fields.fullName).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(text.errors.invalidDate).id).toBe('kyc-dateOfBirth-error');
    expect(registerKyc).not.toHaveBeenCalled();
  });

  it('sends the parsed values, disables the button while the action runs, then shows the confirmation', async () => {
    let finish: (result: ActionResult<KycRegistrationDto>) => void = () => undefined;
    vi.mocked(registerKyc).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    fillValid();
    submit();

    const pending = await screen.findByRole('button', { name: text.submitting });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect(registerKyc).toHaveBeenCalledWith({ fullName: 'Nguyen Van A', dateOfBirth: '1990-04-12', documentType: 'PASSPORT', idNumber: 'C1234567' });

    finish(ok(REGISTERED));
    expect((await screen.findByRole('status')).textContent).toBe(text.submitted);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('puts the server field errors on their fields and shows the refusal', async () => {
    vi.mocked(registerKyc).mockResolvedValue(fail(ActionErrorCode.VALIDATION, { idNumber: [text.errors.idNumber] }));
    fillValid();
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe(text.refusals.VALIDATION);
    expect(screen.getByText(text.errors.idNumber).id).toBe('kyc-idNumber-error');
    expect(screen.getByLabelText(text.fields.idNumber).getAttribute('aria-describedby')).toBe('kyc-idNumber-error');
  });

  it('shows the CONFLICT refusal and keeps the form for another attempt', async () => {
    vi.mocked(registerKyc).mockResolvedValue(fail(ActionErrorCode.CONFLICT));
    fillValid();
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe(text.refusals.CONFLICT);
    expect((screen.getByRole('button', { name: text.submit }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows constant text when the action throws, never the exception message', async () => {
    vi.mocked(registerKyc).mockRejectedValue(new Error('pool exhausted for idNumber C1234567'));
    fillValid();
    submit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(text.unexpected);
    await waitFor(() => expect((screen.getByRole('button', { name: text.submit }) as HTMLButtonElement).disabled).toBe(false));
    expect(document.body.textContent).not.toContain('pool exhausted');
  });
});
```
