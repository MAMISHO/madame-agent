import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProxyModule } from './proxy/proxy.module';
import { RouterModule } from './router/router.module';
import { ProvidersModule } from './providers/providers.module';
import { ClassifierModule } from './classifier/classifier.module';
import { PromptsModule } from './prompts/prompts.module';
import { UtilsModule } from './utils/utils.module';
import { HarnessModule } from './harness/harness.module';
import { DatabaseModule } from './core/infra/database/database.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import configuration from './config/configuration';

@Module({
  imports: [
    DatabaseModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'frontend', 'dist', 'frontend', 'browser'),
      exclude: ['/v1*'],
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ProxyModule,
    RouterModule,
    ProvidersModule,
    ClassifierModule,
    PromptsModule,
    UtilsModule,
    HarnessModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
