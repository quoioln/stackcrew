Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `PageData.java`.

```java
package {{sc:basePackage}}.common.api;

import java.util.List;

/**
 * The data of a paged list: { items, pagination }, page 0-based. Build it from a Spring Data Page in the controller,
 * PageData.of(page.getContent(), page.getNumber(), page.getSize(), page.getTotalElements()); never serialize a Page.
 * A page past the last one is items [] with hasNext false, not an error.
 */
public record PageData<T>(List<T> items, Pagination pagination) {

    public record Pagination(int page, int size, long totalElements, int totalPages, boolean hasNext, boolean hasPrevious) {
    }

    public static <T> PageData<T> of(List<T> items, int page, int size, long totalElements) {
        if (size < 1) {
            throw new IllegalArgumentException("size must be at least 1");
        }
        int totalPages = totalElements == 0 ? 0 : (int) ((totalElements + size - 1) / size);
        return new PageData<>(List.copyOf(items), new Pagination(page, size, totalElements, totalPages, page + 1 < totalPages, page > 0));
    }
}
```
