import { Body, Controller, Header, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CreateDemoRequestSchema } from './demo-request.schema.js';
import { DemoRequestsService } from './demo-requests.service.js';

class CreateDemoRequestDto extends createZodDto(CreateDemoRequestSchema) {}

@Controller('public')
export class DemoRequestsController {
  constructor(private readonly demoRequests: DemoRequestsService) {}

  /** POST /v1/public/demo-request — solicitud pública desde control.myquivo.com. */
  @Post('demo-request')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  create(@Body() body: CreateDemoRequestDto) {
    return this.demoRequests.create(body);
  }
}
