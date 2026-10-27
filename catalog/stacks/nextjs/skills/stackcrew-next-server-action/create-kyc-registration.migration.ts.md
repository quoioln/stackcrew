Goes to `src/shared/db/migrations/1730000000001-create-kyc-registration.ts`.

```ts
// Default location: src/shared/db/migrations/1730000000001-create-kyc-registration.ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated with the TypeORM CLI (migration:generate) and reviewed. The unique constraint on (tenant, applicant) is
 * what answers a repeated or concurrent registration with CONFLICT. The tenant column leads both indexes.
 */
export class CreateKycRegistration1730000000001 implements MigrationInterface {
  name = 'CreateKycRegistration1730000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "kyc_registration" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "{{sc:tenantColumn}}" character varying(64) NOT NULL,
        "applicantId" character varying(128) NOT NULL,
        "fullName" character varying(200) NOT NULL,
        "dateOfBirth" date NOT NULL,
        "documentType" character varying(16) NOT NULL,
        "idNumber" character varying(20) NOT NULL,
        "status" character varying(16) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "createdBy" character varying(128) NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedBy" character varying(128) NOT NULL,
        CONSTRAINT "kyc_registration_applicant_key" UNIQUE ("{{sc:tenantColumn}}", "applicantId"),
        CONSTRAINT "kyc_registration_pkey" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "kyc_registration_tenant_created_idx" ON "kyc_registration" ("{{sc:tenantColumn}}", "createdAt")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "kyc_registration_tenant_created_idx"`);
    await queryRunner.query(`DROP TABLE "kyc_registration"`);
  }
}
```
