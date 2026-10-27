Goes to `src/features/kyc-registrations/components/kyc-registration-table.tsx`.

```tsx
// Default location: src/features/kyc-registrations/components/kyc-registration-table.tsx
'use client';

import type { ColumnDef } from '@tanstack/react-table';
// The shared table of {{sc:sharedComponents}}, imported through the project's alias (shadcn's aliases.ui).
import { DataTable } from '@/components/ui/data-table';
import type { KycRegistrationRowDto } from '../kyc-registration-row.dto';
import { kycRegistrationListText as text } from '../kyc-registration-list.messages';
import { kycRegistrationText } from '../kyc-registration.messages';

/** A fixed locale and time zone: the server render and the browser print the same text, so hydration never mismatches. */
const SUBMITTED_AT = new Intl.DateTimeFormat(text.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: text.timeZone });

/** Column definitions hold functions, so they live in this client module; the Server Component passes rows (DTOs) only. */
const COLUMNS: ColumnDef<KycRegistrationRowDto>[] = [
  { accessorKey: 'fullName', header: text.columns.fullName },
  { accessorKey: 'documentType', header: text.columns.documentType, cell: ({ row }) => kycRegistrationText.documentTypes[row.original.documentType] },
  { accessorKey: 'status', header: text.columns.status, cell: ({ row }) => text.statuses[row.original.status] },
  {
    accessorKey: 'submittedAt',
    header: text.columns.submittedAt,
    cell: ({ row }) => <time dateTime={row.original.submittedAt}>{SUBMITTED_AT.format(new Date(row.original.submittedAt))}</time>,
  },
];

export function KycRegistrationTable({ rows }: { rows: readonly KycRegistrationRowDto[] }) {
  return <DataTable columns={COLUMNS} data={rows} caption={text.caption} emptyText={text.noRows} />;
}
```
