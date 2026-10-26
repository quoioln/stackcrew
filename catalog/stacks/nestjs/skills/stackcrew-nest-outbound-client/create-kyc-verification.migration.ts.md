Goes to `src/database/migrations/1730000000002-create-kyc-verification.ts`.

```ts
// Default location: src/database/migrations/1730000000002-create-kyc-verification.ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The KYC verification operations. The tenant column leads both indexes; the partial unique one allows one PENDING
 * operation per profile and tenant. Never edit an applied migration; add a new one.
 */
export class CreateKycVerification1730000000002 implements MigrationInterface {
  name = 'CreateKycVerification1730000000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "kyc_verification" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "{{sc:tenantColumn}}" character varying(64) NOT NULL,
        "profileId" uuid NOT NULL,
        "status" character varying(16) NOT NULL,
        "decision" character varying(16),
        "providerReference" character varying(128),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "createdBy" character varying(128) NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedBy" character varying(128) NOT NULL,
        CONSTRAINT "kyc_verification_pkey" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "kyc_verification_tenant_profile_idx" ON "kyc_verification" ("{{sc:tenantColumn}}", "profileId")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "kyc_verification_pending_key" ON "kyc_verification" ("{{sc:tenantColumn}}", "profileId") WHERE "status" = 'PENDING'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "kyc_verification_pending_key"`);
    await queryRunner.query(`DROP INDEX "kyc_verification_tenant_profile_idx"`);
    await queryRunner.query(`DROP TABLE "kyc_verification"`);
  }
}
```
