import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { videoSourceKey } from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';

let counter = 0;

export async function createChannelOwner(
  dataSource: DataSource,
): Promise<Channel> {
  const n = ++counter;
  const user = await dataSource.getRepository(User).save({
    email: `fixture_${n}_${randomUUID().slice(0, 6)}@example.com`,
    password: 'hashed',
    is_confirmed: true,
  });
  return dataSource.getRepository(Channel).save({
    name: 'fixture',
    nickname: `fixture_${n}_${randomUUID().slice(0, 6)}`,
    user_id: user.id,
  });
}

/** Stores `bytes` as a video source and inserts its row in `status`. */
export async function createStoredVideo(
  dataSource: DataSource,
  storage: StorageService,
  channel: Channel,
  bytes: Buffer,
  status: VideoStatus = VideoStatus.PROCESSING,
): Promise<Video> {
  const id = randomUUID();
  const key = videoSourceKey(id);
  await storage.putObject(key, bytes, 'video/mp4');
  return dataSource.getRepository(Video).save({
    id,
    channel_id: channel.id,
    slug: randomUUID().replace(/-/g, '').slice(0, 11),
    title: 'Fixture video',
    status,
    original_filename: 'sample.mp4',
    content_type: 'video/mp4',
    size_bytes: bytes.length,
    storage_key: key,
    upload_id: null,
  });
}
