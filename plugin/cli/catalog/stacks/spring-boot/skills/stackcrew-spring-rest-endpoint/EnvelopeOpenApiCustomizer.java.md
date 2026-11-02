Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `EnvelopeOpenApiCustomizer.java`.

```java
package {{sc:basePackage}}.common.api;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.media.BooleanSchema;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.media.UUIDSchema;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springdoc.core.utils.SpringDocAnnotationsUtils;
import org.springframework.core.ResolvableType;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpEntity;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.util.List;
import java.util.Set;

/**
 * Only when the service uses springdoc-openapi: the API docs show the envelope that is really sent. Each 2xx response
 * of a @RestController operation becomes a SuccessResponse whose data is the declared return type (data null for
 * void), and every operation answers 4XX and 5XX with the one ErrorResponse schema registered in the components.
 * Skipped like ApiResponseAdvice skips: @RawResponse, Resource, StreamingResponseBody, ResponseBodyEmitter.
 * Applies to the default API; with GroupedOpenApi, add it to each group.
 */
@Component
public class EnvelopeOpenApiCustomizer implements OperationCustomizer, OpenApiCustomizer {

    private static final String ERROR_SCHEMA = "ErrorResponse";
    private static final String ERROR_REF = "#/components/schemas/" + ERROR_SCHEMA;

    @Override
    public Operation customize(Operation operation, HandlerMethod handlerMethod) {
        if (!AnnotatedElementUtils.hasAnnotation(handlerMethod.getBeanType(), RestController.class)
                || handlerMethod.hasMethodAnnotation(RawResponse.class)
                || AnnotatedElementUtils.hasAnnotation(handlerMethod.getBeanType(), RawResponse.class)
                || isUnwrappedBody(handlerMethod)) {
            return operation;
        }
        operation.getResponses().forEach((status, response) -> {
            if (status.startsWith("2")) {
                if (response.getContent() == null || response.getContent().isEmpty()) {
                    response.setContent(new Content().addMediaType(MediaType.APPLICATION_JSON_VALUE,
                            new io.swagger.v3.oas.models.media.MediaType().schema(successSchema(null))));
                } else {
                    response.getContent().values().forEach(media -> media.setSchema(successSchema(media.getSchema())));
                }
            }
        });
        operation.getResponses().addApiResponse("4XX", errorResponse("Client error"));
        operation.getResponses().addApiResponse("5XX", errorResponse("Server error"));
        return operation;
    }

    /** Registers ErrorResponse (with ErrorPayload and ErrorDetail) once in the components. */
    @Override
    public void customise(OpenAPI openApi) {
        SpringDocAnnotationsUtils.extractSchema(openApi.getComponents(), ErrorResponse.class, null, null, openApi.getSpecVersion());
    }

    private static Schema<?> successSchema(Schema<?> data) {
        // nullable for OpenAPI 3.0, the null type for 3.1
        Schema<?> dataSchema = data == null ? new Schema<>().nullable(true).types(Set.of("null")).description("always null") : data;
        return new ObjectSchema()
                .title("SuccessResponse")
                .addProperty("success", new BooleanSchema()._default(true))
                .addProperty("timestamp", new StringSchema().format("date-time"))
                .addProperty("supportCode", new StringSchema().pattern("^[A-Z]{6}$"))
                .addProperty("requestId", new UUIDSchema())
                .addProperty("data", dataSchema)
                .required(List.of("success", "timestamp", "supportCode", "requestId", "data"));
    }

    private static io.swagger.v3.oas.models.responses.ApiResponse errorResponse(String description) {
        return new io.swagger.v3.oas.models.responses.ApiResponse().description(description)
                .content(new Content().addMediaType(MediaType.APPLICATION_JSON_VALUE,
                        new io.swagger.v3.oas.models.media.MediaType().schema(new Schema<>().$ref(ERROR_REF))));
    }

    private static boolean isUnwrappedBody(HandlerMethod handlerMethod) {
        ResolvableType type = ResolvableType.forMethodReturnType(handlerMethod.getMethod());
        if (HttpEntity.class.isAssignableFrom(handlerMethod.getReturnType().getParameterType())) {
            type = type.as(HttpEntity.class).getGeneric(0);
        }
        Class<?> body = type.resolve(Object.class);
        return Resource.class.isAssignableFrom(body) || StreamingResponseBody.class.isAssignableFrom(body)
                || ResponseBodyEmitter.class.isAssignableFrom(body);
    }
}
```
