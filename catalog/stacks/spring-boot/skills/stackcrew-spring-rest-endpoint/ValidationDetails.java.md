Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `ValidationDetails.java`.

```java
package {{sc:basePackage}}.common.api;

import {{sc:basePackage}}.common.api.ApiResponse.ErrorDetail;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ElementKind;
import jakarta.validation.Path;
import org.springframework.context.MessageSourceResolvable;
import org.springframework.core.MethodParameter;
import org.springframework.validation.Errors;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.validation.method.ParameterErrors;
import org.springframework.validation.method.ParameterValidationResult;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.method.annotation.HandlerMethodValidationException;

import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Bean Validation failures as details[]: one per (field, constraint), field as a dotted path with [index] for list
 * items, code from the shared table below, message the constraint's rule text (never the submitted value).
 */
final class ValidationDetails {

    /** A binding failure's own message echoes the submitted value, so it is replaced. */
    static final String WRONG_TYPE = "has the wrong type";
    static final String MISSING = "is required";
    private static final String INVALID = "is invalid";

    private ValidationDetails() {}

    /** @Valid body or model attribute (MethodArgumentNotValidException, BindException) and @Valid parameters of method validation. */
    static List<ErrorDetail> of(Errors errors) {
        List<ErrorDetail> details = new ArrayList<>();
        for (FieldError error : errors.getFieldErrors()) {
            details.add(detail(error.getField(), error));
        }
        for (ObjectError error : errors.getGlobalErrors()) {
            details.add(detail(null, error));
        }
        return sorted(details);
    }

    /** Constraints on controller parameters (@RequestParam @Min ...), and @Valid parameters when method validation applies. */
    static List<ErrorDetail> of(HandlerMethodValidationException ex) {
        List<ErrorDetail> details = new ArrayList<>();
        for (ParameterValidationResult result : ex.getParameterValidationResults()) {
            if (result instanceof ParameterErrors errors) {
                details.addAll(of(errors));
                continue;
            }
            String field = parameterName(result.getMethodParameter());
            for (MessageSourceResolvable error : result.getResolvableErrors()) {
                details.add(detail(field, result.unwrap(error, ConstraintViolation.class)));
            }
        }
        return sorted(details);
    }

    /** ConstraintViolationException from a @Validated bean: the method and parameter nodes are dropped from the path. */
    static List<ErrorDetail> of(Set<? extends ConstraintViolation<?>> violations) {
        List<ErrorDetail> details = new ArrayList<>();
        for (ConstraintViolation<?> violation : violations) {
            details.add(detail(fieldOf(violation.getPropertyPath()), violation));
        }
        return sorted(details);
    }

    private static ErrorDetail detail(String field, ObjectError error) {
        if (error instanceof FieldError fieldError && fieldError.isBindingFailure()) {
            return new ErrorDetail(field, DetailCode.INVALID_TYPE, WRONG_TYPE);
        }
        if (error.contains(ConstraintViolation.class)) {
            return detail(field, error.unwrap(ConstraintViolation.class));
        }
        return new ErrorDetail(field, DetailCode.INVALID_VALUE, INVALID);
    }

    private static ErrorDetail detail(String field, ConstraintViolation<?> violation) {
        return new ErrorDetail(field, codeOf(violation), violation.getMessage());
    }

    /** The Bean Validation column of the shared validator table; anything else is INVALID_VALUE. */
    static DetailCode codeOf(ConstraintViolation<?> violation) {
        return switch (violation.getConstraintDescriptor().getAnnotation().annotationType().getSimpleName()) {
            case "NotNull", "NotBlank", "NotEmpty" -> DetailCode.REQUIRED;
            case "Email", "Pattern" -> DetailCode.INVALID_FORMAT;
            case "Size" -> sizeCode(violation);
            case "Min", "Max", "DecimalMin", "DecimalMax", "Positive", "PositiveOrZero", "Negative", "NegativeOrZero",
                 "Past", "Future", "PastOrPresent", "FutureOrPresent" -> DetailCode.OUT_OF_RANGE;
            default -> DetailCode.INVALID_VALUE;
        };
    }

    /** Size: shorter than min is TOO_SHORT, otherwise TOO_LONG. */
    private static DetailCode sizeCode(ConstraintViolation<?> violation) {
        int min = (Integer) violation.getConstraintDescriptor().getAttributes().get("min");
        return lengthOf(violation.getInvalidValue()) < min ? DetailCode.TOO_SHORT : DetailCode.TOO_LONG;
    }

    private static int lengthOf(Object value) {
        if (value instanceof CharSequence text) {
            return text.length();
        }
        if (value instanceof Collection<?> collection) {
            return collection.size();
        }
        if (value instanceof Map<?, ?> map) { // stackcrew-allow: SC-TYPE @Size also measures a map; only its size is read
            return map.size();
        }
        return value != null && value.getClass().isArray() ? Array.getLength(value) : 0;
    }

    private static String parameterName(MethodParameter parameter) {
        RequestParam requestParam = parameter.getParameterAnnotation(RequestParam.class);
        if (requestParam != null && !requestParam.name().isEmpty()) {
            return requestParam.name();
        }
        return parameter.getParameterName();
    }

    /** create.request.items[1].sku becomes items[1].sku; list.page (a simple parameter) becomes page. */
    private static String fieldOf(Path path) {
        List<Path.Node> nodes = new ArrayList<>();
        path.forEach(nodes::add);
        StringBuilder field = new StringBuilder();
        for (int i = 0; i < nodes.size(); i++) {
            Path.Node node = nodes.get(i);
            ElementKind kind = node.getKind();
            boolean last = i == nodes.size() - 1;
            if (kind == ElementKind.METHOD || kind == ElementKind.CONSTRUCTOR || (kind == ElementKind.PARAMETER && !last)) {
                continue;
            }
            if (node.getIndex() != null) {
                field.append('[').append(node.getIndex()).append(']');
            } else if (node.getKey() != null) {
                field.append('[').append(node.getKey()).append(']');
            }
            if (node.getName() != null && kind != ElementKind.CONTAINER_ELEMENT) {
                field.append(field.isEmpty() ? "" : ".").append(node.getName());
            }
        }
        return field.isEmpty() ? null : field.toString();
    }

    private static List<ErrorDetail> sorted(List<ErrorDetail> details) {
        details.sort(Comparator.comparing(ErrorDetail::field, Comparator.nullsFirst(Comparator.naturalOrder()))
                .thenComparing(ErrorDetail::code));
        return List.copyOf(details);
    }
}
```
