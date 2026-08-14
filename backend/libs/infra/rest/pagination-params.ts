import { Transform } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/** 分页基类 DTO（对齐 soybean-admin-nestjs PaginationParams）：current/size，query 字符串自动转数字。 */
export class PaginationParams {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value ? Number.parseInt(value, 10) : 1))
  current: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => (value ? Number.parseInt(value, 10) : 10))
  size: number = 10;
}
