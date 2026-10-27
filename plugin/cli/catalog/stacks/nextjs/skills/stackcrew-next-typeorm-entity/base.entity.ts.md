Goes to `src/shared/db/base.entity.ts`.

```ts
// Default location: src/shared/db/base.entity.ts
import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

const USER_ID_LENGTH = 128;

/**
 * Every entity extends this (core-persistence). The four audit fields are filled by the database clock and by
 * AuditSubscriber from the request context; they are readonly so code cannot set them. No id: the entity chooses.
 * Never extend TypeORM's own BaseEntity (Active Record). Every column names its type: Vitest never emits the decorator
 * metadata TypeORM would otherwise infer it from, and Next.js emits it only with emitDecoratorMetadata.
 */
export abstract class {{sc:baseEntity}} {
  @CreateDateColumn({ type: 'timestamptz', update: false })
  readonly createdAt!: Date;

  @Column({ type: 'varchar', length: USER_ID_LENGTH, update: false })
  readonly createdBy!: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  readonly updatedAt!: Date;

  @Column({ type: 'varchar', length: USER_ID_LENGTH })
  readonly updatedBy!: string;
}
```
