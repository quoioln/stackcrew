---
id: core-performance
title: Performance
---
# Performance

## Essentials

- Avoid N+1 queries; use batch or eager loading.
- Give every list query pagination and a supporting index.
- Make all external I/O async or non-blocking and give it a timeout.
- Avoid premature optimization, but never write O(n^2) over large data.

## Detail

- Check the query plan for new queries on large tables.
- Bound result sizes and payloads; stream when data may be large.
