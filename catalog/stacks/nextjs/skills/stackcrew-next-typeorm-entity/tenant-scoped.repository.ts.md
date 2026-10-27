Goes to `src/shared/db/tenant-scoped.repository.ts`.

```ts
// Default location: src/shared/db/tenant-scoped.repository.ts
import {
  IsNull, type DeepPartial, type EntityManager, type FindManyOptions, type FindOneOptions, type FindOptionsWhere, type QueryDeepPartialEntity, type Repository,
} from 'typeorm';
import { isCrossTenant, requireTenantId } from '../context/request-context';
import { {{sc:baseTenantEntity}} } from './base-tenant.entity';

type Where<T> = FindOptionsWhere<T> | FindOptionsWhere<T>[];

/**
 * The only way to read and write a tenant entity (core-persistence, addon-typeorm). Every read, count, update, delete
 * and soft delete carries the {{sc:tenantColumn}} condition from the request context; a lookup by id of another
 * tenant's row finds nothing. No tenant in the context throws MissingTenantError. Inside runCrossTenant reads see every
 * tenant and writes throw. Extend it per entity; a bulk write a feature needs becomes a method here, never a
 * QueryBuilder in a service. Inside a transaction use withManager(manager), never any manager method on a tenant entity
 * (getRepository, update, delete, increment, decrement, softDelete, restore, upsert, createQueryBuilder…).
 */
export class TenantScopedRepository<T extends {{sc:baseTenantEntity}}> {
  constructor(protected readonly repository: Repository<T>) {}

  /**
   * The same scoped API (subclass methods included) on a transaction's manager:
   * dataSource.transaction((manager) => this.profiles.withManager(manager).update({ id }, values)).
   * Never use any manager method on a tenant entity (getRepository, update, delete, increment, decrement, softDelete, restore, upsert, createQueryBuilder…):
   * none of them carries the tenant condition.
   */
  withManager(manager: EntityManager): this {
    const scoped: this = Object.create(this); // inherits every method of this repository and its subclass
    Object.defineProperty(scoped, 'repository', { value: manager.getRepository<T>(this.repository.target) });
    return scoped;
  }

  async find(options: FindManyOptions<T> = {}): Promise<T[]> {
    return this.repository.find({ ...options, where: this.readScope(options.where) });
  }

  async findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.repository.findOne({ ...options, where: this.readScope(options.where) });
  }

  async findOneBy(where: FindOptionsWhere<T>): Promise<T | null> {
    return this.repository.findOne({ where: this.readScope(where) });
  }

  async count(options: FindManyOptions<T> = {}): Promise<number> {
    return this.repository.count({ ...options, where: this.readScope(options.where) });
  }

  /** A new, unsaved entity. The tenant and the audit fields are assigned when it is saved. */
  create(data: DeepPartial<T>): T {
    return this.repository.create(data);
  }

  /** Insert or update one entity; TenantSubscriber refuses a row of another tenant. */
  async save(entity: T): Promise<T> {
    requireTenantId();
    return this.repository.save(entity);
  }

  /** Returns the number of rows changed: 0 when the rows belong to another tenant or are soft deleted. */
  async update(where: FindOptionsWhere<T>, values: QueryDeepPartialEntity<T>): Promise<number> {
    const result = await this.repository.update(this.liveRows(this.writeScope(where)), values);
    return result.affected ?? 0;
  }

  async delete(where: FindOptionsWhere<T>): Promise<number> {
    const result = await this.repository.delete(this.writeScope(where));
    return result.affected ?? 0;
  }

  /** Sets the @DeleteDateColumn through update(), so AuditSubscriber fills updatedBy (TypeORM's softDelete skips it). */
  async softDelete(where: FindOptionsWhere<T>): Promise<number> {
    const column = this.repository.metadata.deleteDateColumn;
    if (column === undefined) {
      throw new Error(`${this.repository.metadata.name} has no @DeleteDateColumn`);
    }
    const values = column.createValueMap(new Date()) as QueryDeepPartialEntity<T>; // { [deleteDateColumn]: now }
    const result = await this.repository.update(this.liveRows(this.writeScope(where)), values);
    return result.affected ?? 0;
  }

  protected readScope(where: Where<T> | undefined): Where<T> | undefined {
    if (isCrossTenant()) {
      return where;
    }
    const tenant = this.tenantCondition(requireTenantId());
    if (Array.isArray(where)) {
      return where.map((one) => ({ ...one, ...tenant }));
    }
    return { ...where, ...tenant };
  }

  /** Writes always need a tenant, also inside runCrossTenant (which has none): cross-tenant access is read only. */
  protected writeScope(where: FindOptionsWhere<T>): FindOptionsWhere<T> {
    return { ...where, ...this.tenantCondition(requireTenantId()) };
  }

  protected liveRows(where: FindOptionsWhere<T>): FindOptionsWhere<T> {
    const column = this.repository.metadata.deleteDateColumn;
    return column === undefined ? where : { ...where, [column.propertyName]: IsNull() };
  }

  private tenantCondition(tenantId: string): FindOptionsWhere<T> {
    return { {{sc:tenantColumn}}: tenantId } as FindOptionsWhere<T>;
  }
}
```
