Goes to `src/database/migrations/1730000000000-create-customer-profile.ts`.

```ts
// Default location: src/database/migrations/1730000000000-create-customer-profile.ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Columns are named like the entity properties (TypeORM's default naming); with a snake_case naming strategy they are
 * snake_case. The tenant column leads every index a hot query uses. Never edit an applied migration; add a new one.
 */
export class CreateCustomerProfile1730000000000 implements MigrationInterface {
  name = 'CreateCustomerProfile1730000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "customer_profile" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "{{sc:tenantColumn}}" character varying(64) NOT NULL,
        "reference" character varying(64) NOT NULL,
        "fullName" character varying(200) NOT NULL,
        "status" character varying(16) NOT NULL,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "createdBy" character varying(128) NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedBy" character varying(128) NOT NULL,
        CONSTRAINT "customer_profile_pkey" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "customer_profile_tenant_idx" ON "customer_profile" ("{{sc:tenantColumn}}")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "customer_profile_tenant_idx"`);
    await queryRunner.query(`DROP TABLE "customer_profile"`);
  }
}
```
