import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { CreateVideoResponseDto } from './dto/create-video-response.dto';
import { SignUploadPartsDto } from './dto/sign-upload-parts.dto';
import {
  SignedUploadPartsResponseDto,
  UploadedPartsResponseDto,
} from './dto/upload-parts-response.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import type { VideoDelivery } from './video-delivery.types';
import { VideosService } from './videos.service';

@ApiTags('videos')
@SkipThrottle()
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      'Pre-registers the video as draft in the caller channel and opens a multipart upload in object storage. File bytes are uploaded directly to storage through presigned part URLs — never through the API.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft video created and multipart upload opened',
    type: CreateVideoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or size exceeds VIDEO_MAX_SIZE_BYTES',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Authenticated user has no channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<CreateVideoResponseDto> {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  @Get(':slug')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get an owned video',
    description:
      'Returns a video of the caller channel in any status (draft, processing, ready, failed), with metadata and delivery links once ready.',
  })
  @ApiResponse({ status: 200, description: 'Video', type: VideoResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
  ): Promise<VideoResponseDto> {
    return this.videosService.getOwnedVideo(slug, user.sub);
  }

  @Post(':slug/upload/parts')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Sign upload part URLs',
    description:
      'Returns presigned UploadPart URLs for the requested part numbers of a draft video owned by the caller. Also used to resume an interrupted upload with fresh URLs.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned part URLs',
    type: SignedUploadPartsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or part number beyond part_count',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not a draft',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async signUploadParts(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: SignUploadPartsDto,
  ): Promise<SignedUploadPartsResponseDto> {
    return this.videosService.signUploadParts(slug, user.sub, dto.part_numbers);
  }

  @Get(':slug/upload/parts')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List uploaded parts',
    description:
      'Lists the parts already stored for the open multipart upload of a draft video owned by the caller, so an interrupted upload can resume.',
  })
  @ApiResponse({
    status: 200,
    description: 'Parts already stored, ordered by part_number',
    type: UploadedPartsResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not a draft',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async listUploadedParts(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
  ): Promise<UploadedPartsResponseDto> {
    return this.videosService.listUploadedParts(slug, user.sub);
  }

  @Post(':slug/upload/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Completes the multipart upload of a draft video owned by the caller, verifies the stored size, moves the video to processing and enqueues the background processing job (metadata extraction + thumbnail).',
  })
  @ApiResponse({
    status: 202,
    description: 'Upload completed; processing scheduled',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or storage rejected the parts',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not a draft',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 422,
    description: 'Stored size differs from the declared size (video failed)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<VideoResponseDto> {
    return this.videosService.completeUpload(slug, user.sub, dto.parts);
  }

  @Public()
  @Get(':slug/stream')
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Public playback of a ready video. Honours a single `Range: bytes=` request with 206 Partial Content so playback starts without downloading the whole file.',
  })
  @ApiResponse({
    status: 200,
    description: 'Full video body (no Range header)',
  })
  @ApiResponse({ status: 206, description: 'Requested byte range' })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 416,
    description: 'Range starts beyond the end of the video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('slug') slug: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.send(res, await this.videosService.openStream(slug, range));
  }

  private send(res: Response, delivery: VideoDelivery): StreamableFile {
    res.status(delivery.statusCode).set(delivery.headers);
    return new StreamableFile(delivery.body);
  }
}
