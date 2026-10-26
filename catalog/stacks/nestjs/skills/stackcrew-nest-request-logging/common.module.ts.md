Goes to `src/common/common.module.ts`.

```ts
// Default location: src/common/common.module.ts (AppModule imports it; APP_* providers apply to the whole app)
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv, type LoggingEnv } from '../config/env';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { JwtStrategy } from './auth/jwt.strategy';
import { RequestContextInterceptor } from './context/request-context.interceptor';
import { AllExceptionsFilter } from './errors/all-exceptions.filter';
import { requestValidationError } from './errors/problem-details';
import { pinoHttpOptions } from './logging/logging.setup';
import { RouteTemplateGuard } from './logging/route-template.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<LoggingEnv, true>) => ({ pinoHttp: pinoHttpOptions(config.get('LOG_LEVEL', { infer: true })) }),
    }),
    PassportModule,
  ],
  providers: [
    JwtStrategy,
    { provide: APP_GUARD, useClass: RouteTemplateGuard }, // first: global guards run in this order
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: requestValidationError }),
    },
  ],
})
export class CommonModule {}
```
