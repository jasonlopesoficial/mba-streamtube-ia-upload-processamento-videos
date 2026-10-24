import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Video } from './entities/video.entity';
import { VideosModule } from './videos.module';

describe('VideosModule', () => {
  it('should compile with the Video repository registered', async () => {
    const module = await Test.createTestingModule({
      imports: [VideosModule],
    })
      .overrideProvider(getRepositoryToken(Video))
      .useValue({})
      .compile();

    expect(module.get(getRepositoryToken(Video))).toBeDefined();
    await module.close();
  });
});
