import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { FilterAppointmentDto } from './dto/filter-appointment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @Roles('PATIENT')
  create(@CurrentUser() user: any, @Body() createAppointmentDto: CreateAppointmentDto) {
    return this.appointmentsService.create(user.id, createAppointmentDto);
  }

  @Get()
  findAll(@Query() filterDto: FilterAppointmentDto) {
    return this.appointmentsService.findAll(filterDto);
  }

  @Get('upcoming')
  getUpcoming(@CurrentUser() user: any) {
    return this.appointmentsService.getUpcoming(user.id, user.role);
  }

  @Get('history')
  getHistory(@CurrentUser() user: any) {
    return this.appointmentsService.getHistory(user.id, user.role);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.appointmentsService.findOne(id, user.id, user.role);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAppointmentDto: UpdateAppointmentDto,
    @CurrentUser() user: any,
  ) {
    return this.appointmentsService.update(id, updateAppointmentDto, user.id, user.role);
  }

  @Delete(':id')
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.appointmentsService.cancel(id, user.id, user.role);
  }
}