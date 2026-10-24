# Bridge

Separate an abstraction from its implementation so the two vary independently. Rare: prove that both axes really exist before using it.

## Signals

- Two independent axes of change: a business kind (invoice, reminder, OTP) times a channel or provider (email, SMS).
- Adding one value on one axis forces new classes for every value of the other. With 3 kinds x 2 channels you already have six classes (`InvoiceEmail`, `InvoiceSms`, `ReminderEmail`, `ReminderSms`, `OtpEmail`, `OtpSms`), and each new channel adds three more.
- The abstraction side carries rules (templates, validation, localization) that would be copied per implementation.

## Use when

One test: both axes vary independently, and at least one of them is committed to grow (or the cross product is already 3 x 2 or larger), and the abstraction side holds shared rules that must not be duplicated per implementation.
- You can name each axis in one sentence ("what we send" and "how we send it").
- The implementation side is already a port (see [adapter.md](adapter.md)).

## Do not use when

- Only one axis varies. That is Strategy or Adapter.
- One axis has a single value and no second is committed.
- The cross product is small and stable (2 x 2) and nothing is committed to grow; two plain classes are simpler.
- You cannot name both axes in one sentence each. If you cannot, there is no bridge.

## Idioms

### Java (Spring Boot / Quarkus)

- The implementation axis is a port interface (`NotificationChannel`) with one bean per channel. The abstraction axis is a class (or one class per kind) that receives the port by constructor injection (`ReminderNotification(NotificationChannel channel)`).
- Select the implementation through the registry (`List<NotificationChannel>` keyed by `code()`), see [strategy.md](strategy.md).
- For a closed set of kinds on Java 17 use an `enum` with a `switch` expression. Sealed hierarchies with pattern-matching `switch` need Java 21 (optional there).

### TypeScript (NestJS / Next.js / React / Angular)

- Abstraction as a function or class that takes the implementation as a parameter: `buildReminder(kind, data)` returns a typed message and `channel.send(message)` delivers it. Compose, do not inherit.
- Use discriminated unions for the abstraction axis and a `Record<ChannelCode, Channel>` for the implementation axis.
- React: a UI component (abstraction) that takes a renderer or transport through props or context (implementation).

### Go

- Two small interfaces or function types, one per axis, joined by composition: a struct for the abstraction holds a field of the implementation interface.
- No embedding hierarchy. The cross product is built by passing the pair at construction.

## Example

Language: Go. Both axes are shown: the message kind (`MessageBuilder`) and the channel (`Channel`) vary independently and are joined by composition.

```go
type Message struct {
	To   string
	Body string
}

// Axis 1: what we send.
type MessageBuilder func(data ReminderData) Message

// Axis 2: how we send it.
type Channel interface {
	Send(ctx context.Context, msg Message) error
}

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

// Wiring: every builder pairs with every channel, no class per combination.
//   NewNotifier(invoiceMessage, smsChannel)
//   NewNotifier(otpMessage, emailChannel)
```

## AI anti-patterns

- Using Bridge when only one axis varies; it is just Strategy with more names.
- Building the full abstraction hierarchy and the implementer hierarchy for one kind and one channel, or for a stable 2 x 2.
- Naming the pieces `Abstraction` and `Implementor` instead of the domain terms.
- Letting the abstraction reach into channel details (`if (channel instanceof Sms)`), which defeats the split.
- A class hierarchy in Go or React where composition is the idiom.
- Skipping the Bridge when a cross-product explosion is already visible (three kinds times two channels and a third channel coming).
