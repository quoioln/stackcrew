Goes to `src/main/java`, package `{{sc:basePackage}}.common.logging`, as `BodyMasker.java`.

```java
package {{sc:basePackage}}.common.logging;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode; // stackcrew-allow: SC-TYPE log masking walks arbitrary JSON before it is written
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode; // stackcrew-allow: SC-TYPE log masking walks arbitrary JSON before it is written
import com.fasterxml.jackson.databind.node.TextNode;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * The one masker for request, response and message bodies (core-logging, "Body masker"). Pure and thread-safe.
 * Keys match by whole word runs (no substring matching); masked values become "***"; long base64 strings become
 * their size; bodies are capped at max-body-bytes after masking; non-JSON bodies log only a placeholder.
 */
public class BodyMasker {

    public static final List<String> SECRET_FIELDS = List.of("password", "passwd", "secret", "token", "accessToken",
            "refreshToken", "idToken", "apiKey", "clientSecret", "privateKey", "authorization", "cookie", "setCookie", "otp",
            "pin", "cvv", "cvc");
    public static final List<String> DEFAULT_PII_FIELDS = List.of("email", "phone", "phoneNumber", "mobile", "fullName",
            "dob", "dateOfBirth", "address", "nationalId", "idNumber", "cccd", "cmnd", "passport", "passportNumber",
            "cardNumber", "pan", "accountNumber");

    private static final String MASK = "***";
    private static final String UNKNOWN_TYPE = "unknown";
    private static final String JSON_TYPE = "application/json";
    private static final String JSON_SUFFIX = "+json";
    private static final String FORM_TYPE = "application/x-www-form-urlencoded";
    private static final List<String> BINARY_PREFIXES = List.of("multipart/", "image/");
    private static final Set<String> BINARY_TYPES = Set.of("application/octet-stream", "application/pdf");
    /** camelCase boundaries (aB -> a|B, ABc -> A|Bc), underscores, hyphens and spaces. */
    private static final Pattern WORD_SEPARATOR = Pattern.compile("[_\\- ]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])");
    private static final Pattern BASE64 = Pattern.compile("^(data:[\\w/+.-]+;base64,)?[A-Za-z0-9+/\\r\\n]+={0,2}$");
    private static final int BASE64_MIN_EXCLUSIVE_LENGTH = 1024;
    private static final int BASE64_CHARS_PER_GROUP = 4;
    private static final int BASE64_BYTES_PER_GROUP = 3;
    private static final int UTF8_CONTINUATION_MASK = 0xC0;
    private static final int UTF8_CONTINUATION_BITS = 0x80;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ObjectReader STRICT_READER = JSON.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    private final Set<String> maskedKeys;
    private final int maxBodyBytes;
    private final boolean logBodies;

    public BodyMasker(MaskingProperties properties) {
        List<String> pii = properties.maskFields().isEmpty() ? DEFAULT_PII_FIELDS : properties.maskFields();
        this.maskedKeys = Stream.concat(SECRET_FIELDS.stream(), pii.stream())
                .map(BodyMasker::normalize).collect(Collectors.toUnmodifiableSet());
        this.maxBodyBytes = properties.maxBodyBytes();
        this.logBodies = properties.logBodies();
    }

    /** False when app.logging.log-bodies is off: callers then drop reqBody and resBody. */
    public boolean logBodies() {
        return logBodies;
    }

    /** The masked, capped body for a log field, or null when there is no body. */
    public String mask(byte[] body, String contentType) {
        if (body == null || body.length == 0) {
            return null;
        }
        String type = mediaType(contentType);
        if (type.equals(FORM_TYPE)) {
            return maskForm(body, type);
        }
        return isMaskable(contentType) ? maskJson(body, type) : placeholder(contentType, body.length);
    }

    /** True for the bodies this masker parses (JSON, *+json, form); everything else only ever logs its size. */
    public static boolean isMaskable(String contentType) {
        String type = mediaType(contentType);
        return type.equals(JSON_TYPE) || type.endsWith(JSON_SUFFIX) || type.equals(FORM_TYPE);
    }

    /** Size-only placeholder: `<binary CT N bytes>` for files, `<CT N bytes>` for everything else. */
    public String placeholder(String contentType, long size) {
        String type = mediaType(contentType);
        boolean binary = BINARY_TYPES.contains(type) || BINARY_PREFIXES.stream().anyMatch(type::startsWith);
        return (binary ? "<binary " : "<") + type + " " + size + " bytes>";
    }

    private String maskJson(byte[] body, String type) {
        try {
            var tree = STRICT_READER.readTree(body);
            if (tree == null || tree.isMissingNode()) {
                return placeholder(type, body.length);
            }
            return truncate(JSON.writeValueAsString(maskTree(tree)));
        } catch (IOException unparseable) {
            return placeholder(type, body.length);
        }
    }

    private String maskForm(byte[] body, String type) {
        try {
            ObjectNode form = JSON.createObjectNode(); // stackcrew-allow: SC-TYPE log masking walks arbitrary JSON before it is written
            for (String pair : new String(body, StandardCharsets.UTF_8).split("&")) {
                int equals = pair.indexOf('=');
                if (!pair.isEmpty()) {
                    String key = URLDecoder.decode(equals < 0 ? pair : pair.substring(0, equals), StandardCharsets.UTF_8);
                    form.put(key, equals < 0 ? "" : URLDecoder.decode(pair.substring(equals + 1), StandardCharsets.UTF_8));
                }
            }
            return truncate(JSON.writeValueAsString(maskTree(form)));
        } catch (IllegalArgumentException | IOException malformed) {
            return placeholder(type, body.length);
        }
    }

    /** Masks in place: a masked key's value becomes "***" whatever its type; containers are walked. */
    private JsonNode maskTree(JsonNode node) { // stackcrew-allow: SC-TYPE log masking walks arbitrary JSON before it is written
        if (node instanceof ObjectNode object) { // stackcrew-allow: SC-TYPE log masking walks arbitrary JSON before it is written
            List<String> names = new ArrayList<>();
            object.fieldNames().forEachRemaining(names::add);
            for (String name : names) {
                object.set(name, isMaskedKey(name) ? TextNode.valueOf(MASK) : maskTree(object.get(name)));
            }
            return object;
        }
        if (node instanceof ArrayNode array) {
            for (int i = 0; i < array.size(); i++) {
                array.set(i, maskTree(array.get(i)));
            }
            return array;
        }
        if (node.isTextual() && isBase64(node.textValue())) {
            return TextNode.valueOf("<base64 " + decodedSize(node.textValue()) + " bytes>");
        }
        return node;
    }

    /** True when any contiguous run of the key's words, joined, is in the list. */
    private boolean isMaskedKey(String key) {
        List<String> words = words(key);
        for (int start = 0; start < words.size(); start++) {
            StringBuilder run = new StringBuilder();
            for (int end = start; end < words.size(); end++) {
                run.append(words.get(end));
                if (maskedKeys.contains(run.toString())) {
                    return true;
                }
            }
        }
        return false;
    }

    private static List<String> words(String key) {
        return Arrays.stream(WORD_SEPARATOR.split(key))
                .filter(word -> !word.isEmpty())
                .map(word -> word.toLowerCase(Locale.ROOT))
                .toList();
    }

    private static String normalize(String listEntry) {
        return String.join("", words(listEntry));
    }

    private static boolean isBase64(String value) {
        return value.length() > BASE64_MIN_EXCLUSIVE_LENGTH && BASE64.matcher(value).matches();
    }

    /** floor(payloadLength * 3 / 4) - padding, where the payload follows the comma of a data: URI. */
    private static long decodedSize(String value) {
        String payload = value.substring(value.indexOf(',') + 1);
        int padding = 0;
        while (padding < payload.length() && payload.charAt(payload.length() - 1 - padding) == '=') {
            padding++;
        }
        return (long) payload.length() * BASE64_BYTES_PER_GROUP / BASE64_CHARS_PER_GROUP - padding;
    }

    private String truncate(String serialized) {
        byte[] bytes = serialized.getBytes(StandardCharsets.UTF_8);
        if (bytes.length <= maxBodyBytes) {
            return serialized;
        }
        int cut = maxBodyBytes;
        while (cut > 0 && (bytes[cut] & UTF8_CONTINUATION_MASK) == UTF8_CONTINUATION_BITS) {
            cut--;
        }
        return new String(bytes, 0, cut, StandardCharsets.UTF_8) + "...[truncated " + bytes.length + " bytes]";
    }

    /** The media type without parameters, lower case, with CR and LF removed; `unknown` when missing. */
    private static String mediaType(String contentType) {
        if (contentType == null) {
            return UNKNOWN_TYPE;
        }
        int parameters = contentType.indexOf(';');
        String type = (parameters < 0 ? contentType : contentType.substring(0, parameters))
                .replaceAll("[\\r\\n]", "").trim().toLowerCase(Locale.ROOT);
        return type.isEmpty() ? UNKNOWN_TYPE : type;
    }
}
```
