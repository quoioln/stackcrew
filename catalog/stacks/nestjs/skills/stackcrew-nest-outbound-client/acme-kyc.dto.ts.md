Goes to `src/modules/kyc/acme/acme-kyc.dto.ts`.

```ts
// Default location: src/modules/kyc/acme/acme-kyc.dto.ts
import { IsIn, IsNumber, IsString, Max, Min } from 'class-validator';

/** Acme's result codes, as its API documents them. Compared only through this object, never inline. */
export const AcmeResultCode = { OK: 'OK', NOT_MATCH: 'NOT_MATCH', PROCESSING: 'PROCESSING' } as const;
export type AcmeResultCode = (typeof AcmeResultCode)[keyof typeof AcmeResultCode];

const MAX_SCORE = 100;

/** The body of POST /v1/verifications. Built only by the mapper; it never leaves the acme folder. */
export type AcmeVerifyRequest = {
  readonly idNumber: string;
  readonly faceImageBase64: string;
  readonly traceRef: string;
};

/** The reply, validated at the edge by the mapper: a missing field or an unknown result code is a protocol error. */
export class AcmeVerifyResponse {
  @IsIn(Object.values(AcmeResultCode))
  readonly resultCode!: AcmeResultCode;

  @IsNumber()
  @Min(0)
  @Max(MAX_SCORE)
  readonly matchScore!: number;

  @IsString()
  readonly transactionId!: string;
}
```
