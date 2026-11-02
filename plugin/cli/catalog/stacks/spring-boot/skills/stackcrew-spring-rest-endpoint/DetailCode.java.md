Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `DetailCode.java`.

```java
package {{sc:basePackage}}.common.api;

/** details[].code, identical in every stack so the frontend can translate per field. Anything unmapped is INVALID_VALUE. */
public enum DetailCode {
    REQUIRED,
    INVALID_FORMAT,
    INVALID_TYPE,
    TOO_SHORT,
    TOO_LONG,
    OUT_OF_RANGE,
    INVALID_VALUE,
    ALREADY_EXISTS
}
```
