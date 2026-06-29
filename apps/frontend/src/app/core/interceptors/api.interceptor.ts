import { HttpInterceptorFn } from '@angular/common/http';

export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  let headers = req.headers.set('Accept', 'application/json');
  
  if (req.body) {
    headers = headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  const apiReq = req.clone({ headers });
  return next(apiReq);
};
