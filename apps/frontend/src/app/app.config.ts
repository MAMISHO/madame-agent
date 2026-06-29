import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';

import { routes } from './app.routes';
import { harnessReducer } from './features/harness/ui/store/harness.reducer';
import { statsReducer } from './features/stats/ui/store/stats.reducer';
import { HarnessEffects } from './features/harness/ui/store/harness.effects';
import { StatsEffects } from './features/stats/ui/store/stats.effects';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideStore({
      harness: harnessReducer,
      stats: statsReducer,
    }),
    provideEffects([HarnessEffects, StatsEffects]),
  ],
};
