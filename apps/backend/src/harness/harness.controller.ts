import { Controller, Get, Post, Body, Param, Put, Delete, BadRequestException } from '@nestjs/common';
import { HarnessService } from './harness.service';
import { CreateHarnessDto, UpdateHarnessDto, HarnessDto } from './application/dtos/harness.dto';

@Controller('v1/harness')
export class HarnessController {
  constructor(private readonly harnessService: HarnessService) {}

  @Get()
  async listAll(): Promise<HarnessDto[]> {
    return this.harnessService.listAll();
  }

  @Post()
  async create(@Body() body: CreateHarnessDto): Promise<HarnessDto> {
    return this.harnessService.create(body);
  }

  @Get(':id')
  async getOne(@Param('id') id: string): Promise<HarnessDto> {
    return this.harnessService.getOne(id);
  }

  @Put(':id/active')
  async setActive(@Param('id') id: string) {
    return this.harnessService.setActive(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.harnessService.delete(id);
  }

  @Put(':id/agents/:role')
  async updateAgent(
    @Param('id') id: string,
    @Param('role') role: string,
    @Body() body: { prompt: string; providerId: string; modelName: string }
  ) {
    if (!body.prompt || !body.providerId || !body.modelName) {
      throw new BadRequestException('Prompt, providerId and modelName are required');
    }
    return this.harnessService.updateAgent(id, role, body.prompt, body.providerId, body.modelName);
  }

  @Get(':id/agents/:role')
  async getAgent(
    @Param('id') id: string,
    @Param('role') role: string
  ) {
    return this.harnessService.getAgent(id, role);
  }
}

