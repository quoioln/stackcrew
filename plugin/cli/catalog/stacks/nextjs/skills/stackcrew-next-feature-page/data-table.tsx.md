Goes to `{{sc:sharedComponents}}/data-table.tsx`.

```tsx
// Default location: {{sc:sharedComponents}}/data-table.tsx
'use client';

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from './table';

/**
 * The shared table: shadcn's data table on TanStack Table v8 and the shared Table components next to it. A feature
 * passes its column definitions and DTO rows; paging, sorting and filtering happen on the server through the URL, so
 * the table renders exactly the rows it is given. Create it once, only when the project has no shared table yet.
 */
export function DataTable<TData, TValue>({ columns, data, caption, emptyText }: {
  columns: ColumnDef<TData, TValue>[];
  data: readonly TData[];
  caption: string;
  emptyText: string;
}) {
  const rows = useMemo(() => [...data], [data]); // TanStack Table wants a mutable array with a stable identity
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                {emptyText}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```
