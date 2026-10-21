import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

/**
 * Where campaign files live. The server's disk for now (a Docker volume in
 * production); an S3-compatible bucket can take its place behind the same
 * interface.
 */
export interface FileStorage {
  put(key: string, body: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const KEY = /^[a-z]+\/[0-9a-f-]{36}\.[a-z0-9]{2,4}$/;

export class DiskFileStorage implements FileStorage {
  private readonly dir: string;

  constructor(config: ConfigService) {
    this.dir = resolve(config.get<string>('UPLOAD_DIR') || './uploads');
  }

  async put(key: string, body: Buffer) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch {
      throw new NotFoundException();
    }
  }

  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }

  private path(key: string) {
    if (!KEY.test(key)) throw new NotFoundException();
    return join(this.dir, key);
  }
}
