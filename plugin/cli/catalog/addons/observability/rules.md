---
id: addon-observability
title: Observability (Loki, Grafana)
---
# Observability (Loki, Grafana)

Opt-in add-on: it is never detected, so list `observability` in the profile `addons` to use it. Logs go to Loki, dashboards and alerts live in Grafana. Traces to Tempo and metrics to Prometheus are the defaults below; the profile (`stackcrew.json` `decisions[]`) can override them, for example with Datadog, Jaeger or Elastic. Adds to `core-logging`; the redaction and request-logging gates there still apply.

## Essentials

- Write JSON logs to stdout, one event per line, no log files (`core-logging` has the fields, MDC and redaction rules). Spring Boot 3.4+: `logging.structured.format.console=logstash` (or `ecs`); older Boot: `logstash-logback-encoder`. Text format is for local development only.
- Loki labels are low-cardinality: `service`, `env`, `level` and nothing else. `traceId`, `requestId`, `userId` and order ids go in the log line, never as a label.
- Grafana RED dashboards (rate, errors, duration) per service and per third-party provider; tag metrics with `provider`. Alert on error rate, p95 and p99 latency, consumer lag and DLQ depth.
- Ship logs with Grafana Alloy (Promtail is the older agent: same role, deprecated in favour of Alloy). The agent adds the three labels and nothing high-cardinality.
- Metrics default to Micrometer, then Prometheus; traces default to OpenTelemetry (Micrometer Tracing bridge), then Tempo. These are defaults the profile can override.
- Metric tags are bounded too: templated route, status class, provider code, outcome. Never a user id, order id, raw path or exception message.
- Link the signals: a Grafana derived field turns `traceId` in a Loki line into a Tempo trace, and exemplars link a latency panel to a trace.
- Every alert has a severity, an owner and a runbook link. No alert without an action.
- Define retention and sampling: always keep ERROR, sample DEBUG, keep DEBUG off in prod.

## Log format and context

- Format: JSON in staging and prod, text in local, switched by profile or env, never by editing call sites. UTC ISO-8601 timestamps. Fixed fields on every line: `service`, `env`, `version` (commit or build number), `level`, `logger`, `message`, plus the MDC fields.
- One structured event per line: a stable message and key/value fields. Never interpolate data into the message, so a message stays queryable.

Spring Boot 3.4+ needs no XML:

```yaml
spring:
  application:
    name: kyc-gateway                    # use the same value as the `service` label
logging:
  structured:
    format:
      console: logstash                  # one JSON object per line on stdout
    json:
      add:
        service: ${spring.application.name}
        env: ${app.environment}
        version: ${app.version}
management:
  tracing:
    sampling:
      probability: 0.1                   # default is 10%; raise in lower environments
```

- The `logstash` format emits no `service`, `env` or `version` by itself: add them with `logging.structured.json.add.*` as above (`app.environment` and `app.version` are your own properties fed from the deployment). The `logstash` format writes MDC entries as top-level JSON members (`traceId`, `spanId`, `correlationId`). With `ecs` check the member names in one real log line before you build queries. `logging.structured.json.add.*`, `.rename.*` and `.exclude` adjust the members.
- With Micrometer Tracing on the classpath (OpenTelemetry or Brave bridge) `traceId` and `spanId` are in MDC. Put `correlationId`, `requestId` and `userId` in MDC from one filter (HTTP) or listener wrapper (messaging), and clear them in `finally`.

Spring Boot 3.0 to 3.3 uses `logstash-logback-encoder` in `logback-spring.xml`:

```xml
<configuration>
  <springProperty scope="context" name="service" source="spring.application.name"/>
  <springProperty scope="context" name="env" source="app.environment"/>

  <springProfile name="local">
    <include resource="org/springframework/boot/logging/logback/base.xml"/>
  </springProfile>

  <springProfile name="!local">
    <appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
      <encoder class="net.logstash.logback.encoder.LogstashEncoder">
        <customFields>{"service":"${service}","env":"${env}"}</customFields>
        <throwableConverter class="net.logstash.logback.stacktrace.ShortenedThrowableConverter"/>
      </encoder>
    </appender>
    <root level="INFO"><appender-ref ref="JSON"/></root>
  </springProfile>
</configuration>
```

`app.environment` is your own property, fed from the deployment (`env` label values: `local`, `dev`, `staging`, `prod`). `LogstashEncoder` writes all MDC entries as JSON members. Mask sensitive members in the encoder (`MaskingJsonGeneratorDecorator`) as a second line of defence; the first is not logging them.

Other stacks: `pino` with `AsyncLocalStorage` for the ids (Node, NestJS), `log/slog` with a JSON handler and `context.Context` (Go). Same fields, same labels.

## Loki labels

- Labels define a stream: every distinct combination of label values is a separate stream. Keep `service`, `env` and `level` (tens of values at most). `level` is the only label taken from the log line.
- Never a label: `traceId`, `spanId`, `requestId`, `correlationId`, `userId`, order or provider reference ids, pod name, IP, HTTP status, timestamp. Find them with a line filter (`|= "traceId=..."`) or a parsed field (`| json | traceId="..."`).
- Loki 3 structured metadata may carry `traceId` for faster lookup without creating streams. The id stays in the log line too, so the line is complete.
- `service` comes from `spring.application.name` (or the Kubernetes app label), `env` from the deployment, never from the application code.

