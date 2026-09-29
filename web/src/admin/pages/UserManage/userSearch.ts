/**
 * 管理端用户列表**服务端搜索**的关键词归一（IKJ5M7）。
 *
 * ⚠️ 这里只剩「归一」，不再有「本地匹配」那一半：搜索已经下沉到服务端
 * （`admin-user-query` 的 `keyword`）。前端再留一份匹配逻辑就是两个判据 ——
 * 它们迟早会对不上，而对不上的表现是「界面上看着筛过了，其实没有」。
 *
 * 归一本身仍然要做：`#42` 是搜索框里常见的写法（列表早先显示过 `#ID`），
 * 而服务端只认 `42`。不去掉前导井号，那个关键词会一条都匹配不到。
 */
export function normalizeAdminUserKeyword(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/^#+/, '');
}
