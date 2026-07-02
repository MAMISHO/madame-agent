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
    ServeStaticModule.forRootAsync({
      useFactory: () => {
        const prodPath = join(__dirname, '..', 'frontend');
        const devPathInApps = join(__dirname, '..', '..', 'frontend', 'dist', 'frontend', 'browser');
        const devPathInRoot = join(__dirname, '..', 'apps', 'frontend', 'dist', 'frontend', 'browser');
        
        let rootPath = devPathInApps;
        if (require('fs').existsSync(prodPath)) {
          rootPath = prodPath;
        } else if (require('fs').existsSync(devPathInRoot)) {
          rootPath = devPathInRoot;
        }
        
        console.log(`[static-serve] Resolved frontend rootPath: ${rootPath} (exists: ${require('fs').existsSync(rootPath)})`);
        
        return [{
          rootPath,
          exclude: ['/v1*', '/api*'],
        }];
      }
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
