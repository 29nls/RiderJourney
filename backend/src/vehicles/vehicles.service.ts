import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { PlanService } from '../entitlements/plan.service.js';
import { MediaService } from '../media/media.service.js';
import { decryptValue, encryptValue } from '../common/crypto.js';
import type { CreateVehicleDto, UpdateVehicleDto } from './vehicles.dto.js';

type VehicleRow = {
  id: string;
  owner_id: string;
  type: string;
  brand: string;
  model: string;
  year: number | null;
  engine_cc: number | null;
  nickname: string | null;
  photo_url: string | null;
  photo_media_id: string | null;
  plate_ciphertext: Buffer | null;
  plate_iv: Buffer | null;
  plate_tag: Buffer | null;
  plate_key_version: number | null;
  is_primary: boolean;
  created_at: Date;
  updated_at: Date;
};

function baseDto(row: VehicleRow) {
  return {
    id: row.id,
    type: row.type,
    brand: row.brand,
    model: row.model,
    year: row.year,
    engineCc: row.engine_cc,
    nickname: row.nickname,
    photoUrl: row.photo_url,
    photoMediaId: row.photo_media_id,
    isPrimary: row.is_primary,
    hasPlate: Boolean(row.plate_ciphertext),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

@Injectable()
export class VehiclesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly plans: PlanService,
    private readonly media: MediaService,
  ) {}

  private encryptPlate(plate: string) {
    if (!this.config.plateKey) {
      throw new ServiceUnavailableException({
        code: 'ENCRYPTION_NOT_CONFIGURED',
        title: 'Penyimpanan plat belum dikonfigurasi',
        detail: 'Nomor polisi tidak dapat disimpan sampai PLATE_ENCRYPTION_KEY diatur.',
      });
    }
    return encryptValue(plate.trim().toUpperCase(), this.config.plateKey, 1);
  }

  private async row(ownerId: string, id: string): Promise<VehicleRow> {
    const rows = await this.db.query<VehicleRow>(
      'SELECT * FROM vehicles WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL',
      [id, ownerId],
    );
    if (!rows[0]) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Kendaraan tidak ditemukan', detail: 'Kendaraan tidak ada.' });
    }
    return rows[0];
  }

  async list(ownerId: string) {
    const rows = await this.db.query<VehicleRow>(
      'SELECT * FROM vehicles WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY is_primary DESC, created_at ASC',
      [ownerId],
    );
    return { items: rows.map(baseDto) };
  }

  async create(ownerId: string, dto: CreateVehicleDto) {
    const id = uuidv7();
    const encrypted = dto.plate ? this.encryptPlate(dto.plate) : null;
    const limit = (await this.plans.limits(ownerId)).vehicleLimit;
    await this.db.transaction(async (tx) => {
      const count = await tx.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM vehicles WHERE owner_id = $1 AND deleted_at IS NULL',
        [ownerId],
      );
      if (Number(count[0]?.count ?? 0) >= limit) {
        throw new ConflictException({
          code: 'VEHICLE_LIMIT_REACHED',
          title: 'Batas kendaraan tercapai',
          detail: `Paket aktif mengizinkan ${limit} kendaraan.`,
        });
      }
      const isPrimary = Number(count[0]?.count ?? 0) === 0;
      await tx.query(
        `INSERT INTO vehicles (
           id, owner_id, type, brand, model, year, engine_cc, nickname, photo_url,
           plate_ciphertext, plate_iv, plate_tag, plate_key_version, is_primary
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          id, ownerId, dto.type, dto.brand.trim(), dto.model.trim(), dto.year ?? null,
          dto.engineCc ?? null, dto.nickname ?? null, dto.photoUrl ?? null,
          encrypted?.ciphertext ?? null, encrypted?.iv ?? null, encrypted?.tag ?? null,
          encrypted?.keyVersion ?? null, isPrimary,
        ],
      );
    });
    // Reuse the same purpose/ownership validation as update().
    if (dto.photoMediaId) {
      return this.update(ownerId, id, { photoMediaId: dto.photoMediaId });
    }
    return baseDto(await this.row(ownerId, id));
  }

  async get(ownerId: string, id: string, includePlate: boolean) {
    const row = await this.row(ownerId, id);
    const dto = baseDto(row);
    if (!includePlate || !row.plate_ciphertext || !row.plate_iv || !row.plate_tag || !this.config.plateKey) {
      return dto;
    }
    return {
      ...dto,
      plate: decryptValue(
        { ciphertext: row.plate_ciphertext, iv: row.plate_iv, tag: row.plate_tag, keyVersion: row.plate_key_version ?? 1 },
        this.config.plateKey,
      ),
    };
  }

  async update(ownerId: string, id: string, dto: UpdateVehicleDto) {
    await this.row(ownerId, id);
    const sets: string[] = [];
    const values: unknown[] = [];
    const map: Array<[keyof UpdateVehicleDto, string]> = [
      ['type', 'type'], ['brand', 'brand'], ['model', 'model'], ['year', 'year'],
      ['engineCc', 'engine_cc'], ['nickname', 'nickname'], ['photoUrl', 'photo_url'],
    ];
    for (const [key, column] of map) {
      if (dto[key] !== undefined) {
        values.push(typeof dto[key] === 'string' ? (dto[key] as string).trim() : dto[key]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (dto.plate !== undefined) {
      if (dto.plate.trim() === '') {
        sets.push('plate_ciphertext = NULL', 'plate_iv = NULL', 'plate_tag = NULL', 'plate_key_version = NULL');
      } else {
        const encrypted = this.encryptPlate(dto.plate);
        values.push(encrypted.ciphertext);
        sets.push(`plate_ciphertext = $${values.length}`);
        values.push(encrypted.iv);
        sets.push(`plate_iv = $${values.length}`);
        values.push(encrypted.tag);
        sets.push(`plate_tag = $${values.length}`);
        values.push(encrypted.keyVersion);
        sets.push(`plate_key_version = $${values.length}`);
      }
    }
    // The pointer being replaced is read first so it can be evaluated for
    // deletion in the same transaction that detaches it.
    let previousPhoto: string | null = null;
    if (dto.photoMediaId !== undefined) {
      const current = await this.db.query<{ photo_media_id: string | null }>(
        `SELECT photo_media_id FROM vehicles WHERE id = $1 AND owner_id = $2`,
        [id, ownerId],
      );
      previousPhoto = current[0]?.photo_media_id ?? null;
    }
    // Handle photoMediaId linkage.
    if (dto.photoMediaId !== undefined) {
      if (dto.photoMediaId === '') {
        values.push(null);
        sets.push(`photo_media_id = $${values.length}`);
      } else {
        const media = await this.db.query<{ id: string }>(
          `SELECT id FROM media_assets WHERE id = $1 AND owner_id = $2 AND status = 'ready' AND purpose = 'vehicle_photo'`,
          [dto.photoMediaId, ownerId],
        );
        if (!media[0]) {
          throw new UnprocessableEntityException({
            code: 'MEDIA_NOT_ATTACHABLE',
            title: 'Media tidak dapat digunakan',
            detail: 'Foto kendaraan harus berupa media yang sudah selesai diunggah dengan purpose vehicle_photo.',
          });
        }
        values.push(dto.photoMediaId);
        sets.push(`photo_media_id = $${values.length}`);
      }
    }
    const nextPhoto = dto.photoMediaId === undefined ? undefined : dto.photoMediaId === '' ? null : dto.photoMediaId;
    await this.db.transaction(async (tx) => {
      if (sets.length > 0) {
        values.push(id);
        await tx.query(`UPDATE vehicles SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
      }
      // Only an asset that nothing else points at is enqueued; a photo reused by
      // another vehicle stays put.
      if (nextPhoto !== undefined && previousPhoto && previousPhoto !== nextPhoto) {
        await this.media.detachAndRelease(tx, ownerId, previousPhoto, 'vehicle_photo_replaced');
      }
    });
    return this.get(ownerId, id, false);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const result = await this.db.query<{ id: string }>(
      `UPDATE vehicles SET deleted_at = now(), is_primary = false, updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL RETURNING id`,
      [id, ownerId],
    );
    if (result.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Kendaraan tidak ditemukan', detail: 'Kendaraan tidak ada.' });
    }
  }

  async setPrimary(ownerId: string, id: string) {
    await this.row(ownerId, id);
    await this.db.transaction(async (tx) => {
      await tx.query('UPDATE vehicles SET is_primary = false, updated_at = now() WHERE owner_id = $1 AND is_primary', [ownerId]);
      await tx.query('UPDATE vehicles SET is_primary = true, updated_at = now() WHERE id = $1 AND owner_id = $2', [id, ownerId]);
    });
    return this.get(ownerId, id, false);
  }
}
