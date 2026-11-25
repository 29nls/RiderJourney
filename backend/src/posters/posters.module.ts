import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PostersController } from './posters.controller.js';
import { PostersService } from './posters.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PostersController],
  providers: [PostersService],
  exports: [PostersService],
})
export class PostersModule {}
