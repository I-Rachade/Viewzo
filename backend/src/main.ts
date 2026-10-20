import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { checkProductionConfig } from './config-check';
import { setupApp } from './setup-app';

async function bootstrap() {
  checkProductionConfig();
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
