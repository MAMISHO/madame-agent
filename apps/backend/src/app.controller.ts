import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import { AppService } from './app.service';
import type { Request, Response } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('chat/completions')
  redirectChat(@Req() req: Request, @Res() res: Response) {
    req.url = '/v1/chat/completions';
    res.redirect(307, '/v1/chat/completions');
  }
}
