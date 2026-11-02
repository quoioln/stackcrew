Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `ErrorCode.java`.

```java
package {{sc:basePackage}}.common.api;

import org.springframework.http.HttpStatus;

/**
 * One row of an error table. CommonErrorCode holds the shared rows; a domain adds its own enum implementing this
 * interface with seq 100-999. A domain row that reuses a common code keeps that code's summary.
 */
public interface ErrorCode {

    /** CC of the errorNumber SSCCNNN. */
    int category();

    /** NNN of the errorNumber: 1-99 for the common table, 100-999 for domain errors. */
    int seq();

    /** The errorCode the frontend translates, UPPER_SNAKE_CASE; several services may share one. */
    String code();

    HttpStatus status();

    /** The fixed English text sent as message; never built from an exception. */
    String summary();
}
```
