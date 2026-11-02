Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `ErrorNumbers.java`.

```java
package {{sc:basePackage}}.common.api;

import java.util.Locale;

/** errorNumber = SSCCNNN: the service number (app.service-number), the 2-digit category and the 3-digit sequence. */
public final class ErrorNumbers {

    private ErrorNumbers() {}

    public static String format(String serviceNumber, ErrorCode code) {
        if (code.category() < 0 || code.category() > 99 || code.seq() < 1 || code.seq() > 999) {
            throw new IllegalArgumentException("category must be 0-99 and seq 1-999: " + code.code());
        }
        // Locale.ROOT: a default locale with non-ASCII digits would break ^\d{7}$
        return String.format(Locale.ROOT, "%s%02d%03d", serviceNumber, code.category(), code.seq());
    }
}
```
