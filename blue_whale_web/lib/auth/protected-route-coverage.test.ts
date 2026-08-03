import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const apiRoot = path.join(webRoot, "app/api");

const EXEMPT = new Set([
  "auth/capabilities/route.ts",
  "auth/login/route.ts",
  "auth/logout/route.ts",
  "auth/register/route.ts",
  "auth/send-code/route.ts",
  "me/route.ts",
  "usage/token/route.ts",
  // IK587T 充值模块：自有 sk-xxx token 鉴权（直传 new-api），不属 IK50GB 统一认证范围。
  "recharge/agreement/route.ts",
  "recharge/order/route.ts",
  "recharge/order/[tradeNo]/cancel/route.ts",
  "recharge/order/[tradeNo]/status/route.ts",
  "recharge/tiers/route.ts",
  // IK51OP 操作日志：管理端审计 API，鉴权后续接入。
  "admin/operation-logs/route.ts",
]);

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".worker-dist",
  "node_modules",
  "out",
]);
const HTTP_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

function walkFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const filePath = path.join(directory, entry);
      if (statSync(filePath).isDirectory()) {
        return SKIPPED_DIRECTORIES.has(entry) ? [] : walkFiles(filePath);
      }
      return [filePath];
    })
    .sort();
}

function hasProtectedRouteAuth(source: string): boolean {
  const sourceFile = ts.createSourceFile(
    "route.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let importsWithAuthenticatedUser = false;
  let hasUnsupportedHttpExport = false;
  const exportedHttpMethods: ts.FunctionDeclaration[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "@/lib/auth/product-route-auth" &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(
        (element) =>
          (element.name.text === "withAuthenticatedUser" ||
            element.name.text === "withAdminUser") &&
          (element.propertyName?.text ?? element.name.text) ===
            element.name.text,
      )
    ) {
      importsWithAuthenticatedUser = true;
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      HTTP_METHODS.has(node.name.text) &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      exportedHttpMethods.push(node);
    }

    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) &&
      node.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          HTTP_METHODS.has(declaration.name.text),
      )
    ) {
      hasUnsupportedHttpExport = true;
    }

    if (
      ts.isExportDeclaration(node) &&
      (node.exportClause === undefined ||
        (ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.some((element) =>
            HTTP_METHODS.has(element.name.text),
          )))
    ) {
      hasUnsupportedHttpExport = true;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return (
    importsWithAuthenticatedUser &&
    !hasUnsupportedHttpExport &&
    exportedHttpMethods.length > 0 &&
    exportedHttpMethods.every((method) =>
      method.body?.statements.some(
        (statement) =>
          ts.isReturnStatement(statement) &&
          statement.expression !== undefined &&
          ts.isCallExpression(statement.expression) &&
          ts.isIdentifier(statement.expression.expression) &&
          (statement.expression.expression.text === "withAuthenticatedUser" ||
            statement.expression.expression.text === "withAdminUser"),
      ),
    )
  );
}

describe("protected product route coverage", () => {
  it("rejects a route that imports withAuthenticatedUser without calling it", () => {
    const source = [
      'import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";',
      "",
      "export async function GET() {",
      "  return Response.json({ ok: true });",
      "}",
    ].join("\n");
    expect(hasProtectedRouteAuth(source)).toBe(false);
  });

  it("rejects a multi-method route when any exported method bypasses auth", () => {
    const source = [
      'import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";',
      "",
      "export async function GET(request: Request) {",
      "  return withAuthenticatedUser(request, async () => Response.json({}));",
      "}",
      "",
      "export async function POST() {",
      '  return Response.json({ error: "unprotected" });',
      "}",
    ].join("\n");
    expect(hasProtectedRouteAuth(source)).toBe(false);
  });

  it("rejects an unprotected HTTP method exported as a const", () => {
    const source = [
      'import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";',
      "",
      "export async function GET(request: Request) {",
      "  return withAuthenticatedUser(request, async () => Response.json({}));",
      "}",
      "",
      "export const POST = async () => Response.json({});",
    ].join("\n");
    expect(hasProtectedRouteAuth(source)).toBe(false);
  });

  it("requires every non-exempt API route to use withAuthenticatedUser", () => {
    const uncovered = walkFiles(apiRoot)
      .filter((filePath) => filePath.endsWith("/route.ts"))
      .map((filePath) => ({
        filePath,
        relativePath: path.relative(apiRoot, filePath),
        source: readFileSync(filePath, "utf8"),
      }))
      .filter(({ relativePath }) => !EXEMPT.has(relativePath))
      .filter(({ source }) => !hasProtectedRouteAuth(source))
      .map(({ relativePath }) => relativePath);

    expect(uncovered).toEqual([]);
  });

  it("forbids legacy request identity helpers in production TypeScript", () => {
    const violations = walkFiles(webRoot)
      .filter((filePath) => /\.(?:ts|tsx)$/.test(filePath))
      .filter((filePath) => !/\.(?:test|spec)\.(?:ts|tsx)$/.test(filePath))
      .flatMap((filePath) => {
        const source = readFileSync(filePath, "utf8");
        return ["getUser" + "IdFromRequest", "ownerIdFrom" + "NewApiToken"]
          .filter((symbol) => source.includes(symbol))
          .map((symbol) => `${path.relative(webRoot, filePath)}: ${symbol}`);
      });

    expect(violations).toEqual([]);
  });

  it("forbids any Java gateway rewrite and GATEWAY_URL wiring (IK50GB 断链)", () => {
    const nextConfig = readFileSync(
      path.join(webRoot, "next.config.ts"),
      "utf8",
    );
    const dockerfile = readFileSync(
      path.join(webRoot, "Dockerfile"),
      "utf8",
    );
    const javaRewriteSources = [
      // B 已退役：Conversation / GenerationInbox / AgentRun / InputRequest / SSE
      "/api/agent/runs/",
      "/api/generation-inbox/",
      "/api/jobs/:path*/stream",
      "/api/projects/:path*/conversation/",
      "/api/projects/:path*/input-requests/",
      "/api/projects/:path*/events",
      // C 断链：账户 / 回调 / Asset 文件代理（生产零消费者，均已迁 Node 或退役）
      "/api/user/:path*",
      "/api/webhooks/:path*",
      "/assets/:path*",
    ];

    expect(
      javaRewriteSources.filter((pattern) => nextConfig.includes(pattern)),
    ).toEqual([]);
    // §6.4.1：浏览器与 Next.js 不得再注入或请求 Java 网关地址。
    expect(nextConfig).not.toContain("process.env.GATEWAY_URL");
    expect(dockerfile).not.toContain("GATEWAY_URL");
    expect(dockerfile).not.toContain("blue-whale-gateway");
  });
});
