package {{sc:basePackage}}.common.logging;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.util.List;

/**
 * app.logging.mask-fields: the PII keys to mask; unset or empty means BodyMasker.DEFAULT_PII_FIELDS. It replaces the
 * default list; the secret list is always masked on top of it.
 * app.logging.max-body-bytes: cap of a logged body after masking (default 16384).
 * app.logging.log-bodies: false drops reqBody and resBody and keeps the one-line log (default true).
 */
@ConfigurationProperties("app.logging")
public record MaskingProperties(List<String> maskFields,
                                @DefaultValue("16384") int maxBodyBytes,
                                @DefaultValue("true") boolean logBodies) {

    public static final int DEFAULT_MAX_BODY_BYTES = 16384;

    public MaskingProperties {
        maskFields = maskFields == null ? List.of() : maskFields.stream().map(String::trim).filter(f -> !f.isEmpty()).toList();
        if (maxBodyBytes <= 0) {
            throw new IllegalArgumentException("app.logging.max-body-bytes must be positive");
        }
    }

    public static MaskingProperties defaults() {
        return new MaskingProperties(List.of(), DEFAULT_MAX_BODY_BYTES, true);
    }
}
