import { SetMetadata } from "@nestjs/common";

export const BYPASS_TRANSFORM_KEY = "bypassTransform";

export const BypassTransform = (): MethodDecorator & ClassDecorator =>
  SetMetadata(BYPASS_TRANSFORM_KEY, true);
