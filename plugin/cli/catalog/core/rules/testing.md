---
id: core-testing
title: Testing
---
# Testing

## Essentials

- Write at least 3 negative or edge cases per happy path; every assertion checks real behavior, never an empty assert.
- Structure tests as Arrange-Act-Assert with one reason to fail per test and names that describe behavior.
- Keep tests deterministic: no dependence on wall-clock, run order or network; mock external I/O.
- Cover every branch of changed logic, not just lines.
- Test persistence against a real database (for example Testcontainers), not only mocks.
- Consider mutation testing on core-logic modules to catch fake tests.

## Detail

- Coverage is not quality: a high percentage with weak assertions proves little.
- Fake time and randomness through an injected clock or seed.
- Integration tests exercise real SQL, migrations and constraints; unit tests mock only true external boundaries.
