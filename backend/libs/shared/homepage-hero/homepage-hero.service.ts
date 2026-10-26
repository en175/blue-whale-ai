import { Injectable } from "@nestjs/common";
import {
  createHomepageHeroRepo,
  type CreateHomepageHeroInput,
  type HomepageHeroScene,
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

  listAll(scene: HomepageHeroScene) {
    return this.repo.listAll(scene);
  }

  listEnabled(scene: HomepageHeroScene) {
    return this.repo.listEnabled(scene);
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

  countEnabled(scene: HomepageHeroScene) {
    return this.repo.countEnabled(scene);
  }
}
