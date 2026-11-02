SET NAMES utf8mb4;
ALTER TABLE `catalog_material_states`
    RENAME INDEX `uk_catalog_material_states__material` TO `uk_user_material_info__material`,
    RENAME INDEX `idx_catalog_material_states__poll` TO `idx_user_material_info__poll`,
    RENAME INDEX `idx_catalog_material_states__group` TO `idx_user_material_info__group`;
RENAME TABLE `user_material_info` TO `user_material_groups`,
             `catalog_material_states` TO `user_material_info`;