## Shipping logs: Grafana Alloy

```alloy
discovery.kubernetes "pods" {
  role = "pod"
}

discovery.relabel "pods" {
  targets = discovery.kubernetes.pods.targets
  rule {
    source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_name"]
    target_label  = "service"
  }
  rule {
    target_label = "env"
    replacement  = "prod"
  }
}

loki.source.kubernetes "pods" {
  targets    = discovery.relabel.pods.output
  forward_to = [loki.process.json.receiver]
}

loki.process "json" {
  stage.json {
    expressions = { level = "level" }
  }
  stage.labels {
    values = { level = "" }
  }
  stage.label_drop {
    values = ["instance", "job"]       // Alloy adds these defaults; pod identity is per-pod cardinality
  }
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = sys.env("LOKI_URL")
  }
}
```

- `loki.source.kubernetes` tails logs through the Kubernetes API: no privileged DaemonSet, no node filesystem. On plain Docker or VMs use `loki.source.docker` or `loki.source.file` with the same `loki.process` stage. An existing Promtail setup keeps working with the same label set; plan the move to Alloy.
- `loki.source.kubernetes` adds default labels such as `instance` (namespace/pod:container) and `job`: drop them as above, so the stream set stays `service`, `env`, `level`. If you need to find a pod, add it as structured metadata (`stage.structured_metadata`), never as a label.
- Set `env` per cluster or namespace, not per line. Do not add a stage that turns a JSON field other than `level` into a label.

## Metrics: RED per service and per provider

- Rate, Errors, Duration for each service (HTTP server) and for each third-party provider (outbound calls). Add the saturation signals that apply: thread pool, connection pool, consumer lag.
- Micrometer `Timer` for outbound calls with tags `provider` (the provider code constant) and `outcome` (bounded values), publishing a histogram so p95 and p99 can be computed. The same `provider` tag goes on failure counters and on the Resilience4j instance names.

```java
Timer.builder(ProviderMetrics.CALL)
    .tag(ProviderMetrics.TAG_PROVIDER, providerCode)
    .tag(ProviderMetrics.TAG_OUTCOME, outcome)
    .publishPercentileHistogram()
    .register(meterRegistry)
    .record(duration);
```

- Expose the Prometheus endpoint through Actuator (`micrometer-registry-prometheus`, `/actuator/prometheus`) on the management port, not public. Enable histograms for the HTTP server timer with `management.metrics.distribution.percentiles-histogram.http.server.requests=true`.
- Grafana panels (names follow Micrometer's Prometheus naming; adapt to your metric names):

```promql
# Rate per provider
sum by (provider) (rate(provider_call_seconds_count[5m]))
# Error ratio per provider
sum by (provider) (rate(provider_call_seconds_count{outcome!="success"}[5m]))
  / sum by (provider) (rate(provider_call_seconds_count[5m]))
# p95 and p99 latency per provider
histogram_quantile(0.95, sum by (le, provider) (rate(provider_call_seconds_bucket[5m])))
histogram_quantile(0.99, sum by (le, provider) (rate(provider_call_seconds_bucket[5m])))
```

- One dashboard per service (rate, error ratio, p95 and p99, saturation, JVM) plus one provider dashboard with a `provider` variable. Dashboards are JSON in the repository, provisioned, not clicked together by hand.
- Logs panel on the same dashboard: a Loki query filtered by `{service="...", env="..."}` and the selected `level`, with the derived field to Tempo.

## Alerts

- Error rate: 5xx or failed-outcome ratio above a threshold for 5 minutes, per service and per provider.
- Latency: p95 and p99 above the agreed objective for 10 minutes.
- Consumer lag: lag growing, or above N for longer than the processing time budget (Kafka consumer group lag, RabbitMQ queue depth and unacked).
- DLQ depth: any message older than a limit, or depth above zero for longer than the allowed triage time (dead-letter topic or queue).
- Also: readiness failing, circuit breaker open for a provider, certificate expiry, a sudden drop to zero in rate.
- Page on user impact (error rate, latency, lag, DLQ), not on a single noisy metric. Each alert states the owner and the runbook.

## Tracing

- Default: OpenTelemetry through the Micrometer Tracing bridge (`micrometer-tracing-bridge-otel`, `opentelemetry-exporter-otlp`; settings under `management.otlp.tracing.*`), exported to Tempo. `RestClient` built from the injected builder, Kafka and RabbitMQ templates and listeners with observation enabled propagate `traceparent` on their own.
- Do not create trace ids by hand. Sample in production, keep every error trace if the backend supports tail sampling.

## Operability gates

- No PII or secret in logs is a release gate (scan or review). Request, response and message bodies are logged only through the shared masker, never by hand. Deep redaction: passwords, tokens, API keys, `Authorization` headers, cookies and PII (email, phone, national id, card number) are masked in the logging layer, including nested objects and stack traces. Strip CR and LF from user-supplied values to prevent log injection.
- Logs, traces and metrics correlate by `traceId`: the same id appears in the log line, the span and the exemplar.
- Retention and sampling are written down per environment.
- Logs go to stdout; the platform ships them. The application does not rotate or upload log files.
- A new integration, consumer or scheduled job ships with its log fields, metrics, dashboard panel and alert in the same change (see the feature guideline).
