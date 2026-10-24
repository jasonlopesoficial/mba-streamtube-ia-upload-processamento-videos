import { ApiProperty } from '@nestjs/swagger';
import { VideoResponseDto } from './video-response.dto';

export class UploadPlanDto {
  @ApiProperty({ example: 67108864, description: 'Bytes per part' })
  part_size: number;

  @ApiProperty({ example: 160, description: 'ceil(size_bytes / part_size)' })
  part_count: number;
}

export class CreateVideoResponseDto {
  @ApiProperty({ type: VideoResponseDto })
  video: VideoResponseDto;

  @ApiProperty({ type: UploadPlanDto })
  upload: UploadPlanDto;
}
