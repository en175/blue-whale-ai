import { Injectable } from "@nestjs/common";
import {
  createHomepageHeroRepo,
  type CreateHomepageHeroInput,
  type UpdateHomepageHeroInput,
} from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

type Repo = ReturnType<typeof createHomepageHeroRepo>;

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

  listAll() {
    return this.repo.listAll();
  }

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
