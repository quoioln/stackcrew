Goes to `src/database/migrations/1730000000001-create-processed-message.ts`.

```ts
// Default location: src/database/migrations/1730000000001-create-processed-message.ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The idempotency store of message consumers. Rows are purged by a job once they are older than the longest window in
 * which a message can still be redelivered or replayed. Never edit an applied migration; add a new one.
 */
export class CreateProcessedMessage1730000000001 implements MigrationInterface {
  name = 'CreateProcessedMessage1730000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "processed_message" (
        "consumer" character varying(100) NOT NULL,
        "messageId" character varying(100) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "createdBy" character varying(128) NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedBy" character varying(128) NOT NULL,
        CONSTRAINT "processed_message_pkey" PRIMARY KEY ("consumer", "messageId")
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "processed_message"`);
  }
}
```
