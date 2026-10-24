import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/auth/auth.service';
import { MailService } from '../../src/mail/mail.service';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';

/** Boots AppModule with the same global pipes/filters as `main.ts`. */
export async function createE2eApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<INestApplication<App>> {
  const moduleFixture = await customize(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();
  return app;
}

export function clearThrottler(app: INestApplication<App>): void {
  app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
}

/** Registers, confirms (token captured from the mail service) and logs in. */
export async function registerConfirmAndLogin(
  app: INestApplication<App>,
  email: string,
  password = 'password123',
): Promise<string> {
  const authService = app.get(AuthService);
  const { mailService } = authService as unknown as {
    mailService: MailService;
  };
  let token = '';
  jest
    .spyOn(mailService, 'sendConfirmationEmail')
    .mockImplementationOnce((_e: string, _n: string, t: string) => {
      token = t;
      return Promise.resolve();
    });
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password });
  await request(app.getHttpServer())
    .get('/auth/confirm-email')
    .query({ token });
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password });
  clearThrottler(app);
  return (res.body as { access_token: string }).access_token;
}
