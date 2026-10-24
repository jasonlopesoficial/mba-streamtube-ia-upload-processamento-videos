import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { UsersModule } from './users/users.module';
import { VideoProcessingModule } from './video-processing/video-processing.module';

/** Root module of the video worker process (no HTTP server). */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    QueueModule,
    // Registers the User entity that Channel relates to (autoLoadEntities).
    UsersModule,
    VideoProcessingModule,
  ],
})
export class WorkerModule {}
