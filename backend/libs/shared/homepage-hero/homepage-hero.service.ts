import { Injectable } from "@nestjs/common";
import {
  createHomepageHeroRepo,
  type CreateHomepageHeroInput,
  type UpdateHomepageHeroInput,
} from "@blue-whale/persistence";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

type Repo = ReturnType<typeof createHomepageHeroRepo>;

/**
 * 首页背景图/视频后台动态配置用例依赖（IKCH05）。
 * 单个 service 同时服务 admin CRUD 与公开列表：表小、同 repo 同语义，无需拆双 service。
 */
@Injectable()
export class HomepageHeroService {
  private repoInstance?: Repo;

  private get repo(): Repo {
    if (!this.repoInstance) {
      this.repoInstance = createHomepageHeroRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  /** admin 列表：全部存活条目（含禁用） */
  listAll() {
    return this.repo.listAll();
  }

  /** 公开列表：仅 enabled=1，按 sort_order 升序 */
  listEnabled() {
    return this.repo.listEnabled();
  }

  getById(id: bigint) {
    return this.repo.getById(id);
  }

  create(input: CreateHomepageHeroInput) {
    return this.repo.create(input);
  }

  update(id: bigint, input: UpdateHomepageHeroInput) {
    return this.repo.update(id, input);
  }

  softDelete(id: bigint) {
    return this.repo.softDelete(id);
  }

  move(id: bigint, direction: Parameters<Repo["move"]>[1]) {
    return this.repo.move(id, direction);
  }

  countEnabled() {
    return this.repo.countEnabled();
  }
}
