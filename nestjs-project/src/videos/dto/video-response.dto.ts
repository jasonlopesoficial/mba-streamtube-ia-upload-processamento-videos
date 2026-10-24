import { ApiProperty } from '@nestjs/swagger';
import { Video } from '../entities/video.entity';
import { VideoStatus } from '../videos.constants';

export class VideoMetadataDto {
  @ApiProperty({ example: 'mov,mp4,m4a,3gp,3g2,mj2' })
  format_name: string;

  @ApiProperty({ nullable: true, example: 1200000 })
  bit_rate: number | null;

  @ApiProperty({ nullable: true, example: 1920 })
  width: number | null;

  @ApiProperty({ nullable: true, example: 1080 })
  height: number | null;

  @ApiProperty({ nullable: true, example: 'h264' })
  video_codec: string | null;

  @ApiProperty({ nullable: true, example: 'aac' })
  audio_codec: string | null;
}

export class VideoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ', minLength: 11, maxLength: 11 })
  slug: string;

  @ApiProperty({ example: 'Meu vídeo' })
  title: string;

  @ApiProperty({ enum: Object.values(VideoStatus) })
  status: VideoStatus;

  @ApiProperty({ example: 'movie.mp4' })
  original_filename: string;

  @ApiProperty({ example: 'video/mp4' })
  content_type: string;

  @ApiProperty({ example: 10737418240 })
  size_bytes: number;

  @ApiProperty({ nullable: true, example: 12.5 })
  duration_seconds: number | null;

  @ApiProperty({ type: VideoMetadataDto, nullable: true })
  metadata: VideoMetadataDto | null;

  @ApiProperty({ nullable: true })
  processing_error: string | null;

  @ApiProperty({ nullable: true, example: '/videos/dQw4w9WgXcQ/thumbnail' })
  thumbnail_url: string | null;

  @ApiProperty({ nullable: true, example: '/videos/dQw4w9WgXcQ/stream' })
  stream_url: string | null;

  @ApiProperty({ nullable: true, example: '/videos/dQw4w9WgXcQ/download' })
  download_url: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: Date;

  @ApiProperty({ format: 'date-time' })
  updated_at: Date;

  static fromEntity(video: Video): VideoResponseDto {
    const ready = video.status === VideoStatus.READY;
    const base = `/videos/${video.slug}`;
    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      status: video.status,
      original_filename: video.original_filename,
      content_type: video.content_type,
      size_bytes: video.size_bytes,
      duration_seconds: video.duration_seconds,
      metadata: video.metadata,
      processing_error: video.processing_error,
      thumbnail_url: ready ? `${base}/thumbnail` : null,
      stream_url: ready ? `${base}/stream` : null,
      download_url: ready ? `${base}/download` : null,
      created_at: video.created_at,
      updated_at: video.updated_at,
    };
  }
}
