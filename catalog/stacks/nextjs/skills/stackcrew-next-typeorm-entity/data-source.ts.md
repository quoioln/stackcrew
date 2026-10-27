Goes to `src/shared/db/data-source.ts`.

```ts
// Default location: src/shared/db/data-source.ts
import 'server-only';
import { DataSource } from 'typeorm';
import { dataSourceOptions, ENTITIES } from './data-source.options';

/**
 * The DataSources of this process, on globalThis: it outlives the module reloads of `next dev`, where a module-level
 * variable would open a new pool on every edit. Keyed by the entity list of the module copy that asks.
 */
const holder = globalThis as typeof globalThis & { appDataSources?: Map<readonly unknown[], Promise<DataSource>> };

/**
 * The DataSource of this server layer, initialized on first use. Next.js evaluates server modules once per layer (one
 * copy for Server Components and server actions, another for route handlers), so each layer has its own entity
 * classes, subscribers and request context; a DataSource built from one layer's classes cannot serve the other. Each
 * copy of this module therefore gets its own DataSource (its own pool of POOL_SIZE connections), created once and
 * reused for every request of that layer. A failed initialization is not kept: the next call retries.
 * Under `next dev`, an edit that reloads an entity creates a new DataSource for that layer. The old entry stays in the
 * Map: a reloaded copy cannot be told from the other layer's copy, so it is never closed from here. It holds no
 * connection once idle (pg's idle timeout closes them); restart `next dev` after many entity edits to drop the objects.
 */
export function getDataSource(): Promise<DataSource> {
  const sources = (holder.appDataSources ??= new Map());
  const existing = sources.get(ENTITIES);
  if (existing !== undefined) {
    return existing;
  }
  const starting = new DataSource(dataSourceOptions()).initialize().catch((failure: unknown) => {
    sources.delete(ENTITIES);
    throw failure;
  });
  sources.set(ENTITIES, starting);
  return starting;
}
```
