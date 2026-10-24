# Bridge

Separate an abstraction from its implementation so the two vary independently. Rare: prove that both axes really exist before using it.

## Signals

- Two independent axes of change: a business kind (invoice, reminder, OTP) times a channel or provider (email, SMS, push; provider A, B).
- Adding one value on one axis forces new classes for every value of the other (a class explosion: `InvoiceEmail`, `InvoiceSms`, `OtpEmail`, `OtpSms`).
- Both axes are expected to grow, and the profile or requirement says so.

## Use when

- At least two values exist on each axis today, or are committed in the requirement.
- The abstraction (what we send) holds business logic that must not be duplicated per implementation (how we send).
- The implementation side is already a port (Adapter) and the abstraction side has its own rules.

## Do not use when

- Only one axis varies. That is Strategy or Adapter.
- One axis has a single value and no second is committed.
- The cross product is small and stable (2 x 2); two plain classes are simpler.
- You cannot name both axes in one sentence each. If you cannot, there is no bridge.

## Idioms

### Java (Spring Boot / Quarkus)

- The implementation axis is a port interface (`NotificationChannel`) with one bean per channel. The abstraction axis is a class or `sealed interface` hierarchy that receives the port by constructor injection (`ReminderNotification(NotificationChannel channel)`).
- Select the implementation through the registry (`List<NotificationChannel>` keyed by `code()`), see [strategy.md](strategy.md).
- Prefer a `sealed interface` plus `switch` over an abstract class when the abstraction axis is a closed set of kinds.

### TypeScript (NestJS / Next.js / React / Angular)

- Abstraction as a function or class that takes the implementation as a parameter: `buildReminder(kind, data)` returns a typed message and `channel.send(message)` delivers it. Compose, do not inherit.
- Use discriminated unions for the abstraction axis and a `Record<ChannelCode, Channel>` for the implementation axis.
- React: a UI component (abstraction) that takes a renderer or transport through props or context (implementation).

### Go

- Two small interfaces, one per axis, joined by composition: a struct for the abstraction holds a field of the implementation interface.
- No embedding hierarchy. The cross product is built by passing the pair at construction.

## Example

Language: Go. The message kind and the channel vary independently and are joined by composition.

```go
type Message struct {
	To   string
	Body string
}

type Channel interface {
	Send(ctx context.Context, msg Message) error
}

type MessageBuilder func(data ReminderData) Message

type Notifier struct {
	build   MessageBuilder
	channel Channel
}

func NewNotifier(build MessageBuilder, channel Channel) *Notifier {
	return &Notifier{build: build, channel: channel}
}

func (n *Notifier) Notify(ctx context.Context, data ReminderData) error {
	return n.channel.Send(ctx, n.build(data))
}
```

## AI anti-patterns

- Using Bridge when only one axis varies; it is just Strategy with more names.
- Building the full abstraction hierarchy and the implementer hierarchy for one kind and one channel.
- Naming the pieces `Abstraction` and `Implementor` instead of the domain terms.
- Letting the abstraction reach into channel details (`if (channel instanceof Sms)`), which defeats the split.
- A class hierarchy in Go or React where composition is the idiom.
- Skipping the Bridge when a cross-product explosion is already visible (`InvoiceEmail`, `InvoiceSms`, `OtpEmail`, ...).
