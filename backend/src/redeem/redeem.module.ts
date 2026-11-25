import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RedeemController } from './redeem.controller.js';
import { RedeemService } from './redeem.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RedeemController],
  providers: [RedeemService],
  exports: [RedeemService],
})
export class RedeemModule {}
