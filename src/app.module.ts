import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProxyModule } from './proxy/proxy.module';
import { RouterModule } from './router/router.module';
import { ProvidersModule } from './providers/providers.module';
import { ClassifierModule } from './classifier/classifier.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ProxyModule,
    RouterModule,
    ProvidersModule,
    ClassifierModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
