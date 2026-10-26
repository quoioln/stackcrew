// Default location: src/common/database/base.entity.ts
import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

const USER_ID_LENGTH = 128;

/**
 * Every entity extends this (core-persistence). The four audit fields are filled by the database clock and by
 * AuditSubscriber from the request context; they are readonly so code cannot set them. No id: the entity chooses.
 * Never extend TypeORM's own BaseEntity (Active Record).
 */
export abstract class {{sc:baseEntity}} {
  @CreateDateColumn({ type: 'timestamptz', update: false })
  readonly createdAt!: Date;

  @Column({ length: USER_ID_LENGTH, update: false })
  readonly createdBy!: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  readonly updatedAt!: Date;

  @Column({ length: USER_ID_LENGTH })
  readonly updatedBy!: string;
}
