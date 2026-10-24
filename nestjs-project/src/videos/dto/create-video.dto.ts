import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateVideoDto {
  /** Video title shown to viewers. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  /** Original file name (used as the download file name). */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  file_name: string;

  /** MIME type of the file, e.g. `video/mp4`. */
  @IsString()
  @MaxLength(100)
  @Matches(/^video\/[a-z0-9.+-]+$/)
  content_type: string;

  /** Exact file size in bytes (max `VIDEO_MAX_SIZE_BYTES`, 10 GiB by default). */
  @IsInt()
  @Min(1)
  size_bytes: number;
}
