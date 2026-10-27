Goes to `src/shared/db/data-source.cli.ts`.

```ts
// Default location: src/shared/db/data-source.cli.ts
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source.options';

/**
 * For the TypeORM CLI only (migration:generate, migration:run, migration:revert), run through tsx with the env file
 * loaded: see the skill. The app never imports this file; it uses getDataSource() from data-source.ts.
 */
export default new DataSource(dataSourceOptions());
```
