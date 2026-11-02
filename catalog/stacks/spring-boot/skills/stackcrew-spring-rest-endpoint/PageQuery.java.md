Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `PageQuery.java`.

```java
package {{sc:basePackage}}.common.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * The page and size query parameters of a list endpoint, 0-based: take it as `@Valid PageQuery query`. A missing page
 * is 0 and a missing size DEFAULT_PAGE_SIZE. A size above MAX_PAGE_SIZE is capped and the capped value is answered;
 * a page outside 0..MAX_PAGE-1 or a size below 1 is VALIDATION_FAILED. Past MAX_PAGE, use keyset pagination.
 * Spring's own Pageable silently clamps a negative page, so list endpoints take this record instead.
 */
public record PageQuery(@Min(0) @Max(PageQuery.MAX_PAGE - 1) Integer page, @Min(1) Integer size) {

    public static final int DEFAULT_PAGE_SIZE = 20;
    public static final int MAX_PAGE_SIZE = 100;
    public static final int MAX_PAGE = 1000;

    public PageQuery {
        page = page == null ? 0 : page;
        size = size == null ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
    }
}
```
