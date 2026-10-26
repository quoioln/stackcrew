Goes to `src/modules/kyc/acme/acme-kyc.mapper.ts`.

```ts
// Default location: src/modules/kyc/acme/acme-kyc.mapper.ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProviderProtocolError } from '../../../common/providers/provider.errors';
import { KycDecision, type VerifyIdentityCommand, type VerifyIdentityResult } from '../interfaces/kyc-verification';
import { AcmeResultCode, AcmeVerifyResponse, type AcmeVerifyRequest } from './acme-kyc.dto';

const DECISION_BY_RESULT: ReadonlyMap<AcmeResultCode, KycDecision> = new Map([
  [AcmeResultCode.OK, KycDecision.APPROVED],
  [AcmeResultCode.NOT_MATCH, KycDecision.REJECTED],
  [AcmeResultCode.PROCESSING, KycDecision.PENDING],
]);

/** The anti-corruption layer: the only code that knows both Acme's vocabulary and the domain's. */
export function toAcmeRequest(command: VerifyIdentityCommand): AcmeVerifyRequest {
  return { idNumber: command.documentNumber, faceImageBase64: command.selfie.toString('base64'), traceRef: command.requestId };
}

/** Parses the reply at the edge: anything but a valid AcmeVerifyResponse is a ProviderProtocolError, never a partial result. */
export function toVerifyResult(body: unknown): VerifyIdentityResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ProviderProtocolError(); // not JSON (axios hands over the text), or not an object
  }
  const reply = plainToInstance(AcmeVerifyResponse, body);
  if (validateSync(reply).length > 0) {
    throw new ProviderProtocolError();
  }
  const decision = DECISION_BY_RESULT.get(reply.resultCode);
  if (decision === undefined) {
    throw new ProviderProtocolError();
  }
  return { decision, score: reply.matchScore, providerReference: reply.transactionId };
}
```
