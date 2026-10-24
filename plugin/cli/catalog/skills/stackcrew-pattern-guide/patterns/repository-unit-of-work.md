# Repository / Unit of Work

A Repository gives the domain a collection-like view of persistence. A Unit of Work makes several changes commit or roll back together.

## Signals

- Business logic builds SQL, uses an ORM session or a query builder directly, or knows table names.
- The same query is repeated in several services.
- Several writes must succeed together, or none (an order and its stock reservation).
- Business logic cannot be tested without a database.

## Use when

- A domain or service layer needs to load and save aggregates without knowing the storage.
- Queries have domain meaning (`findOpenByCustomer`) and are reused.
- A use case spans several writes in one atomic step.

## Do not use when

- A small CRUD service where the framework repository is already the abstraction; do not add a second layer above Spring Data or an ORM repository.
- You would wrap a generic `Repository<T>` with `save/find/delete` and add nothing.
- Read-heavy reporting queries: use a dedicated query object or read model (see CQRS in [architecture-styles.md](../architecture-styles.md)).
- A remote call is inside the transaction: never hold a transaction open around a remote call.

## Idioms

### Java (Spring Boot / Quarkus)

- Spring Data `JpaRepository` is the repository; use a thin domain-named interface in front of it only when the domain must not depend on JPA. Quarkus: Panache repository.
- The Unit of Work is `@Transactional` on the application service method (public, called from outside the bean). Keep it short; no HTTP calls, no broker publish inside (see [outbox.md](outbox.md)).
- Entities are never Lombok `@Data` or `@Builder`. Use `JdbcClient` or a projection (`record`) for read queries.

### TypeScript (NestJS / Next.js / React / Angular)

- A repository class (or the ORM's repository: TypeORM, Prisma client, Drizzle) returning domain types, injected through a token.
- Unit of Work: the ORM transaction callback (`prisma.$transaction`, `dataSource.transaction`, Drizzle `db.transaction`), passing the transaction client to repositories.
- Frontend: this is not a frontend pattern; the data layer is an API client plus a server-state cache.

### Go

- A small interface defined where it is used: `type OrderStore interface { Load(ctx context.Context, id OrderID) (Order, error); Save(ctx context.Context, order Order) error }`, implemented over `database/sql`, `pgx` or `sqlc`.
- Unit of Work: a function that runs a closure inside a transaction (`InTx(ctx context.Context, fn func(Store) error) error`), committing on nil and rolling back on error. Pass `context.Context` always.

## Example

Language: Go. A transaction helper keeps writes atomic without leaking `*sql.Tx` into the domain.

```go
type Store interface {
	SaveOrder(ctx context.Context, order Order) error
	ReserveStock(ctx context.Context, lines []Line) error
}

type TxRunner interface {
	InTx(ctx context.Context, fn func(Store) error) error
}

func PlaceOrder(ctx context.Context, tx TxRunner, order Order) error {
	return tx.InTx(ctx, func(store Store) error {
		if err := store.SaveOrder(ctx, order); err != nil {
			return fmt.Errorf("save order: %w", err)
		}
		return store.ReserveStock(ctx, order.Lines)
	})
}
```

## AI anti-patterns

- A generic `BaseRepository<T>` over a repository that already exists in the framework.
- `@Transactional` on a private method or a self-invoked method, so no transaction starts.
- A transaction around a remote call or a broker publish.
- Returning entities or ORM models to the controller instead of DTOs or domain types.
- Business logic that builds SQL strings inline, or puts the same query in three services.
- Using `Map<String, Object>` or `interface{}` rows as the repository's result type.
