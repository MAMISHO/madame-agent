import { DataBaseProviderFactory } from './provider.factory';

const provider = new DataBaseProviderFactory();

export const databaseProviders = [
  {
    provide: 'DATABASE_CONNECTION',
    useFactory: (): Promise<void> => provider.connect(),
  },
];
