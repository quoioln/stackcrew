Goes to `src/common/logging/route-template.guard.ts`.

```ts
// Default location: src/common/logging/route-template.guard.ts
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { recordRouteTemplate } from './http-logging.middleware';

/**
 * The first global guard (APP_GUARD, listed before JwtAuthGuard): records the matched route template for the http_in
 * line, so a 401 or 403 line still names its route and an unknown path logs UNMATCHED. It never refuses a request.
 */
@Injectable()
export class RouteTemplateGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() === 'http') {
      recordRouteTemplate(context.switchToHttp().getRequest<Request>());
    }
    return true;
  }
}
```
