// Default location: src/common/database/base-tenant.entity.ts
import { Column } from 'typeorm';
import { {{sc:baseEntity}} } from './base.entity';

const TENANT_ID_LENGTH = 64;

/**
 * Every tenant-scoped entity extends this. TenantSubscriber assigns the tenant from the request context on insert and
 * refuses rows of another tenant; TenantScopedRepository adds the tenant condition to every query. update: false keeps
 * an update from moving a row to another tenant.
 */
export abstract class {{sc:baseTenantEntity}} extends {{sc:baseEntity}} {
  @Column({ length: TENANT_ID_LENGTH, update: false })
  readonly {{sc:tenantColumn}}!: string;
}
