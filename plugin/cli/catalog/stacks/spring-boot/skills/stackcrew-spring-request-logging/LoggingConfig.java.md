Goes to `src/main/java`, package `{{sc:basePackage}}.common.logging`, as `LoggingConfig.java`.

```java
package {{sc:basePackage}}.common.logging;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The masker and the inbound filter. The filter is added to the security filter chain (see the skill, step 4). */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MaskingProperties.class)
public class LoggingConfig {

    @Bean
    BodyMasker bodyMasker(MaskingProperties properties) {
        return new BodyMasker(properties);
    }

    @Bean
    HttpLoggingFilter httpLoggingFilter(BodyMasker masker) {
        return new HttpLoggingFilter(masker);
    }

    /** Spring Boot registers every Filter bean as a servlet filter; this one runs only inside the security chain. */
    @Bean
    FilterRegistrationBean<HttpLoggingFilter> httpLoggingFilterRegistration(HttpLoggingFilter filter) {
        FilterRegistrationBean<HttpLoggingFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }
}
```
