Goes to `src/features/kyc-registrations/components/kyc-registration-table.spec.tsx`.

```tsx
// Default location: src/features/kyc-registrations/components/kyc-registration-table.spec.tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { KycRegistrationRowDto } from '../kyc-registration-row.dto';
import { kycRegistrationListText as text } from '../kyc-registration-list.messages';
import { KycRegistrationTable } from './kyc-registration-table';

const ROWS: KycRegistrationRowDto[] = [
  { id: 'reg-2', fullName: 'Tran Thi B', documentType: 'PASSPORT', status: 'VERIFIED', submittedAt: '2026-10-27T03:00:00.000Z' },
  { id: 'reg-1', fullName: 'Nguyen Van A', documentType: 'NATIONAL_ID', status: 'PENDING', submittedAt: '2026-10-26T23:30:00.000Z' },
];

describe('KycRegistrationTable', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders one row per DTO with the labels of the catalog and the date in UTC', () => {
    render(<KycRegistrationTable rows={ROWS} />);

    const table = screen.getByRole('table', { name: text.caption });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(Object.values(text.columns));
    const [, first, second] = within(table).getAllByRole('row');
    expect(within(first).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Tran Thi B', 'Passport', 'Verified', 'Oct 27, 2026, 3:00 AM']);
    expect(within(second).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Nguyen Van A', 'National ID card', 'Waiting for review', 'Oct 26, 2026, 11:30 PM']);
    expect(within(first).getByText('Oct 27, 2026, 3:00 AM').getAttribute('datetime')).toBe('2026-10-27T03:00:00.000Z');
  });

  it('says so when a page has no rows', () => {
    render(<KycRegistrationTable rows={[]} />);

    expect(screen.getByRole('cell').textContent).toBe(text.noRows);
  });
});
```
